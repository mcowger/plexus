import { afterEach, beforeEach, describe, expect, jest, mock, spyOn, test } from 'bun:test';

import { registerSpy } from '../../../test/test-utils';
import { setConfigForTesting } from '../../config';
import type { UnifiedChatRequest } from '../../types/unified';
import { OAuthAuthManager } from '../oauth/oauth-auth-manager';
import {
  applyChatGPTSignInBodyRules,
  genericOAuthApiType,
  prepareGenericOAuthDispatch,
} from '../oauth/oauth-native-request';
import * as catalog from '../pi-ai/catalog';

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

const getCatalogModel = mock();
const getCatalogModels = mock();

beforeEach(() => {
  spyOn(catalog, 'getCatalogModel').mockImplementation(getCatalogModel);
  spyOn(catalog, 'getCatalogModels').mockImplementation(getCatalogModels);
});

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
  afterEach(() => {
    getCatalogModel.mockReset();
    getCatalogModels.mockReset();
  });

  test('maps a pi-ai openai-completions model to the chat wire type', () => {
    getCatalogModel.mockReturnValue({ api: 'openai-completions' } as any);
    expect(genericOAuthApiType('xai', 'grok-test')).toBe('chat');
  });

  test('maps openai-responses / anthropic-messages models correctly', () => {
    getCatalogModel.mockReturnValue({ api: 'openai-responses' } as any);
    expect(genericOAuthApiType('xai', 'grok-4.5')).toBe('responses');
    getCatalogModel.mockReturnValue({ api: 'anthropic-messages' } as any);
    expect(genericOAuthApiType('some-provider', 'some-model')).toBe('messages');
  });

  test('returns undefined for an unknown model or unsupported wire api', () => {
    getCatalogModel.mockReturnValue(null);
    getCatalogModels.mockReturnValue([]);
    expect(genericOAuthApiType('xai', 'unknown-model')).toBeUndefined();
    getCatalogModel.mockReturnValue({ api: 'gemini' } as any);
    expect(genericOAuthApiType('some-provider', 'gemini-model')).toBeUndefined();
  });

  test('infers a missing model API from the provider catalog', () => {
    getCatalogModel.mockReturnValue(null);
    getCatalogModels.mockReturnValue([
      { api: 'openai-responses', baseUrl: 'https://api.x.ai/v1' },
      { api: 'openai-responses', baseUrl: 'https://api.x.ai/v1' },
    ] as any);

    expect(genericOAuthApiType('xai', 'grok-4.7')).toBe('responses');
  });

  test('does not infer an API when the provider catalog is ambiguous', () => {
    getCatalogModel.mockReturnValue(null);
    getCatalogModels.mockReturnValue([
      { api: 'openai-responses', baseUrl: 'https://api.x.ai/v1' },
      { api: 'openai-completions', baseUrl: 'https://api.x.ai/v1' },
    ] as any);

    expect(genericOAuthApiType('xai', 'grok-4.7')).toBeUndefined();
  });
});

describe('Generic OAuth dispatch (non-native providers, e.g. xai)', () => {
  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    getCatalogModel.mockReturnValue({
      id: 'grok-test',
      api: 'openai-completions',
      baseUrl: 'https://api.x.ai/v1',
    } as any);
    OAuthAuthManager.resetForTesting();
    registerSpy(OAuthAuthManager.getInstance(), 'getApiKey').mockResolvedValue(GENERIC_TOKEN);
    fetchSpy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(CHAT_COMPLETION_JSON, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    OAuthAuthManager.resetForTesting();
    getCatalogModel.mockReset();
    getCatalogModels.mockReset();
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

  test('uses a cataloged provider model API and base URL when the requested model is missing', async () => {
    getCatalogModel.mockReturnValue(null);
    getCatalogModels.mockReturnValue([
      {
        id: 'grok-4.5',
        api: 'openai-responses',
        baseUrl: 'https://api.x.ai/v1/',
      },
      {
        id: 'grok-4.6',
        api: 'openai-responses',
        baseUrl: 'https://api.x.ai/v1',
      },
    ] as any);

    const resolvedApi = genericOAuthApiType('xai', 'grok-4.7');
    expect(resolvedApi).toBe('responses');

    const prepared = await prepareGenericOAuthDispatch({
      provider: 'xai',
      modelId: 'grok-4.7',
      body: { model: 'grok-4.7' },
      streaming: false,
      apiType: resolvedApi!,
      oauthAccountId: 'test-account',
    });

    expect(prepared.url).toBe('https://api.x.ai/v1/responses');
    expect(prepared.body.model).toBe('grok-4.7');
  });

  test('raises a clear error when the model has no known wire API, instead of mis-routing', async () => {
    getCatalogModel.mockReturnValue({ id: 'grok-test', api: 'gemini' } as any);
    setConfigForTesting(genericOAuthConfig());
    await expect(new Dispatcher().dispatch(chatRequest())).rejects.toThrow(/wire API/i);
  });
});

describe('Sign in with ChatGPT (the `openai` OAuth provider) body rules', () => {
  test('forces the subscription request shape and drops API-key-only fields', () => {
    const wire = applyChatGPTSignInBodyRules({
      model: 'gpt-6-luna',
      store: true,
      stream: false,
      prompt_cache_retention: '24h',
      prompt_cache_options: { mode: 'explicit' },
      temperature: 0.4,
      max_output_tokens: 512,
      instructions: 'be brief',
    });

    expect(wire.store).toBe(false);
    expect(wire.stream).toBe(true); // ChatGPT-subscription tokens are stream-only
    expect(wire).not.toHaveProperty('prompt_cache_retention');
    expect(wire).not.toHaveProperty('prompt_cache_options');
    expect(wire).not.toHaveProperty('temperature');
    expect(wire).not.toHaveProperty('max_output_tokens');
    // Everything else the caller sent survives.
    expect(wire.instructions).toBe('be brief');
    expect(wire.model).toBe('gpt-6-luna');
  });

  test('applies the rules to an openai responses request but not to other OAuth providers', async () => {
    OAuthAuthManager.resetForTesting();
    registerSpy(OAuthAuthManager.getInstance(), 'getApiKey').mockResolvedValue(GENERIC_TOKEN);
    getCatalogModel.mockReturnValue({
      id: 'gpt-6-luna',
      api: 'openai-responses',
      baseUrl: 'https://api.openai.com/v1',
    } as any);

    const prepared = await prepareGenericOAuthDispatch({
      provider: 'openai',
      modelId: 'gpt-6-luna',
      body: { model: 'gpt-6-luna', store: true, stream: false },
      streaming: false,
      apiType: 'responses',
      oauthAccountId: 'cgpt',
    });

    expect(prepared.url).toBe('https://api.openai.com/v1/responses');
    expect(prepared.body.store).toBe(false);
    expect(prepared.body.stream).toBe(true);

    // A non-ChatGPT generic provider keeps its body byte-identical.
    const other = await prepareGenericOAuthDispatch({
      provider: 'xai',
      modelId: 'grok-test',
      body: { model: 'grok-test', store: true, stream: false },
      streaming: false,
      apiType: 'responses',
      oauthAccountId: 'test-account',
    });
    expect(other.body.store).toBe(true);
    expect(other.body.stream).toBe(false);
  });
});
