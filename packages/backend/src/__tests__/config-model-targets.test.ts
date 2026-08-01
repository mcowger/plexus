import { describe, expect, it } from 'vitest';
import { findDuplicateAliasTargets, ModelConfigSchema } from '../config';

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
