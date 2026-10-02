import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { registerSpy } from '../../../test/test-utils';
import { Dispatcher } from '../dispatch/dispatcher';
import { ProviderConfigSchema } from '../../config';
import { applyQuirkOverlay, applyRegistryAutoCompat } from '../dispatch/dispatcher-auto-compat';
import * as piAiRegistry from '../pi-ai/registry';
import { logger } from '../../utils/logger';
import type { RouteResult } from '../routing/router';
import type { UnifiedChatRequest } from '../../types/unified';

function route(overrides: Partial<RouteResult> = {}): RouteResult {
  return {
    provider: 'test-provider',
    model: 'provider-model',
    config: {
      api_base_url: 'https://example.test/v1',
      api_key: 'test-key',
      auto_compat: true,
      pi_ai_provider: 'openai',
    } as any,
    modelConfig: {
      pricing: { source: 'simple', input: 0, output: 0 },
      pi_ai_model_id: 'registry-model',
    } as any,
    ...overrides,
  };
}

function request(overrides: Partial<UnifiedChatRequest> = {}): UnifiedChatRequest {
  return {
    model: 'alias-model',
    messages: [{ role: 'user', content: 'hello' }],
    incomingApiType: 'chat',
    ...overrides,
  };
}

function piModel(overrides: Record<string, any> = {}) {
  return {
    id: 'registry-model',
    provider: 'openai',
    api: 'openai-completions',
    reasoning: true,
    thinkingLevelMap: { off: 'none', low: 'low', medium: 'medium', high: 'high' },
    compat: { supportsReasoningEffort: true, supportsTemperature: true },
    maxTokens: 4096,
    ...overrides,
  } as any;
}

describe('Dispatcher registry auto-compat', () => {
  beforeEach(() => {
    registerSpy(piAiRegistry, 'resolvePiAiModel').mockReturnValue(piModel());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('applies registry reasoning fields on the passthrough path', async () => {
    const dispatcher = new Dispatcher() as any;

    const result = await dispatcher.transformRequestPayload(
      request({
        originalBody: {
          model: 'alias-model',
          messages: [{ role: 'user', content: 'hello' }],
          reasoning_effort: 'medium',
        },
      }),
      route(),
      { transformRequest: vi.fn() },
      'chat',
      []
    );

    expect(result.bypassTransformation).toBe(true);
    expect(result.payload.model).toBe('provider-model');
    expect(result.payload.reasoning_effort).toBe('medium');
  });

  test('applies registry reasoning fields on the transformed Anthropic path', async () => {
    vi.mocked(piAiRegistry.resolvePiAiModel).mockReturnValue(
      piModel({
        api: 'anthropic-messages',
        provider: 'anthropic',
        compat: { supportsTemperature: true },
      })
    );
    const dispatcher = new Dispatcher() as any;

    const result = await dispatcher.transformRequestPayload(
      request({
        reasoning: { effort: 'high', enabled: true },
        temperature: 0.7,
      }),
      route({
        config: {
          api_base_url: 'https://api.anthropic.com',
          api_key: 'test-key',
          auto_compat: true,
          pi_ai_provider: 'anthropic',
        } as any,
      }),
      {
        transformRequest: vi.fn(async () => ({
          model: 'provider-model',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
          max_tokens: 4096,
          temperature: 0.7,
        })),
      },
      'messages',
      []
    );

    expect(result.bypassTransformation).toBe(false);
    expect(result.payload.thinking).toEqual({
      type: 'enabled',
      budget_tokens: 16384,
      display: 'summarized',
    });
    expect(result.payload.temperature).toBeUndefined();
  });

  test('clamps minimal effort to low for Anthropic adaptive thinking models', async () => {
    vi.mocked(piAiRegistry.resolvePiAiModel).mockReturnValue(
      piModel({
        api: 'anthropic-messages',
        provider: 'anthropic',
        compat: { forceAdaptiveThinking: true },
      })
    );
    const dispatcher = new Dispatcher() as any;

    const result = await dispatcher.transformRequestPayload(
      request({
        reasoning: { effort: 'minimal', enabled: true },
      }),
      route({
        config: {
          api_base_url: 'https://api.anthropic.com',
          api_key: 'test-key',
          auto_compat: true,
          pi_ai_provider: 'anthropic',
        } as any,
      }),
      {
        transformRequest: vi.fn(async () => ({
          model: 'provider-model',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
          max_tokens: 4096,
        })),
      },
      'messages',
      []
    );

    expect(result.payload.thinking).toEqual({
      type: 'adaptive',
      display: 'summarized',
    });
    expect(result.payload.output_config).toEqual({ effort: 'low' });
  });

  test('clamps disabled thinking to adaptive with low effort for Opus 5 cannot-disable model', async () => {
    vi.mocked(piAiRegistry.resolvePiAiModel).mockReturnValue(
      piModel({
        id: 'claude-opus-5',
        api: 'anthropic-messages',
        provider: 'anthropic',
        thinkingLevelMap: { off: null, xhigh: 'xhigh', max: 'max' },
        compat: { forceAdaptiveThinking: true },
      })
    );
    const dispatcher = new Dispatcher() as any;

    const result = await dispatcher.transformRequestPayload(
      request({
        reasoning: { enabled: false },
      }),
      route({
        model: 'claude-opus-5',
        config: {
          api_base_url: 'https://api.anthropic.com',
          api_key: 'test-key',
          auto_compat: true,
          pi_ai_provider: 'anthropic',
        } as any,
      }),
      {
        transformRequest: vi.fn(async () => ({
          model: 'claude-opus-5',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
          max_tokens: 4096,
        })),
      },
      'messages',
      []
    );

    expect(result.payload.thinking).toEqual({
      type: 'adaptive',
      display: 'summarized',
    });
    expect(result.payload.output_config).toEqual({ effort: 'low' });
  });

  test('maps transformed payload output_config.effort off to disabled thinking on supported model', async () => {
    vi.mocked(piAiRegistry.resolvePiAiModel).mockReturnValue(
      piModel({
        id: 'claude-sonnet-4-6',
        api: 'anthropic-messages',
        provider: 'anthropic',
        compat: { forceAdaptiveThinking: true },
      })
    );
    const dispatcher = new Dispatcher() as any;

    const result = await dispatcher.transformRequestPayload(
      request({}),
      route({
        model: 'claude-sonnet-4-6',
        config: {
          api_base_url: 'https://api.anthropic.com',
          api_key: 'test-key',
          auto_compat: true,
          pi_ai_provider: 'anthropic',
        } as any,
      }),
      {
        transformRequest: vi.fn(async () => ({
          model: 'claude-sonnet-4-6',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
          max_tokens: 4096,
          output_config: { effort: 'off' },
        })),
      },
      'messages',
      []
    );

    expect(result.payload.thinking).toEqual({ type: 'disabled' });
    expect(result.payload.output_config).toBeUndefined();
  });

  test('clamps transformed payload output_config.effort off to adaptive low effort on Opus 5', async () => {
    vi.mocked(piAiRegistry.resolvePiAiModel).mockReturnValue(
      piModel({
        id: 'claude-opus-5',
        api: 'anthropic-messages',
        provider: 'anthropic',
        thinkingLevelMap: { off: null, xhigh: 'xhigh', max: 'max' },
        compat: { forceAdaptiveThinking: true },
      })
    );
    const dispatcher = new Dispatcher() as any;

    const result = await dispatcher.transformRequestPayload(
      request({}),
      route({
        model: 'claude-opus-5',
        config: {
          api_base_url: 'https://api.anthropic.com',
          api_key: 'test-key',
          auto_compat: true,
          pi_ai_provider: 'anthropic',
        } as any,
      }),
      {
        transformRequest: vi.fn(async () => ({
          model: 'claude-opus-5',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
          max_tokens: 4096,
          output_config: { effort: 'off' },
        })),
      },
      'messages',
      []
    );

    expect(result.payload.thinking).toEqual({ type: 'adaptive' });
    expect(result.payload.output_config).toEqual({ effort: 'low' });
  });

  test('applies inline chat quirks by exact upstream model without pi-ai IDs', async () => {
    const dispatcher = new Dispatcher() as any;
    const config = {
      api_base_url: { chat: 'https://example.test/v1', responses: 'https://example.test/v1' },
      api_key: 'test-key',
      auto_compat: true,
      pi_ai_quirks: {
        chat: {
          api: 'openai-completions',
          reasoning: true,
          thinkingLevelMap: { off: 'none', high: 'high' },
          compat: {
            thinkingFormat: 'openrouter',
            maxTokensField: 'max_completion_tokens',
            supportsTemperature: false,
          },
          models: {
            'upstream/special': {
              thinkingLevelMap: { high: 'hard' },
              compat: { supportsTemperature: true },
              maxTokens: 64,
            },
          },
        },
        responses: { api: 'openai-responses', maxTokens: 128 },
      },
    } as any;
    const originalBody = {
      model: 'alias-model',
      messages: [{ role: 'user', content: 'hello' }],
      reasoning: { effort: 'high' },
      temperature: 0.4,
      max_tokens: 256,
    };
    const dispatch = (model: string, targetApiType = 'chat') =>
      dispatcher.transformRequestPayload(
        request({ originalBody }),
        route({
          model,
          config,
          modelConfig: { pricing: { source: 'simple', input: 0, output: 0 } } as any,
        }),
        { transformRequest: vi.fn(async () => ({ ...originalBody, model })) },
        targetApiType,
        []
      );

    const special = (await dispatch('upstream/special')).payload;
    expect(special).toMatchObject({
      model: 'upstream/special',
      max_completion_tokens: 64,
      reasoning: { effort: 'hard' },
      temperature: 0.4,
    });
    expect(special.max_tokens).toBeUndefined();
    const other = (await dispatch('upstream/other')).payload;
    expect(other).toMatchObject({
      max_completion_tokens: 256,
      reasoning: { effort: 'high' },
    });
    expect(other.temperature).toBeUndefined();
    const responses = (await dispatch('upstream/special', 'responses')).payload;
    expect(responses.max_output_tokens).toBe(128);
    expect(responses.max_completion_tokens).toBeUndefined();
    expect(piAiRegistry.resolvePiAiModel).not.toHaveBeenCalled();
  });

  test('model reasoning:false removes inherited map without suppressing unrelated quirks', async () => {
    const body = {
      model: 'alias-model',
      messages: [{ role: 'user', content: 'hello' }],
      reasoning: { effort: 'high' },
      max_tokens: 256,
      temperature: 0.5,
    };
    const config = ProviderConfigSchema.parse({
      api_base_url: { chat: 'https://example.test/v1' },
      api_key: 'test-key',
      auto_compat: true,
      pi_ai_quirks: {
        chat: {
          api: 'openai-completions',
          reasoning: true,
          thinkingLevelMap: { high: 'mapped' },
          compat: { maxTokensField: 'max_completion_tokens', thinkingFormat: 'openrouter' },
          models: {
            'upstream/no-reasoning': { reasoning: false, compat: { supportsTemperature: false } },
          },
        },
      },
    });
    const dispatch = (model: string) =>
      applyRegistryAutoCompat(
        { ...body, model },
        request({ originalBody: body }),
        route({ model, config, modelConfig: undefined }),
        'chat'
      );

    const disabled = dispatch('upstream/no-reasoning');
    expect(disabled).toMatchObject({
      model: 'upstream/no-reasoning',
      reasoning: { effort: 'high' },
      max_completion_tokens: 256,
    });
    expect(disabled.reasoning_effort).toBeUndefined();
    expect(disabled.temperature).toBeUndefined();
    expect(disabled.max_tokens).toBeUndefined();

    const unknown = dispatch('upstream/unknown');
    expect(unknown).toMatchObject({
      reasoning: { effort: 'mapped' },
      max_completion_tokens: 256,
      temperature: 0.5,
    });
    expect(unknown.reasoning_effort).toBeUndefined();
  });

  test('does not infer Anthropic limits from an inline model name without declared traits', () => {
    const payload = {
      model: 'claude-opus-5',
      messages: [{ role: 'user', content: 'hello' }],
      thinking: { type: 'disabled' },
      output_config: { effort: 'off' },
    };
    const config = ProviderConfigSchema.parse({
      api_base_url: { messages: 'https://example.test/v1' },
      api_key: 'test-key',
      auto_compat: true,
      pi_ai_quirks: { messages: { api: 'anthropic-messages' } },
    });

    const outbound = applyRegistryAutoCompat(
      payload,
      request({ incomingApiType: 'messages', originalBody: payload }),
      route({ model: 'claude-opus-5', config, modelConfig: undefined }),
      'messages'
    );
    expect(outbound).toBe(payload);
    expect(outbound.thinking).toEqual({ type: 'disabled' });
    expect(outbound.output_config).toEqual({ effort: 'off' });
  });

  test('leaves inline requests unchanged when auto-compat is off or no traits match target', async () => {
    const payload = {
      model: 'alias-model',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 256,
      temperature: 0.4,
    };
    const config = {
      api_base_url: 'https://example.test/v1',
      api_key: 'test-key',
      pi_ai_quirks: {
        chat: { api: 'openai-completions', compat: { maxTokensField: 'max_completion_tokens' } },
      },
    } as any;
    const transformer = { transformRequest: vi.fn(async () => payload) };
    const dispatch = (
      auto_compat: boolean,
      targetApiType: string,
      quirks?: typeof config.pi_ai_quirks
    ) =>
      (new Dispatcher() as any).transformRequestPayload(
        request({ originalBody: payload }),
        route({ config: { ...config, pi_ai_quirks: quirks, auto_compat }, modelConfig: undefined }),
        transformer,
        targetApiType,
        []
      );
    expect((await dispatch(false, 'chat', config.pi_ai_quirks)).payload.max_tokens).toBe(256);
    expect((await dispatch(true, 'messages', config.pi_ai_quirks)).payload.max_tokens).toBe(256);
    expect((await dispatch(true, 'chat', undefined)).payload.max_tokens).toBe(256);
    expect(piAiRegistry.resolvePiAiModel).not.toHaveBeenCalled();
  });

  test('resolves the exact route model when the provider is selected but unlinked', async () => {
    const dispatcher = new Dispatcher() as any;

    const result = await dispatcher.transformRequestPayload(
      request({
        originalBody: {
          model: 'alias-model',
          messages: [{ role: 'user', content: 'hello' }],
          reasoning_effort: 'high',
        },
      }),
      route({
        model: 'provider-model',
        modelConfig: { pricing: { source: 'simple', input: 0, output: 0 } } as any,
      }),
      { transformRequest: vi.fn() },
      'chat',
      []
    );

    expect(result.payload.reasoning_effort).toBe('high');
    // Provider selected but model unlinked: the catalog lookup uses the exact
    // upstream model, matching GET /v1/models' automatic identity.
    expect(piAiRegistry.resolvePiAiModel).toHaveBeenCalledWith('openai', 'provider-model');
  });

  test('does not borrow the route model when an explicit pi_ai_model_id link is invalid', async () => {
    vi.mocked(piAiRegistry.resolvePiAiModel).mockReturnValue(null);
    const config = ProviderConfigSchema.parse({
      api_base_url: { chat: 'https://example.test/v1' },
      api_key: 'test-key',
      auto_compat: true,
      pi_ai_provider: 'openai',
      pi_ai_quirks: {
        chat: { api: 'openai-completions', compat: { maxTokensField: 'max_completion_tokens' } },
      },
    });

    const outbound = applyRegistryAutoCompat(
      {
        model: 'upstream/model',
        messages: [],
        max_tokens: 256,
      },
      request({
        originalBody: { model: 'upstream/model', messages: [], max_tokens: 256 },
      }),
      route({
        model: 'upstream/model',
        config,
        modelConfig: {
          pricing: { source: 'simple', input: 0, output: 0 },
          pi_ai_model_id: 'missing-catalog-model',
        } as any,
      }),
      'chat'
    );

    // The explicit but unresolved link stays invalid; only the explicit quirks
    // apply, and no `route.model` catalog lookup happens.
    expect(piAiRegistry.resolvePiAiModel).toHaveBeenCalledTimes(1);
    expect(piAiRegistry.resolvePiAiModel).toHaveBeenCalledWith('openai', 'missing-catalog-model');
    expect(outbound.max_completion_tokens).toBe(256);
  });

  test('drops temperature when registry compat marks it unsupported', async () => {
    vi.mocked(piAiRegistry.resolvePiAiModel).mockReturnValue(
      piModel({
        reasoning: false,
        compat: { supportsTemperature: false },
      })
    );
    const dispatcher = new Dispatcher() as any;

    const result = await dispatcher.transformRequestPayload(
      request({
        originalBody: {
          model: 'alias-model',
          messages: [{ role: 'user', content: 'hello' }],
          temperature: 0.5,
        },
      }),
      route(),
      { transformRequest: vi.fn() },
      'chat',
      []
    );

    expect(result.payload.temperature).toBeUndefined();
  });

  test('model-level auto_compat enables compat when provider-level is off', async () => {
    const dispatcher = new Dispatcher() as any;

    const result = await dispatcher.transformRequestPayload(
      request({
        originalBody: {
          model: 'alias-model',
          messages: [{ role: 'user', content: 'hello' }],
          reasoning_effort: 'low',
        },
      }),
      route({
        config: {
          api_base_url: 'https://example.test/v1',
          api_key: 'test-key',
          auto_compat: false,
          pi_ai_provider: 'openai',
        } as any,
        modelConfig: {
          pricing: { source: 'simple', input: 0, output: 0 },
          auto_compat: true,
          pi_ai_model_id: 'registry-model',
        } as any,
      }),
      { transformRequest: vi.fn() },
      'chat',
      []
    );

    expect(result.payload.reasoning_effort).toBe('low');
  });

  test('translates a client-sent reasoning object to reasoning_effort on the default format', async () => {
    // Strict OpenAI-compatible upstreams (e.g. the Meta Model API) hard-400 on
    // the Responses-style `reasoning` object; the projection must emit ONLY the
    // translated `reasoning_effort` and strip the leftover object.
    const dispatcher = new Dispatcher() as any;

    const result = await dispatcher.transformRequestPayload(
      request({
        originalBody: {
          model: 'alias-model',
          messages: [{ role: 'user', content: 'hello' }],
          reasoning: { effort: 'high' },
        },
      }),
      route(),
      { transformRequest: vi.fn() },
      'chat',
      []
    );

    expect(result.payload.reasoning).toBeUndefined();
    expect(result.payload.reasoning_effort).toBe('high');
  });

  test('openrouter format emits the reasoning object and strips stale reasoning_effort', async () => {
    vi.mocked(piAiRegistry.resolvePiAiModel).mockReturnValue(
      piModel({ compat: { supportsReasoningEffort: true, thinkingFormat: 'openrouter' } })
    );
    const dispatcher = new Dispatcher() as any;

    const result = await dispatcher.transformRequestPayload(
      request({
        originalBody: {
          model: 'alias-model',
          messages: [{ role: 'user', content: 'hello' }],
          reasoning_effort: 'medium',
        },
      }),
      route({ provider: 'openrouter' }),
      { transformRequest: vi.fn() },
      'chat',
      []
    );

    expect(result.payload.reasoning).toEqual({ effort: 'medium' });
    expect(result.payload.reasoning_effort).toBeUndefined();
  });

  test('qwen format translates to enable_thinking and strips both OpenAI-style notations', async () => {
    vi.mocked(piAiRegistry.resolvePiAiModel).mockReturnValue(
      piModel({ compat: { supportsReasoningEffort: true, thinkingFormat: 'qwen' } })
    );
    const dispatcher = new Dispatcher() as any;

    const result = await dispatcher.transformRequestPayload(
      request({
        originalBody: {
          model: 'alias-model',
          messages: [{ role: 'user', content: 'hello' }],
          reasoning: { effort: 'low' },
          reasoning_effort: 'low',
        },
      }),
      route(),
      { transformRequest: vi.fn() },
      'chat',
      []
    );

    expect(result.payload.enable_thinking).toBe(true);
    expect(result.payload.reasoning).toBeUndefined();
    expect(result.payload.reasoning_effort).toBeUndefined();
  });

  test('strips stale reasoning_effort when the dialect cannot express it (zai)', async () => {
    // zai with supportsReasoningEffort=false: the intent lands on `thinking`
    // alone, and the client's untranslated `reasoning_effort` must be REMOVED
    // — leaving it would resend an unsupported field to the strict upstream.
    vi.mocked(piAiRegistry.resolvePiAiModel).mockReturnValue(
      piModel({ compat: { supportsReasoningEffort: false, thinkingFormat: 'zai' } })
    );
    const dispatcher = new Dispatcher() as any;

    const result = await dispatcher.transformRequestPayload(
      request({
        originalBody: {
          model: 'alias-model',
          messages: [{ role: 'user', content: 'hello' }],
          reasoning_effort: 'medium',
        },
      }),
      route(),
      { transformRequest: vi.fn() },
      'chat',
      []
    );

    expect(result.payload.thinking).toEqual({ type: 'enabled', clear_thinking: false });
    expect(result.payload.reasoning_effort).toBeUndefined();
    expect(result.payload.reasoning).toBeUndefined();
  });

  test('ant-ling drops the unified reasoning notation when the intent is a disable it cannot express', async () => {
    vi.mocked(piAiRegistry.resolvePiAiModel).mockReturnValue(
      piModel({ compat: { supportsReasoningEffort: true, thinkingFormat: 'ant-ling' } })
    );
    const dispatcher = new Dispatcher() as any;

    const result = await dispatcher.transformRequestPayload(
      request({
        originalBody: {
          model: 'alias-model',
          messages: [{ role: 'user', content: 'hello' }],
          reasoning: { enabled: false },
        },
      }),
      route(),
      { transformRequest: vi.fn() },
      'chat',
      []
    );

    expect(result.payload.reasoning).toBeUndefined();
    expect(result.payload.reasoning_effort).toBeUndefined();
  });

  test('ant-ling emits its own reasoning object and strips reasoning_effort when enabled', async () => {
    vi.mocked(piAiRegistry.resolvePiAiModel).mockReturnValue(
      piModel({ compat: { supportsReasoningEffort: true, thinkingFormat: 'ant-ling' } })
    );
    const dispatcher = new Dispatcher() as any;

    const result = await dispatcher.transformRequestPayload(
      request({
        originalBody: {
          model: 'alias-model',
          messages: [{ role: 'user', content: 'hello' }],
          reasoning_effort: 'high',
        },
      }),
      route(),
      { transformRequest: vi.fn() },
      'chat',
      []
    );

    expect(result.payload.reasoning).toEqual({ effort: 'high' });
    expect(result.payload.reasoning_effort).toBeUndefined();
  });

  test('default format passes the client reasoning_effort through when support is unknown', async () => {
    // compat.supportsReasoningEffort is undefined (unknown, not false): the
    // default dialect natively speaks reasoning_effort, so an untranslatable
    // client value passes through instead of being silently dropped.
    vi.mocked(piAiRegistry.resolvePiAiModel).mockReturnValue(
      piModel({
        thinkingLevelMap: {},
        compat: {},
      })
    );
    const dispatcher = new Dispatcher() as any;

    const result = await dispatcher.transformRequestPayload(
      request({
        originalBody: {
          model: 'alias-model',
          messages: [{ role: 'user', content: 'hello' }],
          reasoning_effort: 'medium',
        },
      }),
      route(),
      { transformRequest: vi.fn() },
      'chat',
      []
    );

    expect(result.payload.reasoning_effort).toBe('medium');
    expect(result.payload.reasoning).toBeUndefined();
  });

  test('default format strips reasoning_effort when the dialect provably lacks support', async () => {
    vi.mocked(piAiRegistry.resolvePiAiModel).mockReturnValue(
      piModel({
        thinkingLevelMap: {},
        compat: { supportsReasoningEffort: false },
      })
    );
    const dispatcher = new Dispatcher() as any;

    const result = await dispatcher.transformRequestPayload(
      request({
        originalBody: {
          model: 'alias-model',
          messages: [{ role: 'user', content: 'hello' }],
          reasoning_effort: 'medium',
        },
      }),
      route(),
      { transformRequest: vi.fn() },
      'chat',
      []
    );

    expect(result.payload.reasoning_effort).toBeUndefined();
    expect(result.payload.reasoning).toBeUndefined();
  });

  test('default format drops stale reasoning_effort that contradicts a recognized reasoning object', async () => {
    // Client sent BOTH fields with conflicting values: reasoning.enabled=false
    // is authoritative (checked before reasoning_effort), so after deleting the
    // reasoning object the surviving 'high' effort would reverse the intent.
    vi.mocked(piAiRegistry.resolvePiAiModel).mockReturnValue(piModel({ compat: {} }));
    const dispatcher = new Dispatcher() as any;

    const result = await dispatcher.transformRequestPayload(
      request({
        originalBody: {
          model: 'alias-model',
          messages: [{ role: 'user', content: 'hello' }],
          reasoning: { enabled: false },
          reasoning_effort: 'high',
        },
      }),
      route(),
      { transformRequest: vi.fn() },
      'chat',
      []
    );

    expect(result.payload.reasoning).toBeUndefined();
    expect(result.payload.reasoning_effort).toBeUndefined();
  });

  test('default format drops stale reasoning_effort when null reasoning falls back to request intent', async () => {
    vi.mocked(piAiRegistry.resolvePiAiModel).mockReturnValue(piModel({ compat: {} }));
    const dispatcher = new Dispatcher() as any;

    const result = await dispatcher.transformRequestPayload(
      request({
        reasoning: { enabled: false },
        originalBody: {
          model: 'alias-model',
          messages: [{ role: 'user', content: 'hello' }],
          reasoning: null,
          reasoning_effort: 'high',
        },
      }),
      route(),
      { transformRequest: vi.fn() },
      'chat',
      []
    );

    expect(result.payload.reasoning).toBeUndefined();
    expect(result.payload.reasoning_effort).toBeUndefined();
  });

  test('default format ignores a malformed non-object reasoning value as intent source', async () => {
    // A string `reasoning` is not a recognized intent source for the
    // extractor, so reasoning_effort remains the authoritative intent and
    // passes through when provider support is unknown. (The malformed field
    // itself still goes upstream on this path; the reactive strip-and-retry
    // is the guard against a strict upstream rejecting it.)
    vi.mocked(piAiRegistry.resolvePiAiModel).mockReturnValue(piModel({ compat: {} }));
    const dispatcher = new Dispatcher() as any;

    const result = await dispatcher.transformRequestPayload(
      request({
        originalBody: {
          model: 'alias-model',
          messages: [{ role: 'user', content: 'hello' }],
          reasoning: 'high', // malformed — extractor skips non-objects
          reasoning_effort: 'medium',
        },
      }),
      route(),
      { transformRequest: vi.fn() },
      'chat',
      []
    );

    expect(result.payload.reasoning_effort).toBe('medium');
  });

  test('array-valued reasoning is not a recognized intent source', async () => {
    // `typeof [] === 'object'` would otherwise mark this as an authoritative
    // reasoning object; array values must pass through the same way as other
    // malformed values without making a valid reasoning_effort look stale.
    vi.mocked(piAiRegistry.resolvePiAiModel).mockReturnValue(piModel({ compat: {} }));
    const dispatcher = new Dispatcher() as any;

    const result = await dispatcher.transformRequestPayload(
      request({
        originalBody: {
          model: 'alias-model',
          messages: [{ role: 'user', content: 'hello' }],
          reasoning: [],
          reasoning_effort: 'medium',
        },
      }),
      route(),
      { transformRequest: vi.fn() },
      'chat',
      []
    );

    expect(result.payload.reasoning_effort).toBe('medium');
  });

  test('leaves untranslated reasoning fields untouched when no intent is recognized', async () => {
    // With model.reasoning disabled there is nothing to translate — the
    // projection is a no-op passthrough and must NOT strip the field (it may
    // be handled by the reactive unsupported-param strip-and-retry instead).
    vi.mocked(piAiRegistry.resolvePiAiModel).mockReturnValue(piModel({ reasoning: false }));
    const dispatcher = new Dispatcher() as any;

    const result = await dispatcher.transformRequestPayload(
      request({
        originalBody: {
          model: 'alias-model',
          messages: [{ role: 'user', content: 'hello' }],
          reasoning: { effort: 'high' },
        },
      }),
      route(),
      { transformRequest: vi.fn() },
      'chat',
      []
    );

    expect(result.payload.reasoning).toEqual({ effort: 'high' });
    expect(result.payload.reasoning_effort).toBeUndefined();
  });
});

describe('Registry overlay quirks + service tiers', () => {
  beforeEach(() => {
    registerSpy(piAiRegistry, 'resolvePiAiModel').mockReturnValue(piModel());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const overlayConfig = (quirks: any) =>
    ProviderConfigSchema.parse({
      api_base_url: { chat: 'https://example.test/v1', messages: 'https://example.test/v1' },
      api_key: 'test-key',
      auto_compat: true,
      pi_ai_provider: 'openai',
      pi_ai_quirks: quirks,
    });

  test('maps a tier through the target overlay onto the resolved builtin', () => {
    const outbound = applyRegistryAutoCompat(
      { model: 'provider-model', messages: [], service_tier: 'flex' },
      request({ originalBody: { model: 'provider-model', messages: [], service_tier: 'flex' } }),
      route({
        config: overlayConfig({
          chat: {
            api: 'openai-completions',
            serviceTierMap: { standard: 'default', priority: 'priority' },
          },
        }),
      }),
      'chat'
    );

    // flex unsupported -> standard -> native default; the rejected flex must
    // never leak upstream.
    expect(outbound.service_tier).toBe('default');
  });

  test('normalizes a legacy @standard tier to OpenAI default without a serviceTierMap', () => {
    const outbound = applyRegistryAutoCompat(
      { model: 'provider-model', messages: [], service_tier: 'standard' },
      request({
        serviceTier: 'standard',
        originalBody: { model: 'provider-model', messages: [], service_tier: 'standard' },
      }),
      route(),
      'chat'
    );

    expect(outbound.service_tier).toBe('default');
  });

  test('normalizes a legacy @ultrafast tier to OpenAI priority without a serviceTierMap', () => {
    const outbound = applyRegistryAutoCompat(
      { model: 'provider-model', messages: [], service_tier: 'priority' },
      request({
        serviceTier: 'ultrafast',
        originalBody: { model: 'provider-model', messages: [], service_tier: 'ultrafast' },
      }),
      route(),
      'chat'
    );

    expect(outbound.service_tier).toBe('priority');
  });

  test('a mapped ultrafast tier is preserved rather than collapsed to priority', () => {
    const outbound = applyRegistryAutoCompat(
      { model: 'provider-model', messages: [], service_tier: 'priority' },
      request({
        serviceTier: 'ultrafast',
        originalBody: { model: 'provider-model', messages: [], service_tier: 'ultrafast' },
      }),
      route({
        config: overlayConfig({
          chat: { api: 'openai-completions', serviceTierMap: { ultrafast: 'ultra' } },
        }),
      }),
      'chat'
    );

    expect(outbound.service_tier).toBe('ultra');
  });

  test('strips a tier with no supported fallback', () => {
    const outbound = applyRegistryAutoCompat(
      { model: 'provider-model', messages: [], service_tier: 'flex' },
      request({ originalBody: { model: 'provider-model', messages: [], service_tier: 'flex' } }),
      route({
        config: overlayConfig({
          chat: { api: 'openai-completions', serviceTierMap: { standard: null } },
        }),
      }),
      'chat'
    );

    expect(outbound).not.toHaveProperty('service_tier');
  });

  test('an exact model serviceTierMap overrides the target map', () => {
    const outbound = applyRegistryAutoCompat(
      { model: 'provider-model', messages: [], service_tier: 'priority' },
      request({
        originalBody: { model: 'provider-model', messages: [], service_tier: 'priority' },
      }),
      route({
        config: overlayConfig({
          chat: {
            api: 'openai-completions',
            serviceTierMap: { priority: 'priority' },
            models: { 'provider-model': { serviceTierMap: { priority: 'fast' } } },
          },
        }),
      }),
      'chat'
    );

    expect(outbound.service_tier).toBe('fast');
  });

  test('explicit quirks still map tiers when the model has no pi_ai_model_id link', () => {
    const config = overlayConfig({
      chat: { api: 'openai-completions', serviceTierMap: { standard: 'default' } },
    });
    const outbound = applyRegistryAutoCompat(
      { model: 'upstream/unlinked', messages: [], service_tier: 'flex' },
      request({
        originalBody: { model: 'upstream/unlinked', messages: [], service_tier: 'flex' },
      }),
      route({ model: 'upstream/unlinked', config, modelConfig: undefined }),
      'chat'
    );

    expect(outbound.service_tier).toBe('default');
    expect(piAiRegistry.resolvePiAiModel).toHaveBeenCalledWith('openai', 'upstream/unlinked');
  });

  test('map-only overlay reasoning inherits the unlinked builtin capability', () => {
    const config = overlayConfig({
      chat: { api: 'openai-completions', thinkingLevelMap: { high: 'hard' } },
    });
    const outbound = applyRegistryAutoCompat(
      { model: 'upstream/unlinked', messages: [], reasoning_effort: 'high' },
      request({
        originalBody: { model: 'upstream/unlinked', messages: [], reasoning_effort: 'high' },
      }),
      route({ model: 'upstream/unlinked', config, modelConfig: undefined }),
      'chat'
    );

    // The map declares no `reasoning`, so the resolved builtin's reasoning
    // capability is inherited rather than assumed off from a map alone.
    expect(outbound.reasoning_effort).toBe('hard');
    expect(piAiRegistry.resolvePiAiModel).toHaveBeenCalledWith('openai', 'upstream/unlinked');
  });

  test('target reasoning:false drops the inherited builtin thinking map', () => {
    const overlayed = applyQuirkOverlay(
      piModel(),
      { chat: { api: 'openai-completions', reasoning: false } } as any,
      'chat',
      'provider-model'
    );

    expect(overlayed.reasoning).toBe(false);
    expect(overlayed.thinkingLevelMap).toBeUndefined();
  });

  test('an overlay thinking map with omitted reasoning inherits builtin reasoning', () => {
    const warnSpy = registerSpy(logger, 'warn');
    const outbound = applyRegistryAutoCompat(
      { model: 'provider-model', messages: [], reasoning_effort: 'high' },
      request({
        originalBody: { model: 'provider-model', messages: [], reasoning_effort: 'high' },
      }),
      route({
        config: overlayConfig({
          chat: { api: 'openai-completions', thinkingLevelMap: { high: 'hard' } },
        }),
      }),
      'chat'
    );

    expect(outbound.reasoning_effort).toBe('hard');
    // A resolved builtin supplies the reasoning capability, so the overlay's
    // omitted `reasoning` is inheritance, not a no-op worth warning about.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('warns when inline quirks declare a thinking map without reasoning: true', () => {
    vi.mocked(piAiRegistry.resolvePiAiModel).mockReturnValue(null);
    const warnSpy = registerSpy(logger, 'warn');

    const outbound = applyRegistryAutoCompat(
      { model: 'upstream/unlinked', messages: [], reasoning_effort: 'high' },
      request({
        originalBody: { model: 'upstream/unlinked', messages: [], reasoning_effort: 'high' },
      }),
      route({
        model: 'upstream/unlinked',
        config: overlayConfig({
          chat: { api: 'openai-completions', thinkingLevelMap: { high: 'hard' } },
        }),
        modelConfig: undefined,
      }),
      'chat'
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('thinkingLevelMap without reasoning: true')
    );
    // The inline map is a no-op without `reasoning: true`; the intent passes
    // through untranslated rather than being silently mapped.
    expect(outbound.reasoning_effort).toBe('high');
  });

  test('a target dialect override projects Anthropic speed and clears a cross-dialect capacity service_tier', () => {
    const outbound = applyRegistryAutoCompat(
      { model: 'provider-model', messages: [], service_tier: 'priority' },
      request({
        originalBody: { model: 'provider-model', messages: [], service_tier: 'priority' },
      }),
      route({
        config: overlayConfig({
          messages: { api: 'anthropic-messages', serviceTierMap: { priority: 'fast' } },
        }),
      }),
      'messages'
    );

    expect(outbound.speed).toBe('fast');
    // `priority` is an OpenAI spelling, not a native Anthropic capacity value;
    // it must not survive alongside the projected `speed`.
    expect(outbound).not.toHaveProperty('service_tier');
  });

  test('a suffix on native Messages keeps an independently valid capacity service_tier', () => {
    const outbound = applyRegistryAutoCompat(
      {
        model: 'provider-model',
        messages: [],
        speed: 'fast',
        service_tier: 'standard_only',
      },
      request({
        serviceTier: 'priority',
        incomingApiType: 'messages',
        originalBody: {
          model: 'provider-model',
          messages: [],
          service_tier: 'standard_only',
        },
      }),
      route({
        config: overlayConfig({
          messages: { api: 'anthropic-messages', serviceTierMap: { priority: 'fast' } },
        }),
      }),
      'messages'
    );

    expect(outbound.speed).toBe('fast');
    // `standard_only` is a real native Anthropic capacity value, so it survives
    // the independent speed projection.
    expect(outbound.service_tier).toBe('standard_only');
  });

  test('a service-tier format clears native speed that supplied the tier intent', () => {
    const outbound = applyRegistryAutoCompat(
      { model: 'provider-model', messages: [], speed: 'fast' },
      request({
        incomingApiType: 'messages',
        originalBody: { model: 'provider-model', messages: [], speed: 'fast' },
      }),
      route({
        config: overlayConfig({
          messages: {
            api: 'anthropic-messages',
            serviceTierMap: { priority: 'priority' },
            compat: { serviceTierFormat: 'service-tier' },
          },
        }),
      }),
      'messages'
    );

    // The tier is projected into `service_tier`; the native `speed` that
    // supplied it must be gone so no fast-mode beta is emitted alongside.
    expect(outbound.service_tier).toBe('priority');
    expect(outbound).not.toHaveProperty('speed');
  });

  test('a suffix overrides native speed without leaving conflicting gateway controls', () => {
    for (const target of ['chat', 'messages'] as const) {
      const outbound = applyRegistryAutoCompat(
        { model: 'provider-model', messages: [], speed: 'fast' },
        request({ incomingApiType: 'messages', serviceTier: 'standard' }),
        route({
          config: overlayConfig({
            [target]: {
              api: target === 'chat' ? 'openai-completions' : 'anthropic-messages',
              serviceTierMap: { standard: 'default', priority: 'priority' },
              compat: { serviceTierFormat: 'service-tier' },
            },
          }),
        }),
        target
      );

      expect(outbound.service_tier).toBe('default');
      expect(outbound).not.toHaveProperty('speed');
    }
  });

  test('native Messages speed wins over a co-sent capacity service_tier', () => {
    const outbound = applyRegistryAutoCompat(
      { model: 'provider-model', messages: [], speed: 'fast', service_tier: 'auto' },
      request({
        incomingApiType: 'messages',
        originalBody: {
          model: 'provider-model',
          messages: [],
          speed: 'fast',
          service_tier: 'auto',
        },
      }),
      route({
        config: overlayConfig({
          messages: {
            api: 'anthropic-messages',
            serviceTierMap: { auto: 'auto', priority: 'fast' },
          },
        }),
      }),
      'messages'
    );

    // `speed: fast` is the tier intent (mapped to fast); the capacity
    // `service_tier: auto` is preserved independently rather than deleted.
    expect(outbound.speed).toBe('fast');
    expect(outbound.service_tier).toBe('auto');
  });

  test('a Messages service-tier format writes service_tier, never speed', () => {
    const outbound = applyRegistryAutoCompat(
      { model: 'provider-model', messages: [], service_tier: 'priority' },
      request({
        incomingApiType: 'messages',
        originalBody: { model: 'provider-model', messages: [], service_tier: 'priority' },
      }),
      route({
        config: overlayConfig({
          messages: {
            api: 'anthropic-messages',
            serviceTierMap: { priority: 'priority' },
            compat: { serviceTierFormat: 'service-tier' },
          },
        }),
      }),
      'messages'
    );

    expect(outbound.service_tier).toBe('priority');
    expect(outbound).not.toHaveProperty('speed');
  });

  test('anthropic-speed on a non-Messages API is ignored (bad config guard)', () => {
    const outbound = applyRegistryAutoCompat(
      { model: 'provider-model', messages: [], service_tier: 'priority' },
      request({
        originalBody: { model: 'provider-model', messages: [], service_tier: 'priority' },
      }),
      route({
        config: overlayConfig({
          chat: {
            api: 'openai-completions',
            serviceTierMap: { priority: 'fast' },
            compat: { serviceTierFormat: 'anthropic-speed' },
          },
        }),
      }),
      'chat'
    );

    // The mapping is guarded off, so the client's OpenAI `service_tier`
    // passes through untouched and no `speed` is fabricated.
    expect(outbound.service_tier).toBe('priority');
    expect(outbound).not.toHaveProperty('speed');
  });
});
