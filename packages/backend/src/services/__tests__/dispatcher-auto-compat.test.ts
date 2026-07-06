import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { registerSpy } from '../../../test/test-utils';
import { Dispatcher } from '../dispatcher';
import * as piAiRegistry from '../pi-ai/registry';
import type { RouteResult } from '../router';
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
});
