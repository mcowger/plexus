import { describe, expect, it } from 'vitest';
import { KeyConfigSchema, validateConfig } from '../config';

function baseConfigJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    providers: {},
    models: {},
    keys: {},
    ...overrides,
  });
}

describe('KeyConfigSchema defaultServiceTier', () => {
  it.each(['auto', 'default', 'standard', 'flex', 'priority', 'fast', 'ultrafast'])(
    'accepts the service-tier vocabulary value %s',
    (tier) => {
      const result = KeyConfigSchema.safeParse({ secret: 's', defaultServiceTier: tier });
      expect(result.success).toBe(true);
      expect(result.success && result.data.defaultServiceTier).toBe(tier);
    }
  );

  it('leaves defaultServiceTier undefined when omitted', () => {
    const result = KeyConfigSchema.safeParse({ secret: 's' });
    expect(result.success).toBe(true);
    expect(result.success && result.data.defaultServiceTier).toBeUndefined();
  });

  it('accepts null to clear the default service tier', () => {
    const result = KeyConfigSchema.safeParse({ secret: 's', defaultServiceTier: null });
    expect(result.success).toBe(true);
    expect(result.success && result.data.defaultServiceTier).toBeNull();
  });

  it('rejects a tier outside the suffix vocabulary', () => {
    const result = KeyConfigSchema.safeParse({ secret: 's', defaultServiceTier: 'turbo' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-string tier', () => {
    const result = KeyConfigSchema.safeParse({ secret: 's', defaultServiceTier: 3 });
    expect(result.success).toBe(false);
  });
});

describe('validateConfig — key defaultServiceTier hydration', () => {
  it('surfaces defaultServiceTier from a persisted key config', () => {
    const cfg = validateConfig(
      baseConfigJson({ keys: { k1: { secret: 'sk-1', defaultServiceTier: 'flex' } } })
    );
    expect(cfg.keys.k1?.defaultServiceTier).toBe('flex');
  });

  it('leaves defaultServiceTier undefined for a key that does not set one', () => {
    const cfg = validateConfig(baseConfigJson({ keys: { k1: { secret: 'sk-1' } } }));
    expect(cfg.keys.k1?.defaultServiceTier).toBeUndefined();
  });
});
