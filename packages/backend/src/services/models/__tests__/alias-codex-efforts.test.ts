import { describe, expect, test } from 'bun:test';

import type { ModelConfig, ProviderConfig } from '../../../config';
import { createAliasCodexEffortResolver } from '../alias-codex-efforts';

describe('createAliasCodexEffortResolver', () => {
  test('skips an alias target that has no text protocol instead of throwing', async () => {
    const models = {
      'image-alias': {
        target_groups: [
          {
            name: 'primary',
            selector: 'in_order',
            targets: [
              { provider: 'codex', model: 'gpt-image-1' },
              { provider: 'images-only', model: 'img' },
            ],
          },
        ],
      },
    } as unknown as Record<string, ModelConfig>;
    const providers = {
      codex: {
        api_base_url: 'oauth://',
        api_key: 'oauth',
        models: { 'gpt-image-1': { access_via: ['codex-images'], type: 'image' } },
      },
      'images-only': {
        api_base_url: {
          'openai-images': 'https://provider.example/v1',
          transcriptions: 'https://provider.example/v1',
        },
        api_key: 'k',
      },
    } as unknown as Record<string, ProviderConfig>;

    const result = await createAliasCodexEffortResolver(models, providers)('image-alias');

    expect(result).toBeUndefined();
  });
});
