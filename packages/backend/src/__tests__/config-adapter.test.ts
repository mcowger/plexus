import { describe, expect, it } from 'vitest';
import { validateConfig } from '../config';

describe('adapter configuration', () => {
  it('accepts a disabled model adapter entry', () => {
    const config = validateConfig(
      JSON.stringify({
        providers: {
          upstream: {
            api_base_url: 'https://api.example.com/v1',
            api_key: 'test-key',
            models: {
              'gpt-5.2': {
                pricing: { source: 'simple', input: 0, output: 0 },
                adapter: [{ name: 'suppress_unsupported_gpt5_options', enabled: false }],
              },
            },
          },
        },
        models: {},
        keys: {},
      })
    );

    const models = config.providers.upstream!.models as Record<string, any>;
    expect(models['gpt-5.2']!.adapter).toEqual([
      { name: 'suppress_unsupported_gpt5_options', options: {}, enabled: false },
    ]);
  });
});
