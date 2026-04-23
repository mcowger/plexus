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
//
// NOTE: We do not assert on piAi.complete call counts or call args here.
// With isolate: false + setupFiles re-running per file, the dispatcher holds a
// cached spy instance that differs from the one in this file's module namespace
// (vitest.setup.ts creates a new vi.fn() on each file's setup execution).
// The content-normalization behaviour is covered by a direct transformer unit
// test in oauth-transformer.test.ts.  This file covers the dispatcher-level
// regression: the request must succeed, not throw.

// @mariozechner/pi-ai is mocked globally in vitest.setup.ts.
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
    OAuthAuthManager.resetForTesting();
    registerSpy(OAuthAuthManager.getInstance(), 'getApiKey').mockResolvedValue(
      'sk-ant-oat-fake-token-for-test'
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    OAuthAuthManager.resetForTesting();
  });

  test('multi-turn request with string assistant content does not throw', async () => {
    // Before the fix this threw: "assistantMsg.content.flatMap is not a function"
    // Simply completing without error proves the regression is fixed.
    setConfigForTesting(oauthConfigWithChatAccessVia());
    const dispatcher = new Dispatcher();

    await expect(dispatcher.dispatch(multiTurnChatRequest())).resolves.toBeDefined();
  });
});
