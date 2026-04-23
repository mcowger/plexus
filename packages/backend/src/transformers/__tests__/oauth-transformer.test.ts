import { afterEach, beforeEach, describe, expect, vi, test } from 'vitest';
import { registerSpy } from '../../../test/test-utils';
import { OAuthAuthManager } from '../../services/oauth-auth-manager';

// @mariozechner/pi-ai is mocked globally in vitest.setup.ts — do not add a
// per-file vi.mock() call here.  With isolate: false all files share one
// module registry and competing registrations create last-writer-wins races.
const { OAuthTransformer } = await import('../oauth/oauth-transformer');

describe('OAuthTransformer', () => {
  beforeEach(() => {
    OAuthAuthManager.resetForTesting();
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
