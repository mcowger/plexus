import { describe, expect, it } from 'vitest';

import { validateConfig } from '../config';

function configWithMetadata(metadata: unknown): string {
  return JSON.stringify({
    providers: {
      p1: {
        api_base_url: 'https://p1.example.com/v1',
        api_key: 'k',
        models: { 'model-1': {} },
      },
    },
    models: {
      'test-alias': {
        target_groups: [
          {
            name: 'default',
            selector: 'random',
            targets: [{ provider: 'p1', model: 'model-1' }],
          },
        ],
        metadata,
      },
    },
    keys: {},
  });
}

describe('ModelConfigSchema metadata modes', () => {
  it('accepts automatic metadata with partial overrides', () => {
    const config = validateConfig(
      configWithMetadata({ source: 'auto', overrides: { context_length: 32000 } })
    );

    expect(config.models['test-alias']?.metadata).toEqual({
      source: 'auto',
      overrides: { context_length: 32000 },
    });
  });

  it('accepts disabled metadata without a source path', () => {
    const config = validateConfig(configWithMetadata({ source: 'disabled' }));

    expect(config.models['test-alias']?.metadata).toEqual({ source: 'disabled' });
  });

  it('accepts a short_name override and trims it', () => {
    const config = validateConfig(
      configWithMetadata({ source: 'auto', overrides: { short_name: '  Sonnet 5.5  ' } })
    );

    expect(config.models['test-alias']?.metadata).toEqual({
      source: 'auto',
      overrides: { short_name: 'Sonnet 5.5' },
    });
  });

  it('rejects blank and over-long short_name overrides', () => {
    expect(() =>
      validateConfig(configWithMetadata({ source: 'auto', overrides: { short_name: '   ' } }))
    ).toThrow();
    expect(() =>
      validateConfig(
        configWithMetadata({ source: 'auto', overrides: { short_name: 'x'.repeat(65) } })
      )
    ).toThrow();
  });
});
