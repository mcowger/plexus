import { describe, expect, test } from 'vitest';
import { ProviderConfigSchema } from '../config';

const baseProvider = {
  api_base_url: 'https://example.com/v1',
  api_key: 'test-key',
};

describe('provider model API subtype config', () => {
  test('accepts legacy access strings', () => {
    const parsed = ProviderConfigSchema.safeParse({
      ...baseProvider,
      models: { model: { access_via: ['chat', 'responses'] } },
    });
    expect(parsed.success).toBe(true);
  });

  test('accepts structured API subtypes', () => {
    const parsed = ProviderConfigSchema.safeParse({
      ...baseProvider,
      models: {
        model: { access_via: [{ type: 'responses', subtype: 'lite' }] },
      },
    });
    expect(parsed.success).toBe(true);
  });

  test('rejects empty structured types and subtypes', () => {
    const emptyType = ProviderConfigSchema.safeParse({
      ...baseProvider,
      models: { model: { access_via: [{ type: '' }] } },
    });
    const emptySubtype = ProviderConfigSchema.safeParse({
      ...baseProvider,
      models: { model: { access_via: [{ type: 'responses', subtype: '' }] } },
    });
    expect(emptyType.success).toBe(false);
    expect(emptySubtype.success).toBe(false);
  });
});
