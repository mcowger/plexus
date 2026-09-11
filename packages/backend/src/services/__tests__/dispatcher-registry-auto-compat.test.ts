import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { registerSpy } from '../../../test/test-utils';
import { Dispatcher } from '../dispatch/dispatcher';
import * as piAiRegistry from '../pi-ai/registry';
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

  test('skips auto-compat when the model has no pi_ai_model_id', async () => {
    const dispatcher = new Dispatcher() as any;

    const result = await dispatcher.transformRequestPayload(
      request({
        originalBody: {
          model: 'alias-model',
          messages: [{ role: 'user', content: 'hello' }],
          reasoning_effort: 'high',
        },
      }),
      route({ modelConfig: { pricing: { source: 'simple', input: 0, output: 0 } } as any }),
      { transformRequest: vi.fn() },
      'chat',
      []
    );

    expect(result.payload.reasoning_effort).toBe('high');
    expect(piAiRegistry.resolvePiAiModel).not.toHaveBeenCalled();
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
