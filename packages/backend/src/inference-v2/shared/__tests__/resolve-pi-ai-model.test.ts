import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mutable map of providers registered at runtime via setProvider().
// Reset in beforeEach so tests don't bleed into each other.
const registeredProviders: Record<string, any> = {};

// Local pi-ai mock so getModel returns realistic models for known ids and
// undefined for unknown ones (matching pi-ai 0.79.x behaviour).
vi.mock('@earendil-works/pi-ai', () => ({
  clampThinkingLevel: (_m: any, l: string) => l,
  getSupportedThinkingLevels: () => ['off', 'low', 'medium', 'high'],
  // Used by registerCustomProvidersWithPiAi to build a provider before setProvider().
  createProvider: vi.fn((spec: any) => ({ id: spec.id, name: spec.name, api: spec.api })),
}));

vi.mock('@earendil-works/pi-ai/providers/all', () => {
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
    builtinModels: () => ({
      complete: vi.fn(),
      stream: vi.fn(),
      getModel: (provider: string, modelId: string) => REGISTRY[provider]?.[modelId],
      getModels: (provider: string) => Object.values(REGISTRY[provider] ?? {}),
      getProviders: () => [...Object.keys(REGISTRY), ...Object.keys(registeredProviders)],
      // Returns a value for builtin providers OR providers registered via setProvider().
      getProvider: (id: string) => (REGISTRY[id] ? { id } : registeredProviders[id]),
      // Simulates piAiModels.setProvider() — stores the provider for getProvider() lookup.
      setProvider: (provider: any) => {
        registeredProviders[provider.id] = provider;
      },
    }),
    getBuiltinModel: (provider: string, modelId: string) => REGISTRY[provider]?.[modelId],
    getBuiltinProviders: () => Object.keys(REGISTRY),
    getBuiltinModels: (provider: string) => Object.values(REGISTRY[provider] ?? {}),
  };
});

// Mock lazy API implementation modules used by registerCustomProvidersWithPiAi.
vi.mock('@earendil-works/pi-ai/api/openai-completions.lazy', () => ({
  openAICompletionsApi: () => ({ id: 'openai-completions' }),
}));
vi.mock('@earendil-works/pi-ai/api/openai-responses.lazy', () => ({
  openAIResponsesApi: () => ({ id: 'openai-responses' }),
}));
vi.mock('@earendil-works/pi-ai/api/openai-codex-responses.lazy', () => ({
  openAICodexResponsesApi: () => ({ id: 'openai-codex-responses' }),
}));
vi.mock('@earendil-works/pi-ai/api/anthropic-messages.lazy', () => ({
  anthropicMessagesApi: () => ({ id: 'anthropic-messages' }),
}));
vi.mock('@earendil-works/pi-ai/api/google-generative-ai.lazy', () => ({
  googleGenerativeAIApi: () => ({ id: 'google-generative-ai' }),
}));
vi.mock('@earendil-works/pi-ai/api/google-vertex.lazy', () => ({
  googleVertexApi: () => ({ id: 'google-generative-ai-vertex' }),
}));
vi.mock('@earendil-works/pi-ai/api/azure-openai-responses.lazy', () => ({
  azureOpenAIResponsesApi: () => ({ id: 'azure-openai-responses' }),
}));

import { setConfigForTesting } from '../../../config';
import { resolvePiAiModel, toDispatchModel, registerCustomProvidersWithPiAi } from '../pi-ai-utils';

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
  beforeEach(() => {
    // Clear any providers registered via setProvider() between tests.
    Object.keys(registeredProviders).forEach((k) => delete registeredProviders[k]);
    configWith({});
  });

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
            provider: 'openai',
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
        models: {
          orphan: { provider: 'openai', inherits: { provider: 'openai', model_id: 'ghost' } },
        },
      });
      expect(resolvePiAiModel('openai', 'orphan')).toBeNull();
    });
  });

  describe('custom standalone model', () => {
    beforeEach(() =>
      configWith({
        models: {
          'fully-custom': {
            provider: 'niche',
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
      models: {
        special: {
          provider: 'niche-host',
          api: 'openai-completions',
          contextWindow: 1000,
          maxTokens: 100,
        },
      },
    });
    const m = resolvePiAiModel('niche-host', 'special')!;
    // custom model resolved first (api openai-completions), then provider api override applies
    expect(m.api).toBe('anthropic-messages');
    expect(m.compat).toMatchObject({ supportsTemperature: false });
    expect(m.contextWindow).toBe(1000);
  });

  describe('provider-scoped custom model', () => {
    beforeEach(() =>
      configWith({
        providers: {
          'niche-host': { api: 'openai-completions' },
          'other-host': { api: 'openai-responses' },
        },
        models: {
          scoped: {
            provider: 'niche-host',
            api: 'openai-completions',
            contextWindow: 8000,
            maxTokens: 1024,
          },
        },
      })
    );

    it('resolves under its declared provider', () => {
      const m = resolvePiAiModel('niche-host', 'scoped')!;
      expect(m).not.toBeNull();
      expect(m.api).toBe('openai-completions');
      expect(m.contextWindow).toBe(8000);
      expect(m.provider).toBe('niche-host');
    });

    it('does NOT resolve under a different provider (scoped mismatch falls through)', () => {
      // other-host has a custom provider spec, so resolution falls to the
      // custom-provider path (skeleton), NOT the niche-host-scoped model.
      const m = resolvePiAiModel('other-host', 'scoped')!;
      expect(m).not.toBeNull();
      // skeleton built from other-host's api, not the scoped model's fields
      expect(m.api).toBe('openai-responses');
      expect(m.contextWindow).toBe(0);
    });

    it('does not resolve under a provider with no custom spec and no registry model', () => {
      expect(resolvePiAiModel('unknown-host', 'scoped')).toBeNull();
    });
  });

  describe('compound key provider-scoped custom model', () => {
    beforeEach(() =>
      configWith({
        providers: {
          'provider-a': { api: 'openai-completions' },
          'provider-b': { api: 'openai-responses' },
        },
        models: {
          'provider-a:shared-id': {
            provider: 'provider-a',
            api: 'openai-completions',
            contextWindow: 1000,
            maxTokens: 500,
          },
          'provider-b:shared-id': {
            provider: 'provider-b',
            api: 'openai-responses',
            contextWindow: 2000,
            maxTokens: 600,
          },
        },
      })
    );

    it('resolves the correct custom model for provider-a using the compound key', () => {
      const m = resolvePiAiModel('provider-a', 'shared-id')!;
      expect(m).not.toBeNull();
      expect(m.api).toBe('openai-completions');
      expect(m.contextWindow).toBe(1000);
      expect(m.maxTokens).toBe(500);
      expect(m.provider).toBe('provider-a');
      expect(m.id).toBe('shared-id');
    });

    it('resolves the correct custom model for provider-b using the compound key', () => {
      const m = resolvePiAiModel('provider-b', 'shared-id')!;
      expect(m).not.toBeNull();
      expect(m.api).toBe('openai-responses');
      expect(m.contextWindow).toBe(2000);
      expect(m.maxTokens).toBe(600);
      expect(m.provider).toBe('provider-b');
      expect(m.id).toBe('shared-id');
    });
  });
});

// ─── toDispatchModel ──────────────────────────────────────────────────────────
//
// Regression coverage for the pi-ai 0.80 upgrade regression where
// piAiModels.stream() throws "Unknown provider: <custom>" because
// builtinModels() only has builtin provider ids in its internal map.
// toDispatchModel() must remap custom providers to their builtin equivalent
// before the model is handed to piAiModels.stream() / .complete().

describe('toDispatchModel', () => {
  it('returns the model unchanged when provider is already a builtin', () => {
    const model = {
      id: 'gpt-5.5',
      provider: 'openai',
      api: 'openai-responses',
      baseUrl: 'https://api.openai.com',
    } as any;
    const result = toDispatchModel(model);
    expect(result).toBe(model); // same reference — no copy made
    expect(result.provider).toBe('openai');
  });

  it('remaps a custom provider to the builtin openai for openai-completions when NOT registered via setProvider', () => {
    // When registerCustomProvidersWithPiAi has NOT been called, the old
    // fallback remap still applies so dispatch does not throw.
    const model = {
      id: 'glm-5.2',
      provider: 'neuralwatt',
      api: 'openai-completions',
      baseUrl: 'https://api.neuralwatt.com/v1',
    } as any;
    const result = toDispatchModel(model);
    expect(result.provider).toBe('openai');
    expect(result.id).toBe('glm-5.2');
    expect(result.api).toBe('openai-completions');
    expect(result.baseUrl).toBe('https://api.neuralwatt.com/v1');
  });

  it('returns the model UNCHANGED when the custom provider has been registered via setProvider', async () => {
    // This is the correct post-fix behaviour: once registerCustomProvidersWithPiAi
    // has called piAiModels.setProvider(createProvider({id:'neuralwatt',...})),
    // toDispatchModel must NOT remap the provider to 'openai' — doing so would
    // cause piAiModels.stream() to use the openai-responses API path instead of
    // openai-completions, hitting /responses instead of /chat/completions.
    configWith({
      providers: {
        neuralwatt: { api: 'openai-completions', display_name: 'NeuralWatt' },
      },
    });
    await registerCustomProvidersWithPiAi();

    const model = {
      id: 'glm-5.2',
      provider: 'neuralwatt',
      api: 'openai-completions',
      baseUrl: 'https://api.neuralwatt.com/v1',
    } as any;
    const result = toDispatchModel(model);
    // Provider must NOT be remapped — it is now known to piAiModels.
    expect(result.provider).toBe('neuralwatt');
    expect(result.id).toBe('glm-5.2');
    expect(result.api).toBe('openai-completions');
    expect(result.baseUrl).toBe('https://api.neuralwatt.com/v1');
  });

  it('remaps a custom provider to anthropic for anthropic-messages api', () => {
    const model = {
      id: 'custom-claude',
      provider: 'my-anthropic-proxy',
      api: 'anthropic-messages',
      baseUrl: 'https://proxy.example.com',
    } as any;
    const result = toDispatchModel(model);
    expect(result.provider).toBe('anthropic');
    expect(result.api).toBe('anthropic-messages');
    expect(result.baseUrl).toBe('https://proxy.example.com');
  });

  it('remaps a custom provider to google for google-generative-ai api', () => {
    const model = {
      id: 'gemini-custom',
      provider: 'my-google-proxy',
      api: 'google-generative-ai',
      baseUrl: 'https://proxy.example.com',
    } as any;
    const result = toDispatchModel(model);
    expect(result.provider).toBe('google');
  });

  it('returns model unchanged when api has no known builtin mapping', () => {
    const model = {
      id: 'weird-model',
      provider: 'unknown-provider',
      api: 'unknown-api',
      baseUrl: 'https://something.example.com',
    } as any;
    const result = toDispatchModel(model);
    // Falls through — let piAiModels surface its own error
    expect(result.provider).toBe('unknown-provider');
  });
});

// ─── registerCustomProvidersWithPiAi ─────────────────────────────────────────
//
// Verifies that custom providers defined in pi_ai_custom_providers config are
// registered with piAiModels via createProvider()+setProvider(), so that
// toDispatchModel() can find them and avoid the api-key remap that causes
// the wrong API path to be used (e.g. /responses instead of /chat/completions).

describe('registerCustomProvidersWithPiAi', () => {
  beforeEach(() => {
    Object.keys(registeredProviders).forEach((k) => delete registeredProviders[k]);
    configWith({});
  });

  it('registers each custom provider so piAiModels.getProvider() finds it', async () => {
    configWith({
      providers: {
        neuralwatt: { api: 'openai-completions', display_name: 'NeuralWatt' },
        'my-anthropic-proxy': { api: 'anthropic-messages' },
      },
    });
    await registerCustomProvidersWithPiAi();

    // Both providers should now be findable in piAiModels.
    expect(registeredProviders['neuralwatt']).toBeDefined();
    expect(registeredProviders['my-anthropic-proxy']).toBeDefined();
  });

  it('does not re-register a provider already present in piAiModels', async () => {
    configWith({
      providers: { neuralwatt: { api: 'openai-completions' } },
    });
    // Pre-populate as if already registered.
    registeredProviders['neuralwatt'] = { id: 'neuralwatt', sentinel: true };

    await registerCustomProvidersWithPiAi();

    // The original sentinel object must survive — setProvider was not called again.
    expect(registeredProviders['neuralwatt'].sentinel).toBe(true);
  });

  it('is a no-op when pi_ai_custom_providers is empty', async () => {
    configWith({});
    await registerCustomProvidersWithPiAi();
    expect(Object.keys(registeredProviders)).toHaveLength(0);
  });

  it('uses the correct API implementation for the declared api type', async () => {
    const { createProvider } = await import('@earendil-works/pi-ai');
    const createProviderMock = vi.mocked(createProvider);
    createProviderMock.mockClear();

    configWith({
      providers: {
        neuralwatt: { api: 'openai-completions' },
        'my-google': { api: 'google-generative-ai' },
      },
    });
    await registerCustomProvidersWithPiAi();

    expect(createProviderMock).toHaveBeenCalledTimes(2);

    const neuralwattCall = createProviderMock.mock.calls.find((c) => c[0].id === 'neuralwatt');
    expect(neuralwattCall).toBeDefined();
    // The api passed to createProvider must be the resolved implementation, not the string.
    expect(neuralwattCall![0].api).toEqual({ id: 'openai-completions' });

    const googleCall = createProviderMock.mock.calls.find((c) => c[0].id === 'my-google');
    expect(googleCall).toBeDefined();
    expect(googleCall![0].api).toEqual({ id: 'google-generative-ai' });
  });
});
