import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { setConfigForTesting } from '../../config';
import { OAuthAuthManager } from '../oauth/oauth-auth-manager';
import { registerSpy } from '../../../test/test-utils';
import type { UnifiedChatRequest } from '../../types/unified';

// Regression test for issue #162 (dispatcher-level):
//   a multi-turn conversation routed to Claude Code OAuth must succeed, not
//   throw, on the second turn.
//
// Original root cause was in the (now removed) pi-ai OAuth executor's IR
// conversion. There is now no executor: Anthropic OAuth runs
// natively through the standard path (native masked Messages body + raw-byte
// response). This test guards that the native path handles a multi-turn OAuth
// request end-to-end without error.

// @earendil-works/pi-ai is mocked globally in vitest.setup.ts.
const { Dispatcher } = await import('../dispatch/dispatcher');

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
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    OAuthAuthManager.resetForTesting();
    registerSpy(OAuthAuthManager.getInstance(), 'getApiKey').mockResolvedValue(
      'sk-ant-oat-fake-token-for-test'
    );
    // Native OAuth runs through the standard fetch path — mock the
    // upstream so no real network call is made. A minimal Anthropic Messages
    // non-streaming response body is enough to exercise the native path.
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: 'claude-test',
          content: [{ type: 'text', text: 'because' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    OAuthAuthManager.resetForTesting();
  });

  test('multi-turn request with string assistant content dispatches via the native path', async () => {
    // Native OAuth builds the Anthropic body via the native transformer (no
    // pi-ai Context IR / executor) and runs through the standard fetch path.
    setConfigForTesting(oauthConfigWithChatAccessVia());
    const dispatcher = new Dispatcher();

    await expect(dispatcher.dispatch(multiTurnChatRequest())).resolves.toBeDefined();

    // Confirm we actually hit the native Anthropic endpoint with the OAuth
    // Bearer token + CC fingerprint headers (not pi-ai's executor).
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-ant-oat-fake-token-for-test');
    expect(headers['anthropic-beta']).toBeTruthy();
    expect(headers['x-app']).toBe('cli');
  });
});
