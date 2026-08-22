import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { setConfigForTesting } from '../../config';
import { OAuthAuthManager } from '../oauth/oauth-auth-manager';
import { genericOAuthApiType } from '../oauth/oauth-native-request';
import { registerSpy } from '../../../test/test-utils';
import type { UnifiedChatRequest } from '../../types/unified';

// Generic OAuth dispatch — every pi-ai OAuth provider that ISN'T one of the
// hand-ported native providers (Anthropic/Codex/Copilot). These are plain
// Bearer-token OAuth providers speaking a standard wire API; the only things
// that differ from an ordinary API-key provider are the real Bearer token
// (resolved via OAuthAuthManager instead of a static api_key) and the real
// upstream URL (from pi-ai's model registry instead of the `oauth://`
// placeholder). No masking, no tool renames, no per-provider body work.
//
// Regression coverage for: config validation accepts any pi-ai OAuth
// provider (see oauth-providers.ts), but dispatch used to recognize only the
// 3 native providers and reject everything else as "not supported" — so a
// configured-and-logged-in xai/kimi-coding/openrouter route would fail on
// every actual inference request.

vi.mock('../pi-ai/catalog', () => ({
  getCatalogModel: vi.fn(),
}));

const { getCatalogModel } = await import('../pi-ai/catalog');
const { Dispatcher } = await import('../dispatch/dispatcher');

const GENERIC_TOKEN = 'oauth-access-token-for-test';

// A minimal OpenAI chat.completion response.
const CHAT_COMPLETION_JSON = JSON.stringify({
  id: 'chatcmpl-1',
  object: 'chat.completion',
  model: 'grok-test',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'hello from grok' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
});

function genericOAuthConfig() {
  return {
    providers: {
      Xai: {
        type: 'oauth',
        api_base_url: 'oauth://',
        oauth_provider: 'xai',
        oauth_account: 'test-account',
        models: {
          // Empty access_via mirrors real deployments: the API type is
          // inferred from the `oauth://` URL as the synthetic 'oauth' type,
          // resolved for real by genericOAuthApiType at dispatch time.
          'grok-test': { pricing: { source: 'simple', input: 0, output: 0 }, access_via: [] },
        },
      },
    },
    models: {
      'grok-alias': { targets: [{ provider: 'Xai', model: 'grok-test' }] },
    },
    keys: {},
  } as any;
}

function chatRequest(): UnifiedChatRequest {
  const body = {
    model: 'grok-alias',
    stream: false,
    messages: [{ role: 'user', content: 'hi' }],
  };
  return {
    model: 'grok-alias',
    messages: [{ role: 'user', content: 'hi' }],
    stream: false,
    incomingApiType: 'chat',
    originalBody: body,
  } as any;
}

describe('genericOAuthApiType', () => {
  afterEach(() => vi.mocked(getCatalogModel).mockReset());

  test('maps a pi-ai openai-completions model to the chat wire type', () => {
    vi.mocked(getCatalogModel).mockReturnValue({ api: 'openai-completions' } as any);
    expect(genericOAuthApiType('xai', 'grok-test')).toBe('chat');
  });

  test('maps openai-responses / anthropic-messages models correctly', () => {
    vi.mocked(getCatalogModel).mockReturnValue({ api: 'openai-responses' } as any);
    expect(genericOAuthApiType('xai', 'grok-4.5')).toBe('responses');
    vi.mocked(getCatalogModel).mockReturnValue({ api: 'anthropic-messages' } as any);
    expect(genericOAuthApiType('some-provider', 'some-model')).toBe('messages');
  });

  test('returns undefined for an unknown model or unsupported wire api', () => {
    vi.mocked(getCatalogModel).mockReturnValue(null);
    expect(genericOAuthApiType('xai', 'unknown-model')).toBeUndefined();
    vi.mocked(getCatalogModel).mockReturnValue({ api: 'gemini' } as any);
    expect(genericOAuthApiType('some-provider', 'gemini-model')).toBeUndefined();
  });
});

describe('Generic OAuth dispatch (non-native providers, e.g. xai)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(getCatalogModel).mockReturnValue({
      id: 'grok-test',
      api: 'openai-completions',
      baseUrl: 'https://api.x.ai/v1',
    } as any);
    OAuthAuthManager.resetForTesting();
    registerSpy(OAuthAuthManager.getInstance(), 'getApiKey').mockResolvedValue(GENERIC_TOKEN);
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(CHAT_COMPLETION_JSON, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    OAuthAuthManager.resetForTesting();
    vi.mocked(getCatalogModel).mockReset();
  });

  test('does NOT throw "OAuth provider is not supported" — dispatches successfully', async () => {
    setConfigForTesting(genericOAuthConfig());
    const response = await new Dispatcher().dispatch(chatRequest());
    expect(response).toBeDefined();
  });

  test("posts to pi-ai's registry baseUrl + the resolved wire endpoint, with a real Bearer token", async () => {
    setConfigForTesting(genericOAuthConfig());
    await new Dispatcher().dispatch(chatRequest());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as any[];
    expect(url).toBe('https://api.x.ai/v1/chat/completions');
    expect(init.headers['Authorization']).toBe(`Bearer ${GENERIC_TOKEN}`);

    // Resolved target model, not the alias — same convention as native OAuth.
    const sent = JSON.parse(init.body);
    expect(sent.model).toBe('grok-test');
    expect(sent.model).not.toBe('grok-alias');
  });

  test('resolves the OAuth token via OAuthAuthManager, not a static api_key', async () => {
    setConfigForTesting(genericOAuthConfig());
    const getApiKeySpy = registerSpy(OAuthAuthManager.getInstance(), 'getApiKey');
    await new Dispatcher().dispatch(chatRequest());
    expect(getApiKeySpy).toHaveBeenCalledWith('xai', 'test-account');
  });

  test('raises a clear error when the model has no known wire API, instead of mis-routing', async () => {
    vi.mocked(getCatalogModel).mockReturnValue({ id: 'grok-test', api: 'gemini' } as any);
    setConfigForTesting(genericOAuthConfig());
    await expect(new Dispatcher().dispatch(chatRequest())).rejects.toThrow(/wire API/i);
  });
});
