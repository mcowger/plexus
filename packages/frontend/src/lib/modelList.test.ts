// @ts-expect-error bun:test available at runtime but not in frontend tsconfig
import { describe, expect, test } from 'bun:test';

import type { Alias, Provider } from './api';
import {
  aliasMatchesProviderFilters,
  filterAndSortAliasesForModelsPage,
  getAliasProviderLabels,
  getAliasTargetCount,
  getDefaultModelListSortDirection,
  getModelListProviderOptions,
} from './modelList';

const providers: Provider[] = [
  { id: 'openai', name: 'OpenAI', type: 'openai', apiKey: '', enabled: true },
  { id: 'anthropic', name: 'Anthropic', type: 'anthropic', apiKey: '', enabled: true },
  { id: 'neuralwatt', name: 'Neuralwatt', type: 'openai', apiKey: '', enabled: true },
];

const aliases: Alias[] = [
  {
    id: 'alpha',
    target_groups: [
      {
        name: 'default',
        selector: 'random',
        targets: [
          { provider: 'openai', model: 'gpt-4o-mini' },
          { provider: 'anthropic', model: 'claude-3-5-sonnet' },
        ],
      },
    ],
  },
  {
    id: 'beta',
    target_groups: [
      {
        name: 'default',
        selector: 'random',
        targets: [{ provider: 'neuralwatt', model: 'nw-1' }],
      },
    ],
  },
  {
    id: 'gamma',
    target_groups: [
      {
        name: 'default',
        selector: 'random',
        targets: [
          { provider: 'anthropic', model: 'claude-3-opus' },
          { provider: 'anthropic', model: 'claude-3-haiku' },
        ],
      },
    ],
  },
];

describe('model list helpers', () => {
  test('derives provider labels and target counts from aliases', () => {
    expect(getAliasProviderLabels(aliases[0], providers)).toEqual([
      'Anthropic (anthropic)',
      'OpenAI (openai)',
    ]);
    expect(getAliasTargetCount(aliases[0])).toBe(2);
    expect(getAliasTargetCount(aliases[2])).toBe(2);
  });

  test('builds provider filter options from the configured aliases', () => {
    expect(getModelListProviderOptions(aliases, providers)).toEqual([
      'Anthropic (anthropic)',
      'Neuralwatt (neuralwatt)',
      'OpenAI (openai)',
    ]);
  });

  test('matches provider filters using any target provider', () => {
    expect(aliasMatchesProviderFilters(aliases[0], ['OpenAI (openai)'], providers)).toBe(true);
    expect(aliasMatchesProviderFilters(aliases[0], ['Neuralwatt (neuralwatt)'], providers)).toBe(
      false
    );
    expect(aliasMatchesProviderFilters(aliases[1], ['Neuralwatt (neuralwatt)'], providers)).toBe(
      true
    );
  });

  test('sorts aliases by provider and target count', () => {
    expect(
      filterAndSortAliasesForModelsPage(aliases, providers, '', [], 'provider', 'asc').map(
        (alias) => alias.id
      )
    ).toEqual(['gamma', 'beta', 'alpha']);

    expect(
      filterAndSortAliasesForModelsPage(aliases, providers, '', [], 'targets', 'desc').map(
        (alias) => alias.id
      )
    ).toEqual(['alpha', 'gamma', 'beta']);
  });

  test('falls back to alias sorting and provider filtering together', () => {
    expect(getDefaultModelListSortDirection('targets')).toBe('desc');
    expect(getDefaultModelListSortDirection('alias')).toBe('asc');

    expect(
      filterAndSortAliasesForModelsPage(
        aliases,
        providers,
        '',
        ['Anthropic (anthropic)'],
        'alias',
        'asc'
      ).map((alias) => alias.id)
    ).toEqual(['alpha', 'gamma']);
  });
});
