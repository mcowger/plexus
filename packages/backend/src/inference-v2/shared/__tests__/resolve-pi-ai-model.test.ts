import { describe, it, expect, beforeEach, vi } from 'vitest';

// Local pi-ai mock so getModel returns realistic models for known ids and
// undefined for unknown ones (matching pi-ai 0.79.x behaviour).
vi.mock('@earendil-works/pi-ai', () => {
  const REGISTRY: Record<string, Record<string, any>> = {
    openai: {
      'gpt-5.5': {
        id: 'gpt-5.5',
        name: 'GPT-5.5',
        api: 'openai-responses',
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        reasoning: true,
        thinkingLevelMap: { off: null },
        input: ['text', 'image'],
        cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 400000,
        maxTokens: 128000,
        compat: { supportsDeveloperRole: true },
      },
    },
  };
  return {
    getModel: (provider: string, modelId: string) => REGISTRY[provider]?.[modelId],
    getProviders: () => Object.keys(REGISTRY),
    getModels: (provider: string) => Object.values(REGISTRY[provider] ?? {}),
    clampThinkingLevel: (_m: any, l: string) => l,
    getSupportedThinkingLevels: () => ['off', 'low', 'medium', 'high'],
  };
});

import { setConfigForTesting } from '../../../config';
import { resolvePiAiModel } from '../pi-ai-utils';

function configWith(custom: { providers?: Record<string, any>; models?: Record<string, any> }) {
  setConfigForTesting({
    providers: {},
    models: {},
    keys: {},
    failover: { enabled: false, retryableStatusCodes: [], retryableErrors: [] },
    quotas: [],
    pi_ai_custom_providers: custom.providers,
    pi_ai_custom_models: custom.models,
  } as any);
}

describe('resolvePiAiModel', () => {
  beforeEach(() => configWith({}));

  it('returns a built-in registry model', () => {
    const m = resolvePiAiModel('openai', 'gpt-5.5');
    expect(m).not.toBeNull();
    expect(m!.id).toBe('gpt-5.5');
    expect(m!.api).toBe('openai-responses');
  });

  it('returns null for an unknown pair (getModel returns undefined, not throw)', () => {
    expect(resolvePiAiModel('openai', 'nonexistent')).toBeNull();
    expect(resolvePiAiModel('who', 'what')).toBeNull();
  });

  describe('custom inherited model', () => {
    beforeEach(() =>
      configWith({
        models: {
          'gpt-5.6': {
            inherits: { provider: 'openai', model_id: 'gpt-5.5' },
            overrides: undefined,
            contextWindow: 500000,
            maxTokens: 200000,
            compat: { supportsReasoningEffort: true },
          },
        },
      })
    );

    it('inherits base fields and deep-merges overrides', () => {
      const m = resolvePiAiModel('openai', 'gpt-5.6')!;
      expect(m).not.toBeNull();
      // identity uses the custom id
      expect(m.id).toBe('gpt-5.6');
      // inherited from base
      expect(m.api).toBe('openai-responses');
      expect(m.reasoning).toBe(true);
      // overridden
      expect(m.contextWindow).toBe(500000);
      expect(m.maxTokens).toBe(200000);
      // compat deep-merged: base key kept, new key added
      expect(m.compat).toMatchObject({
        supportsDeveloperRole: true,
        supportsReasoningEffort: true,
      });
    });

    it('returns null when the inheritance base is missing', () => {
      configWith({
        models: { orphan: { inherits: { provider: 'openai', model_id: 'ghost' } } },
      });
      expect(resolvePiAiModel('openai', 'orphan')).toBeNull();
    });
  });

  describe('custom standalone model', () => {
    beforeEach(() =>
      configWith({
        models: {
          'fully-custom': {
            api: 'openai-completions',
            contextWindow: 32000,
            maxTokens: 8192,
            reasoning: false,
            cost: { input: 0.5, output: 1, cacheRead: 0, cacheWrite: 0 },
          },
        },
      })
    );

    it('builds a model from a standalone spec', () => {
      const m = resolvePiAiModel('niche', 'fully-custom')!;
      expect(m).not.toBeNull();
      expect(m.api).toBe('openai-completions');
      expect(m.contextWindow).toBe(32000);
      expect(m.provider).toBe('niche');
    });
  });

  describe('custom provider', () => {
    it('overrides api + compat on a registry base model', () => {
      configWith({
        providers: {
          'niche-host': {
            api: 'openai-completions',
            compat: { maxTokensField: 'max_tokens' },
          },
        },
      });
      // gpt-5.5 is registry-known; but here we route it under the custom provider
      const m = resolvePiAiModel('niche-host', 'gpt-5.5')!;
      expect(m).not.toBeNull();
      // api overridden by the custom provider
      expect(m.api).toBe('openai-completions');
      expect(m.compat).toMatchObject({ maxTokensField: 'max_tokens' });
      expect(m.provider).toBe('niche-host');
    });

    it('builds a skeleton when neither registry nor custom model exists', () => {
      configWith({
        providers: { 'niche-host': { api: 'anthropic-messages' } },
      });
      const m = resolvePiAiModel('niche-host', 'brand-new-model')!;
      expect(m).not.toBeNull();
      expect(m.api).toBe('anthropic-messages');
      expect(m.id).toBe('brand-new-model');
    });
  });

  it('custom model takes precedence over a custom provider for api/compat merge', () => {
    configWith({
      providers: {
        'niche-host': { api: 'anthropic-messages', compat: { supportsTemperature: false } },
      },
      models: { special: { api: 'openai-completions', contextWindow: 1000, maxTokens: 100 } },
    });
    const m = resolvePiAiModel('niche-host', 'special')!;
    // custom model resolved first (api openai-completions), then provider api override applies
    expect(m.api).toBe('anthropic-messages');
    expect(m.compat).toMatchObject({ supportsTemperature: false });
    expect(m.contextWindow).toBe(1000);
  });
});
