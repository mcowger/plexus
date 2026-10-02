import { describe, expect, test } from 'vitest';
import { setConfigForTesting } from '../../../config';
import { Router } from '../router';

function alias(extra: Record<string, unknown> = {}) {
  return {
    target_groups: [
      { name: 'main', selector: 'in_order', targets: [{ provider: 'p1', model: 'model-1' }] },
    ],
    ...extra,
  };
}

function useModels(models: Record<string, unknown>) {
  setConfigForTesting({
    providers: {
      p1: {
        type: 'openai',
        api_base_url: 'https://p1.example.com/v1',
        models: { 'model-1': {} },
      },
    },
    models,
    keys: {},
  } as any);
}

describe('Router.splitServiceTier', () => {
  test('splits <alias>@<tier> when the bare name is an alias', () => {
    useModels({ 'gpt-6-luna': alias() });

    expect(Router.splitServiceTier('gpt-6-luna@flex')).toEqual({
      model: 'gpt-6-luna',
      serviceTier: 'flex',
    });
  });

  test('accepts an additional_aliases name as the bare alias', () => {
    useModels({ 'gpt-6-luna': alias({ additional_aliases: ['luna'] }) });

    expect(Router.splitServiceTier('luna@priority')).toEqual({
      model: 'luna',
      serviceTier: 'priority',
    });
  });

  test('leaves a name unchanged when it is itself an alias', () => {
    useModels({ 'gpt-6-luna': alias(), 'gpt-6-luna@flex': alias() });

    expect(Router.splitServiceTier('gpt-6-luna@flex')).toEqual({ model: 'gpt-6-luna@flex' });
  });

  test('leaves a name unchanged when it is an additional_aliases entry', () => {
    useModels({ 'gpt-6-luna': alias({ additional_aliases: ['luna@flex'] }) });

    expect(Router.splitServiceTier('luna@flex')).toEqual({ model: 'luna@flex' });
  });

  test('leaves unknown models unchanged so they still fail as not found', async () => {
    useModels({ 'gpt-6-luna': alias() });

    expect(Router.splitServiceTier('nope@flex')).toEqual({ model: 'nope@flex' });
    await expect(Router.resolve('nope@flex')).rejects.toThrow(
      "Model 'nope@flex' not found in configuration"
    );
  });

  test('ignores an unknown tier', () => {
    useModels({ 'gpt-6-luna': alias() });

    expect(Router.splitServiceTier('gpt-6-luna@turbo')).toEqual({ model: 'gpt-6-luna@turbo' });
  });

  test('does not apply to direct/ routing', () => {
    useModels({ 'gpt-6-luna': alias() });

    expect(Router.splitServiceTier('direct/p1/model-1@flex')).toEqual({
      model: 'direct/p1/model-1@flex',
    });
  });
});
