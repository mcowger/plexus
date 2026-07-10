import { afterEach, beforeEach, describe, expect, vi, test } from 'vitest';
import { registerSpy } from '../../../test/test-utils';
import { OAuthAuthManager } from '../../services/oauth-auth-manager';
import { piAiModels } from '../../services/pi-ai/registry';
import { REQUIRED_BETAS } from '../oauth/masking';

// @earendil-works/pi-ai is mocked globally in vitest.setup.ts — do not add a
// per-file vi.mock() call here.  With isolate: false all files share one
// module registry and competing registrations create last-writer-wins races.
const { OAuthTransformer } = await import('../oauth/oauth-transformer');

describe('OAuthTransformer', () => {
  beforeEach(() => {
    OAuthAuthManager.resetForTesting();
    vi.mocked(piAiModels.complete).mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      stopReason: 'stop',
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
      provider: 'anthropic',
      model: 'claude-test',
      timestamp: Date.now(),
    } as any);
    vi.mocked(piAiModels.stream).mockResolvedValue(
      (async function* () {
        // Empty default stream for tests that only assert request-side behavior.
      })() as any
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    OAuthAuthManager.resetForTesting();
  });

  test('skips proxy renaming for claude code agent headers', async () => {
    const authManager = OAuthAuthManager.getInstance();
    registerSpy(authManager, 'getApiKey').mockResolvedValue('sk-ant-oat-test');

    const transformer = new OAuthTransformer();
    const context = {
      tools: [{ name: 'MyTool' }],
      messages: [],
    };

    await transformer.executeRequest(
      context,
      'anthropic' as any,
      'claude-test',
      false,
      {
        clientHeaders: { 'x-app': 'cli' },
      },
      { authMode: 'oauth', accountId: 'test-account' }
    );

    expect(context.tools[0]?.name).toBe('MyTool');
  });

  test('proxies tool names for non-claude code agents', async () => {
    const authManager = OAuthAuthManager.getInstance();
    registerSpy(authManager, 'getApiKey').mockResolvedValue('sk-ant-oat-test');

    const transformer = new OAuthTransformer();
    const context = {
      tools: [{ name: 'MyTool' }],
      messages: [],
    };

    await transformer.executeRequest(
      context,
      'anthropic' as any,
      'claude-test',
      false,
      {},
      { authMode: 'oauth', accountId: 'test-account' }
    );

    expect(context.tools[0]?.name).toBe('proxy_MyTool');
  });

  test('uses direct API key for claude masking without OAuth auth manager', async () => {
    const authManager = OAuthAuthManager.getInstance();
    const getApiKeySpy = registerSpy(authManager, 'getApiKey');

    const transformer = new OAuthTransformer();
    const context = {
      tools: [{ name: 'MyTool' }],
      messages: [],
    };

    await transformer.executeRequest(
      context,
      'anthropic' as any,
      'claude-test',
      false,
      {},
      { authMode: 'apiKey', apiKey: 'sk-ant-api03-direct-test' }
    );

    expect(context.tools[0]?.name).toBe('proxy_MyTool');
    expect(getApiKeySpy).not.toHaveBeenCalled();
  });

  test('applies relocated Claude Code masking pipeline to outbound Anthropic OAuth payload', async () => {
    const authManager = OAuthAuthManager.getInstance();
    registerSpy(authManager, 'getApiKey').mockResolvedValue('sk-ant-oat-test');

    let capturedPayload: any;
    let capturedHeaders: Record<string, string | null> | undefined;

    vi.mocked(piAiModels.complete).mockImplementation(
      async (_model: any, _context: any, options: any) => {
        capturedHeaders = options.headers;
        const onPayload = options.onPayload as (payload: any) => any;
        capturedPayload = onPayload({
          model: 'claude-test',
          system: [{ type: 'text', text: 'opencode-specific system instructions' }],
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hello world' }] }],
          tools: [
            { name: 'github_search_users', input_schema: { type: 'object' } },
            { name: 'github_list_repos', input_schema: { type: 'object' } },
            { name: 'github_create_issue', input_schema: { type: 'object' } },
            { name: 'github_get_issue', input_schema: { type: 'object' } },
          ],
        });
        return {
          content: [{ type: 'text', text: 'ok' }],
          stopReason: 'stop',
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
          provider: 'anthropic',
          model: 'claude-test',
        } as any;
      }
    );

    const transformer = new OAuthTransformer();
    await transformer.executeRequest(
      { tools: [], messages: [] },
      'anthropic' as any,
      'claude-test',
      false,
      {
        clientHeaders: { 'x-app': 'cli' },
      },
      { authMode: 'oauth', accountId: 'test-account' }
    );

    expect(capturedHeaders?.['anthropic-beta']).toBe(REQUIRED_BETAS.join(','));
    expect(capturedHeaders?.['x-stainless-lang']).toBe('js');
    expect(capturedHeaders?.['user-agent']).toContain('claude-cli/');

    expect(capturedPayload.system[0]?.text).toMatch(/x-anthropic-billing-header:/);
    expect(capturedPayload.system[0]?.text).toMatch(/cch=(?!00000;)[0-9a-f]{5};/);
    expect(capturedPayload.system[1]?.text).toBe(
      "You are Claude Code, Anthropic's official CLI for Claude."
    );
    expect(capturedPayload.messages[0]?.content[0]?.text).toContain('<system-reminder>');
    expect(capturedPayload.tools.map((tool: any) => tool.name)).toContain(
      'mcp__github__search_users'
    );
    expect(capturedPayload.tools.map((tool: any) => tool.name)).toContain('Agent');
  });

  test('reverses relocated Claude Code tool renames on non-streaming responses', async () => {
    const authManager = OAuthAuthManager.getInstance();
    registerSpy(authManager, 'getApiKey').mockResolvedValue('sk-ant-oat-test');

    vi.mocked(piAiModels.complete).mockImplementation(
      async (_model: any, _context: any, options: any) => {
        const onPayload = options.onPayload as (payload: any) => any;
        onPayload({
          model: 'claude-test',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hello world' }] }],
          tools: [
            { name: 'github_search_users', input_schema: { type: 'object' } },
            { name: 'github_list_repos', input_schema: { type: 'object' } },
            { name: 'github_create_issue', input_schema: { type: 'object' } },
            { name: 'github_get_issue', input_schema: { type: 'object' } },
          ],
        });
        return {
          content: [
            {
              type: 'tool_use',
              name: 'mcp__github__search_users',
              input: {},
            },
          ],
          stopReason: 'tool_use',
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
          provider: 'anthropic',
          model: 'claude-test',
        } as any;
      }
    );

    const transformer = new OAuthTransformer();
    const result = await transformer.executeRequest(
      { tools: [], messages: [] },
      'anthropic' as any,
      'claude-test',
      false,
      {
        clientHeaders: { 'x-app': 'cli' },
      },
      { authMode: 'oauth', accountId: 'test-account' }
    );

    expect(result.content[0]?.name).toBe('github_search_users');
  });

  test('reverses relocated Claude Code tool renames on streaming response events', async () => {
    const authManager = OAuthAuthManager.getInstance();
    registerSpy(authManager, 'getApiKey').mockResolvedValue('sk-ant-oat-test');

    (vi.mocked(piAiModels.stream) as any).mockImplementation(
      (_model: any, _context: any, options: any) => {
        const onPayload = options.onPayload as (payload: any) => any;
        return (async function* () {
          onPayload({
            model: 'claude-test',
            messages: [{ role: 'user', content: [{ type: 'text', text: 'hello world' }] }],
            tools: [
              {
                name: 'Read',
                input_schema: { type: 'object', required: ['path'] },
              },
            ],
          });
          yield {
            type: 'toolcall_delta',
            contentIndex: 0,
            delta: '{}',
            partial: {
              provider: 'anthropic',
              model: 'claude-test',
              content: [
                {
                  type: 'toolCall',
                  id: 'toolu_test',
                  name: 'mcp__Read',
                  arguments: {},
                },
              ],
            },
          };
        })() as any;
      }
    );

    const transformer = new OAuthTransformer();
    const stream = (await transformer.executeRequest(
      { tools: [{ name: 'read' }], messages: [] },
      'anthropic' as any,
      'claude-test',
      true,
      {
        clientHeaders: { 'x-app': 'cli' },
      },
      { authMode: 'oauth', accountId: 'test-account' }
    )) as AsyncIterable<any>;

    const iterator = stream[Symbol.asyncIterator]();
    const first = await iterator.next();

    expect(first.value?.partial.content[0]?.name).toBe('read');
  });

  test('transformRequest normalises string assistant content to array blocks (issue #162)', async () => {
    // This is the direct unit-test counterpart of the dispatcher regression test in
    // dispatcher-oauth-passthrough.test.ts.  Before the fix, pass-through bypassed
    // transformRequest so string content reached pi-ai and caused
    // "assistantMsg.content.flatMap is not a function".
    //
    // We call transformRequest directly so we own the entire call stack and the
    // spy identity issue (setupFiles re-runs per file) doesn't apply.
    const transformer = new OAuthTransformer();

    const request = {
      model: 'claude-test',
      messages: [
        { role: 'user', content: 'Tell me a fun fact about the Roman Empire' },
        {
          role: 'assistant',
          // Plain string — exactly what OpenAI chat completions clients send
          content:
            'Roman concrete grows stronger over time because seawater reacts with volcanic ash.',
        },
        { role: 'user', content: 'why' },
      ],
      stream: false,
      incomingApiType: 'chat' as const,
      metadata: {
        plexus_metadata: {
          oauthProvider: 'anthropic',
          oauthAccount: 'test-account',
        },
      },
    } as any;

    const result = await transformer.transformRequest(request);

    // The context returned must have the assistant message content as an array.
    const assistantMsg = result.context?.messages?.find((m: any) => m.role === 'assistant') as any;
    expect(assistantMsg).toBeDefined();
    expect(Array.isArray(assistantMsg?.content)).toBe(true);
    expect(assistantMsg?.content[0]?.type).toBe('text');
    expect(assistantMsg?.content[0]?.text).toContain('Roman concrete');
  });

  test('throws enriched errors for pi-ai error envelope responses', async () => {
    const transformer = new OAuthTransformer();
    const piAiErrorResponse = {
      type: 'error',
      reason: 'error',
      error: {
        api: 'openai-codex-responses',
        provider: 'openai-codex',
        model: 'gpt-5.4',
        errorMessage: 'You have hit your ChatGPT usage limit (free plan). Try again in ~9725 min.',
      },
    };

    try {
      await transformer.transformResponse(piAiErrorResponse);
      throw new Error('expected transformResponse to fail');
    } catch (error: any) {
      expect(error.message).toContain('usage limit');
      expect(error.piAiResponse).toEqual(piAiErrorResponse);
    }
  });
});
