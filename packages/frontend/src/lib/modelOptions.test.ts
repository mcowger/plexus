import { describe, expect, test } from 'vitest';

import type { AliasTargetGroup, Model } from './api';
import { dedupeAliasTargets, dedupeById, dedupeModels, getModelOptionKey } from './modelOptions';

describe('model option helpers', () => {
  test('deduplicates provider model options without merging providers', () => {
    const models: Model[] = [
      { id: 'duplicate', name: 'Duplicate', providerId: 'openrouter' },
      { id: 'duplicate', name: 'Duplicate again', providerId: 'openrouter' },
      { id: 'duplicate', name: 'Duplicate local', providerId: 'local' },
    ];

    expect(dedupeModels(models)).toEqual([models[0], models[2]]);
    expect(getModelOptionKey('openrouter', 'duplicate')).not.toBe(
      getModelOptionKey('local', 'duplicate')
    );
  });

  test('deduplicates catalog results by id', () => {
    expect(
      dedupeById([
        { id: 'model-1', name: 'First' },
        { id: 'model-1', name: 'Duplicate' },
        { id: 'model-2', name: 'Second' },
      ])
    ).toEqual([
      { id: 'model-1', name: 'First' },
      { id: 'model-2', name: 'Second' },
    ]);
  });

  test('keeps only the first occurrence of an alias target', () => {
    const groups: AliasTargetGroup[] = [
      {
        name: 'primary',
        selector: 'random',
        targets: [{ provider: 'openrouter', model: 'model-1' }],
      },
      {
        name: 'fallback',
        selector: 'in_order',
        targets: [
          { provider: 'openrouter', model: 'model-1' },
          { provider: 'local', model: 'model-1' },
        ],
      },
    ];

    expect(dedupeAliasTargets(groups)).toEqual([
      groups[0],
      {
        ...groups[1],
        targets: [{ provider: 'local', model: 'model-1' }],
      },
    ]);
  });

  test('keeps distinct alias-ref targets without colliding on missing provider/model', () => {
    const groups: AliasTargetGroup[] = [
      {
        name: 'primary',
        selector: 'in_order',
        targets: [
          { alias: 'fallback-a', enabled: true },
          { alias: 'fallback-b', enabled: true },
          { alias: 'fallback-a', enabled: true },
        ],
      },
    ];

    expect(dedupeAliasTargets(groups)).toEqual([
      {
        ...groups[0],
        targets: [
          { alias: 'fallback-a', enabled: true },
          { alias: 'fallback-b', enabled: true },
        ],
      },
    ]);
  });
});
