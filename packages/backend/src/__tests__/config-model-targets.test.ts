import { describe, expect, it } from 'bun:test';

import {
  findDuplicateAdditionalAliases,
  findDuplicateAliasTargets,
  ModelConfigSchema,
} from '../config';

describe('model alias target validation', () => {
  it('finds duplicate provider/model pairs across target groups', () => {
    expect(
      findDuplicateAliasTargets([
        {
          targets: [{ provider: 'openrouter', model: 'google/gemini-3.1-pro-preview-customtools' }],
        },
        {
          targets: [{ provider: 'openrouter', model: 'google/gemini-3.1-pro-preview-customtools' }],
        },
      ])
    ).toEqual([{ provider: 'openrouter', model: 'google/gemini-3.1-pro-preview-customtools' }]);
  });

  it('rejects duplicate targets before persistence', () => {
    const result = ModelConfigSchema.safeParse({
      target_groups: [
        {
          name: 'primary',
          selector: 'random',
          targets: [{ provider: 'openrouter', model: 'duplicate-model' }],
        },
        {
          name: 'fallback',
          selector: 'in_order',
          targets: [{ provider: 'openrouter', model: 'duplicate-model' }],
        },
      ],
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual([
      {
        code: 'custom',
        path: ['target_groups'],
        message: "Duplicate target 'openrouter/duplicate-model' is not allowed",
      },
    ]);
  });

  it('allows the same model through different providers', () => {
    const result = ModelConfigSchema.safeParse({
      target_groups: [
        {
          name: 'default',
          selector: 'random',
          targets: [
            { provider: 'openrouter', model: 'shared-model' },
            { provider: 'local', model: 'shared-model' },
          ],
        },
      ],
    });

    expect(result.success).toBe(true);
  });
});

describe('model alias additional_aliases validation', () => {
  it('finds duplicate additional alias names', () => {
    expect(
      findDuplicateAdditionalAliases([
        'gemini-3.1-pro',
        'google/gemini-3.1-pro-preview-customtools',
        'google/gemini-3.1-pro-preview-customtools',
      ])
    ).toEqual(['google/gemini-3.1-pro-preview-customtools']);
  });

  it('rejects duplicate additional aliases before persistence', () => {
    const result = ModelConfigSchema.safeParse({
      additional_aliases: ['gemini-3.1-pro', 'gemini-3.1-pro'],
      target_groups: [{ name: 'default', selector: 'random', targets: [] }],
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual([
      {
        code: 'custom',
        path: ['additional_aliases'],
        message: "Duplicate additional alias 'gemini-3.1-pro' is not allowed",
      },
    ]);
  });

  it('allows unique additional aliases', () => {
    const result = ModelConfigSchema.safeParse({
      additional_aliases: ['gemini-3.1-pro', 'gemini-3.1-pro-preview'],
      target_groups: [{ name: 'default', selector: 'random', targets: [] }],
    });

    expect(result.success).toBe(true);
  });
});
