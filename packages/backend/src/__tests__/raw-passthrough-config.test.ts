import { describe, expect, test } from 'vitest';
import { KeyConfigSchema, ProviderConfigSchema } from '../config';

describe('raw passthrough config schemas', () => {
  test('keeps raw key access optional and default-deny', () => {
    const parsed = KeyConfigSchema.parse({ secret: 'key' });
    expect(parsed.allowRawPassthrough).toBeUndefined();
  });

  test('accepts static providers with an HTTP raw base URL', () => {
    const parsed = ProviderConfigSchema.safeParse({
      api_base_url: 'https://openrouter.ai/api/v1',
      api_key: 'provider-key',
      raw_passthrough: {
        enabled: true,
        base_url: 'https://openrouter.ai/api',
        auth: 'bearer',
      },
    });
    expect(parsed.success).toBe(true);
  });

  test('rejects raw passthrough for OAuth providers', () => {
    const parsed = ProviderConfigSchema.safeParse({
      api_base_url: 'oauth://',
      api_key: 'oauth',
      oauth_provider: 'openai-codex',
      oauth_account: 'default',
      raw_passthrough: {
        enabled: true,
        base_url: 'https://api.openai.com',
        auth: 'bearer',
      },
    });
    expect(parsed.success).toBe(false);
  });

  test('accepts legacy open-ended pricing ranges serialized with a null upper bound', () => {
    const parsed = ProviderConfigSchema.parse({
      api_base_url: 'https://provider.example/v1',
      api_key: 'provider-key',
      models: {
        model: {
          pricing: {
            source: 'defined',
            range: [
              {
                lower_bound: 0,
                upper_bound: null,
                input_per_m: 1,
                output_per_m: 2,
              },
            ],
          },
        },
      },
    });

    const models = parsed.models as Record<string, any>;
    expect(models.model.pricing.range[0].upper_bound).toBe(Infinity);
  });
});
