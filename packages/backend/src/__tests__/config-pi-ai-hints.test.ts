import { describe, it, expect, vi } from 'vitest';
import { validateConfig } from '../config';
import { logger } from '../utils/logger';

// pi-ai and logger are globally mocked in test/vitest.setup.ts

const BASE_PROVIDER = {
  api_base_url: 'https://api.example.com/v1',
  api_key: 'sk-test',
  enabled: true,
};

describe('config schema: pi_ai_provider and pi_ai_model_id', () => {
  it('ProviderConfigSchema accepts pi_ai_provider as optional string', () => {
    const config = validateConfig(
      JSON.stringify({
        providers: {
          'test-provider': {
            ...BASE_PROVIDER,
            pi_ai_provider: 'anthropic',
            models: { 'claude-opus-4-6': { pricing: { source: 'simple', input: 0, output: 0 } } },
          },
        },
        models: {},
        keys: {},
      })
    );
    expect(config.providers['test-provider']?.pi_ai_provider).toBe('anthropic');
  });

  it('ProviderConfigSchema accepts provider without pi_ai_provider (optional)', () => {
    const config = validateConfig(
      JSON.stringify({
        providers: {
          'test-provider': {
            ...BASE_PROVIDER,
          },
        },
        models: {},
        keys: {},
      })
    );
    expect(config.providers['test-provider']?.pi_ai_provider).toBeUndefined();
  });

  it('ModelProviderConfigSchema accepts pi_ai_model_id as optional string', () => {
    const config = validateConfig(
      JSON.stringify({
        providers: {
          'test-provider': {
            ...BASE_PROVIDER,
            pi_ai_provider: 'anthropic',
            models: {
              'claude-opus-4-6': {
                pricing: { source: 'simple', input: 0, output: 0 },
                pi_ai_model_id: 'claude-opus-4-6',
              },
            },
          },
        },
        models: {},
        keys: {},
      })
    );
    const models = config.providers['test-provider']?.models as Record<string, any>;
    expect(models?.['claude-opus-4-6']?.pi_ai_model_id).toBe('claude-opus-4-6');
  });

  it('ModelProviderConfigSchema accepts model without pi_ai_model_id (optional)', () => {
    const config = validateConfig(
      JSON.stringify({
        providers: {
          'test-provider': {
            ...BASE_PROVIDER,
            models: {
              'gpt-4': {
                pricing: { source: 'simple', input: 0, output: 0 },
              },
            },
          },
        },
        models: {},
        keys: {},
      })
    );
    const models = config.providers['test-provider']?.models as Record<string, any>;
    expect(models?.['gpt-4']?.pi_ai_model_id).toBeUndefined();
  });
});

describe('hydrateConfig: startup registry validation', () => {
  it('warns (non-fatally) when pi_ai_model_id is not in the pi-ai registry', async () => {
    // Import the pi-ai module — in tests it's globally mocked as a factory.
    // We can spy on the mocked object's getModel using vi.spyOn on the module
    // to temporarily make it throw.
    const piAiProvidersModule = await import('@earendil-works/pi-ai/providers/all');

    const getModelSpy = vi
      .spyOn(piAiProvidersModule, 'getBuiltinModel')
      .mockImplementationOnce((provider: string, modelId: string) => {
        if (provider === 'anthropic' && modelId === 'bogus-model-xyz') {
          throw new Error('Unknown model');
        }
        return {
          id: modelId,
          name: modelId,
          contextWindow: 200000,
          provider,
          api: 'anthropic-messages',
          baseUrl: '',
        } as any;
      });

    const warnSpy = vi.spyOn(logger, 'warn');

    // Should not throw
    expect(() =>
      validateConfig(
        JSON.stringify({
          providers: {
            'anthropic-test': {
              ...BASE_PROVIDER,
              pi_ai_provider: 'anthropic',
              models: {
                'bogus-model-xyz': {
                  pricing: { source: 'simple', input: 0, output: 0 },
                  pi_ai_model_id: 'bogus-model-xyz',
                },
              },
            },
          },
          models: {},
          keys: {},
        })
      )
    ).not.toThrow();

    const piAiWarnings = (warnSpy.mock.calls as unknown as any[][]).filter((args: any[]) => {
      const msg = args[0];
      return typeof msg === 'string' && msg.includes('pi-ai registry');
    });
    expect(piAiWarnings.length).toBeGreaterThan(0);
    const firstWarning = piAiWarnings[0];
    expect(firstWarning).toBeDefined();
    expect(String(firstWarning![0])).toContain('bogus-model-xyz');

    warnSpy.mockRestore();
    getModelSpy.mockRestore();
  });

  it('does not warn when pi_ai_model_id is not configured', () => {
    const warnSpy = vi.spyOn(logger, 'warn');

    validateConfig(
      JSON.stringify({
        providers: {
          'no-pi-ai': {
            ...BASE_PROVIDER,
            models: { 'gpt-4': { pricing: { source: 'simple', input: 0, output: 0 } } },
          },
        },
        models: {},
        keys: {},
      })
    );

    const piAiWarnings = (warnSpy.mock.calls as unknown as any[][]).filter((args: any[]) => {
      const msg = args[0];
      return typeof msg === 'string' && msg.includes('pi-ai registry');
    });
    expect(piAiWarnings).toHaveLength(0);

    warnSpy.mockRestore();
  });
});

describe('jsonSchemaToTypeBox export smoke test', () => {
  it('jsonSchemaToTypeBox is exported from type-mappers', async () => {
    const { jsonSchemaToTypeBox } = await import('../transformers/oauth/type-mappers');
    expect(typeof jsonSchemaToTypeBox).toBe('function');

    // Basic sanity: converts a simple object schema
    const result = jsonSchemaToTypeBox({
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    });
    expect(result).toBeDefined();
    expect(result.type).toBe('object');
  });
});
