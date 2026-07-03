import { describe, expect, it } from 'vitest';
import {
  KeyConfigSchema,
  QuotaDefinitionSchema,
  normalizeKeyConfig,
  validateConfig,
} from '../config';

function baseConfigJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    providers: {},
    models: {},
    keys: {},
    ...overrides,
  });
}

type MiniKeyConfig = { secret: string; quota?: string; quotas?: string[] };

describe('normalizeKeyConfig', () => {
  it('normalizes legacy `quota` to `quotas` when `quotas` is absent', () => {
    const input: MiniKeyConfig = { secret: 's', quota: 'my-quota' };
    const result = normalizeKeyConfig(input);
    expect(result.quotas).toEqual(['my-quota']);
  });

  it('leaves an explicit `quotas` untouched even when legacy `quota` is also present', () => {
    const input: MiniKeyConfig = {
      secret: 's',
      quota: 'legacy-quota',
      quotas: ['explicit-quota'],
    };
    const result = normalizeKeyConfig(input);
    expect(result.quotas).toEqual(['explicit-quota']);
  });

  it('leaves an explicit empty `quotas` array untouched (does not fall back to legacy quota)', () => {
    const input: MiniKeyConfig = { secret: 's', quota: 'legacy-quota', quotas: [] };
    const result = normalizeKeyConfig(input);
    expect(result.quotas).toEqual([]);
  });

  it('is a no-op when neither `quota` nor `quotas` is present', () => {
    const input: MiniKeyConfig = { secret: 's' };
    const result = normalizeKeyConfig(input);
    expect(result.quotas).toBeUndefined();
  });
});

describe('KeyConfigSchema', () => {
  it('accepts a legacy `quota` field on its own', () => {
    const result = KeyConfigSchema.safeParse({ secret: 's', quota: 'legacy' });
    expect(result.success).toBe(true);
  });

  it('accepts a `quotas` array on its own', () => {
    const result = KeyConfigSchema.safeParse({ secret: 's', quotas: ['a', 'b'] });
    expect(result.success).toBe(true);
    expect(result.success && result.data.quotas).toEqual(['a', 'b']);
  });

  it('rejects an empty-string entry inside `quotas`', () => {
    const result = KeyConfigSchema.safeParse({ secret: 's', quotas: [''] });
    expect(result.success).toBe(false);
  });
});

describe('validateConfig — key `quota`/`quotas` normalization on load', () => {
  it('normalizes a legacy `quota` field to `quotas` for a key at load time', () => {
    const cfg = validateConfig(
      baseConfigJson({
        keys: { k1: { secret: 'sk-1', quota: 'legacy-quota' } },
      })
    );
    expect(cfg.keys.k1?.quotas).toEqual(['legacy-quota']);
  });

  it('explicit `quotas` wins over legacy `quota` when both are present', () => {
    const cfg = validateConfig(
      baseConfigJson({
        keys: {
          k1: { secret: 'sk-1', quota: 'legacy-quota', quotas: ['explicit-quota'] },
        },
      })
    );
    expect(cfg.keys.k1?.quotas).toEqual(['explicit-quota']);
  });

  it('leaves `quotas` undefined for a key with neither `quota` nor `quotas`', () => {
    const cfg = validateConfig(
      baseConfigJson({
        keys: { k1: { secret: 'sk-1' } },
      })
    );
    expect(cfg.keys.k1?.quotas).toBeUndefined();
  });
});

describe('top-level `default_quotas` config field', () => {
  it('validateConfig accepts and surfaces default_quotas on the hydrated config', () => {
    const cfg = validateConfig(baseConfigJson({ default_quotas: ['fallback-quota'] }));
    expect(cfg.default_quotas).toEqual(['fallback-quota']);
  });
});

const ALL_QUOTA_TYPES: Array<Record<string, unknown>> = [
  { type: 'rolling', limitType: 'requests', limit: 10, duration: '1h' },
  { type: 'daily', limitType: 'requests', limit: 10 },
  { type: 'weekly', limitType: 'requests', limit: 10 },
  { type: 'monthly', limitType: 'requests', limit: 10 },
];

describe('QuotaDefinitionSchema scope fields', () => {
  it.each(ALL_QUOTA_TYPES)('accepts scope fields, shared, and warnAt on type=$type', (base) => {
    const result = QuotaDefinitionSchema.safeParse({
      ...base,
      allowedProviders: ['openai'],
      excludedProviders: ['anthropic'],
      allowedModels: ['gpt-4'],
      excludedModels: ['gpt-3.5'],
      shared: true,
      warnAt: 0.5,
    });
    expect(result.success).toBe(true);
  });

  it.each(ALL_QUOTA_TYPES)('omits scope fields fine on type=$type (all optional)', (base) => {
    const result = QuotaDefinitionSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it('rejects warnAt of exactly 0', () => {
    const result = QuotaDefinitionSchema.safeParse({
      type: 'daily',
      limitType: 'requests',
      limit: 10,
      warnAt: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects warnAt of exactly 1', () => {
    const result = QuotaDefinitionSchema.safeParse({
      type: 'daily',
      limitType: 'requests',
      limit: 10,
      warnAt: 1,
    });
    expect(result.success).toBe(false);
  });

  it('accepts warnAt of 0.5', () => {
    const result = QuotaDefinitionSchema.safeParse({
      type: 'daily',
      limitType: 'requests',
      limit: 10,
      warnAt: 0.5,
    });
    expect(result.success).toBe(true);
  });
});
