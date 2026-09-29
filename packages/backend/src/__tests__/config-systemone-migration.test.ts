import { describe, expect, it } from 'vitest';
import { normalizeSystemOneProviderConfig, validateConfig } from '../config';
import type { ProviderConfig } from '../config';

function provider(overrides: Record<string, unknown> = {}): ProviderConfig {
  return {
    api_base_url: 'https://api.typesafe.ai/v1',
    api_key: 'key',
    ...overrides,
  } as ProviderConfig;
}

function baseConfigJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    providers: {},
    models: {},
    keys: {},
    ...overrides,
  });
}

describe('normalizeSystemOneProviderConfig', () => {
  it('renames a legacy openrouter-decisions key and rewrites the alpha base', () => {
    const result = normalizeSystemOneProviderConfig(
      provider({
        api_base_url: { 'openrouter-decisions': 'https://openrouter.ai/api/alpha' },
      })
    );
    expect(result.api_base_url).toEqual({ systemone: 'https://openrouter.ai/api/v1' });
  });

  it('tolerates a trailing slash on the legacy alpha base', () => {
    const result = normalizeSystemOneProviderConfig(
      provider({
        api_base_url: { 'openrouter-decisions': 'https://openrouter.ai/api/alpha/' },
      })
    );
    expect(result.api_base_url).toEqual({ systemone: 'https://openrouter.ai/api/v1' });
  });

  it('keeps a custom base verbatim when renaming a legacy key', () => {
    const result = normalizeSystemOneProviderConfig(
      provider({
        api_base_url: { 'openrouter-decisions': 'https://proxy.example.com/decisions' },
      })
    );
    expect(result.api_base_url).toEqual({ systemone: 'https://proxy.example.com/decisions' });
  });

  it('lets an explicit systemone entry win over legacy keys', () => {
    const result = normalizeSystemOneProviderConfig(
      provider({
        api_base_url: {
          systemone: 'https://custom.example.com/v1',
          'openrouter-decisions': 'https://openrouter.ai/api/alpha',
          'typesafe-decisions': 'https://api.typesafe.ai/v1',
        },
      })
    );
    expect(result.api_base_url).toEqual({ systemone: 'https://custom.example.com/v1' });
  });

  it('maps legacy access_via entries onto systemone and dedupes by key', () => {
    const result = normalizeSystemOneProviderConfig(
      provider({
        models: {
          'jev-latest': {
            access_via: ['typesafe-decisions', 'systemone', { type: 'openrouter-decisions' }],
          },
        } as any,
      })
    );
    // 'systemone', 'typesafe-decisions'→'systemone', and {type:'systemone'}
    // all share one key, so they collapse to a single entry.
    expect((result.models as any)['jev-latest'].access_via).toEqual(['systemone']);
  });

  it('preserves access_via subtypes when mapping legacy entries', () => {
    const result = normalizeSystemOneProviderConfig(
      provider({
        models: {
          m: { access_via: [{ type: 'typesafe-decisions', subtype: 'v2' }] },
        } as any,
      })
    );
    expect((result.models as any).m.access_via).toEqual([{ type: 'systemone', subtype: 'v2' }]);
  });

  it('is a no-op for canonical configs and returns the same reference', () => {
    const input = provider({
      api_base_url: { systemone: 'https://openrouter.ai/api/v1' },
      models: { m: { access_via: ['systemone'] } } as any,
    });
    expect(normalizeSystemOneProviderConfig(input)).toBe(input);
  });

  it('leaves string bases and array model lists untouched', () => {
    const input = provider({
      api_base_url: 'https://api.typesafe.ai/v1',
      models: ['jev-latest'],
    });
    expect(normalizeSystemOneProviderConfig(input)).toBe(input);
  });
});

describe('validateConfig — systemone normalization on load', () => {
  it('normalizes a legacy stored provider to systemone at load time', () => {
    const cfg = validateConfig(
      baseConfigJson({
        providers: {
          openrouter: {
            api_base_url: { 'openrouter-decisions': 'https://openrouter.ai/api/alpha' },
            api_key: 'k',
            models: {
              'typesafe/jev-1.13': { access_via: ['openrouter-decisions'] },
            },
          },
        },
      })
    );
    expect(cfg.providers.openrouter?.api_base_url).toEqual({
      systemone: 'https://openrouter.ai/api/v1',
    });
    expect((cfg.providers.openrouter?.models as any)?.['typesafe/jev-1.13']?.access_via).toEqual([
      'systemone',
    ]);
  });
});
