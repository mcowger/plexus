import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { setConfigForTesting } from '../../config';
import { OAuthAuthManager } from '../oauth-auth-manager';
import { registerSpy } from '../../../test/test-utils';
import type { UnifiedChatRequest } from '../../types/unified';

// Regression test for issue #162:
//   "assistantMsg.content.flatMap is not a function" on the second turn of a
//   multi-turn conversation routed to Claude Code OAuth.
//
// Root cause: when the incoming request type matched the target's access_via
// (e.g. 'chat' → 'chat'), shouldUsePassThrough() returned true and bypassed
// OAuthTransformer.transformRequest(). The raw OpenAI body (with string
// assistant content) was then handed to pi-ai's stream()/complete(), and its
// internal transformMessages() crashed calling .flatMap on the string.
//
// Fix: pass-through must be disabled for pi-ai routes so the OAuth transformer's
// unifiedToContext() runs and normalizes string content to array blocks.

const completeMock = vi.fn(async (_model: any, _context: any, _options?: any) => ({
  content: [{ type: 'text', text: 'ok' }],
  stopReason: 'stop',
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
  provider: 'anthropic',
  model: 'claude-test',
  timestamp: Date.now(),
}));

const streamMock = vi.fn(async (_model: any, _context: any, _options?: any) => ({
  ok: true,
}));

vi.mock('@mariozechner/pi-ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mariozechner/pi-ai')>();
  return {
    ...actual,
    getModels: (_provider: string) => [{ id: 'claude-test', provider: 'anthropic' }],
    getModel: (_provider: string, modelId: string) => ({
      id: modelId,
      provider: 'anthropic',
      api: 'anthropic-messages',
    }),
    complete: completeMock,
    stream: streamMock,
  };
});

const { Dispatcher } = await import('../dispatcher');

function oauthConfigWithChatAccessVia() {
  return {
    providers: {
      Claude: {
        type: 'oauth',
        api_base_url: 'oauth://anthropic',
        oauth_provider: 'anthropic',
        oauth_account: 'test-account',
        models: {
          'claude-test': {
            pricing: { source: 'simple', input: 0, output: 0 },
            access_via: ['chat', 'messages'],
          },
        },
      },
    },
    models: {
      'test-alias': {
        targets: [{ provider: 'Claude', model: 'claude-test' }],
      },
    },
    keys: {},
  } as any;
}

function multiTurnChatRequest(): UnifiedChatRequest {
  // Replicates the exact shape OpenWebUI sends on turn 2: assistant content is
  // a plain string (per OpenAI chat completions spec).
  return {
    model: 'test-alias',
    messages: [
      { role: 'user', content: 'Tell me a fun fact about the Roman Empire' },
      {
        role: 'assistant',
        content:
          'Roman concrete grows stronger over time because seawater reacts with volcanic ash in the mix.',
      },
      { role: 'user', content: 'why' },
    ],
    stream: false,
    incomingApiType: 'chat',
    originalBody: {
      model: 'test-alias',
      stream: false,
      messages: [
        { role: 'user', content: 'Tell me a fun fact about the Roman Empire' },
        {
          role: 'assistant',
          content:
            'Roman concrete grows stronger over time because seawater reacts with volcanic ash in the mix.',
        },
        { role: 'user', content: 'why' },
      ],
    },
  };
}

describe('Dispatcher OAuth pass-through regression (issue #162)', () => {
  beforeEach(() => {
    completeMock.mockClear();
    streamMock.mockClear();
    OAuthAuthManager.resetForTesting();
    const authManager = OAuthAuthManager.getInstance();
    registerSpy(authManager, 'getApiKey').mockResolvedValue('sk-ant-oat-fake-token-for-test');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    OAuthAuthManager.resetForTesting();
  });

  test('OAuth route with chat access_via converts string assistant content to array before pi-ai', async () => {
    setConfigForTesting(oauthConfigWithChatAccessVia());
    const dispatcher = new Dispatcher();

    // Before the fix: dispatch rejected with
    //   "assistantMsg.content.flatMap is not a function"
    // from pi-ai's transformMessages, because pass-through handed the raw
    // OpenAI body (string content) straight to complete().
    const response = await dispatcher.dispatch(multiTurnChatRequest());
    expect(response).toBeDefined();

    // pi-ai complete() must have been called with a normalized pi-ai Context —
    // assistant messages must have content as an array of blocks, not a string.
    expect(completeMock).toHaveBeenCalledTimes(1);
    const context = completeMock.mock.calls[0]?.[1];
    expect(context).toBeDefined();
    expect(Array.isArray(context.messages)).toBe(true);

    const assistantMsg = context.messages.find((m: any) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect(Array.isArray(assistantMsg.content)).toBe(true);
    expect(assistantMsg.content.length).toBeGreaterThan(0);
    expect(assistantMsg.content[0].type).toBe('text');
    expect(assistantMsg.content[0].text).toContain('Roman concrete');
  });
});
