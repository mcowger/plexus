import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { Router } from '../routing/router';
import { CooldownManager } from '../runtime/cooldown-manager';
import { setConfigForTesting, assertNoAliasRefCycles } from '../../config';

const cooldownManager = CooldownManager.getInstance();

function makeConfig(models: Record<string, any>) {
  return {
    providers: {
      p1: {
        type: 'openai',
        api_base_url: 'https://p1.example.com/v1',
        models: { 'model-1': {} },
      },
      p2: {
        type: 'openai',
        api_base_url: 'https://p2.example.com/v1',
        models: { 'model-2': {} },
      },
      p3: {
        type: 'openai',
        api_base_url: 'https://p3.example.com/v1',
        models: { 'model-3': {} },
      },
    },
    models,
    keys: {},
  } as any;
}

describe('Alias-as-fallback-target', () => {
  beforeEach(async () => {
    await cooldownManager.clearCooldown();
  });

  afterEach(async () => {
    await cooldownManager.clearCooldown();
  });

  test('alias-ref expands to referenced alias target', async () => {
    setConfigForTesting(
      makeConfig({
        A: {
          target_groups: [{ name: 'primary', selector: 'in_order', targets: [{ alias: 'B' }] }],
        },
        B: {
          target_groups: [
            {
              name: 'primary',
              selector: 'in_order',
              targets: [{ provider: 'p1', model: 'model-1' }],
            },
          ],
        },
      })
    );

    const result = await Router.resolveCandidates('A');
    expect(result).toHaveLength(1);
    expect(result[0]?.provider).toBe('p1');
    expect(result[0]?.model).toBe('model-1');
  });

  test('nested alias-refs (2+ levels) expand to the deepest concrete targets', async () => {
    setConfigForTesting(
      makeConfig({
        A: {
          target_groups: [{ name: 'primary', selector: 'in_order', targets: [{ alias: 'B' }] }],
        },
        B: {
          target_groups: [{ name: 'primary', selector: 'in_order', targets: [{ alias: 'C' }] }],
        },
        C: {
          target_groups: [
            {
              name: 'primary',
              selector: 'in_order',
              targets: [{ provider: 'p3', model: 'model-3' }],
            },
          ],
        },
      })
    );

    const result = await Router.resolveCandidates('A');
    expect(result).toHaveLength(1);
    expect(result[0]?.provider).toBe('p3');
    expect(result[0]?.model).toBe('model-3');
  });

  test('referenced alias keeps its own target_groups/selectors when expanded', async () => {
    setConfigForTesting(
      makeConfig({
        A: {
          target_groups: [{ name: 'primary', selector: 'in_order', targets: [{ alias: 'B' }] }],
        },
        B: {
          target_groups: [
            {
              name: 'b-primary',
              selector: 'in_order',
              targets: [{ provider: 'p1', model: 'model-1' }],
            },
            {
              name: 'b-fallback',
              selector: 'in_order',
              targets: [{ provider: 'p2', model: 'model-2' }],
            },
          ],
        },
      })
    );

    const result = await Router.resolveCandidates('A');
    expect(result).toHaveLength(2);
    expect(result[0]?.provider).toBe('p1');
    expect(result[1]?.provider).toBe('p2');
  });

  test('two alias-refs resolving to the same (provider, model) dedupe to one candidate', async () => {
    setConfigForTesting(
      makeConfig({
        A: {
          target_groups: [
            {
              name: 'primary',
              selector: 'in_order',
              targets: [{ alias: 'B' }, { alias: 'C' }],
            },
          ],
        },
        B: {
          target_groups: [
            {
              name: 'primary',
              selector: 'in_order',
              targets: [{ provider: 'p1', model: 'model-1' }],
            },
          ],
        },
        C: {
          target_groups: [
            {
              name: 'primary',
              selector: 'in_order',
              targets: [{ provider: 'p1', model: 'model-1' }],
            },
          ],
        },
      })
    );

    const result = await Router.resolveCandidates('A');
    expect(result).toHaveLength(1);
    expect(result[0]?.provider).toBe('p1');
    expect(result[0]?.model).toBe('model-1');
  });

  test('enabled:false on an alias-ref target skips it', async () => {
    setConfigForTesting(
      makeConfig({
        A: {
          target_groups: [
            {
              name: 'primary',
              selector: 'in_order',
              targets: [
                { alias: 'B', enabled: false },
                { provider: 'p2', model: 'model-2' },
              ],
            },
          ],
        },
        B: {
          target_groups: [
            {
              name: 'primary',
              selector: 'in_order',
              targets: [{ provider: 'p1', model: 'model-1' }],
            },
          ],
        },
      })
    );

    const result = await Router.resolveCandidates('A');
    expect(result).toHaveLength(1);
    expect(result[0]?.provider).toBe('p2');
    expect(result[0]?.model).toBe('model-2');
  });

  test('alias-ref expansions are appended after selector-ordered concrete targets', async () => {
    setConfigForTesting(
      makeConfig({
        A: {
          target_groups: [
            {
              name: 'primary',
              selector: 'in_order',
              targets: [{ alias: 'B' }, { provider: 'p2', model: 'model-2' }],
            },
          ],
        },
        B: {
          target_groups: [
            {
              name: 'primary',
              selector: 'in_order',
              targets: [{ provider: 'p1', model: 'model-1' }],
            },
          ],
        },
      })
    );

    const result = await Router.resolveCandidates('A');
    expect(result).toHaveLength(2);
    expect(result[0]?.provider).toBe('p2');
    expect(result[1]?.provider).toBe('p1');
  });

  test('alias-ref declared after a concrete target stays as fallback', async () => {
    setConfigForTesting(
      makeConfig({
        A: {
          target_groups: [
            {
              name: 'primary',
              selector: 'in_order',
              targets: [{ provider: 'p2', model: 'model-2' }, { alias: 'B' }],
            },
          ],
        },
        B: {
          target_groups: [
            {
              name: 'primary',
              selector: 'in_order',
              targets: [{ provider: 'p1', model: 'model-1' }],
            },
          ],
        },
      })
    );

    const result = await Router.resolveCandidates('A');
    expect(result).toHaveLength(2);
    expect(result[0]?.provider).toBe('p2');
    expect(result[1]?.provider).toBe('p1');
  });

  test('direct/<alias>/<group> resolves a group containing only an alias-ref', async () => {
    setConfigForTesting(
      makeConfig({
        A: {
          target_groups: [{ name: 'primary', selector: 'in_order', targets: [{ alias: 'B' }] }],
        },
        B: {
          target_groups: [
            {
              name: 'primary',
              selector: 'in_order',
              targets: [{ provider: 'p1', model: 'model-1' }],
            },
          ],
        },
      })
    );

    const result = await Router.resolve('direct/A/primary');
    expect(result.provider).toBe('p1');
    expect(result.model).toBe('model-1');
  });

  test('assertNoAliasRefCycles throws on A -> B -> A', () => {
    const models = {
      A: {
        target_groups: [
          { name: 'primary', selector: 'in_order' as const, targets: [{ alias: 'B' }] },
        ],
      },
      B: {
        target_groups: [
          { name: 'primary', selector: 'in_order' as const, targets: [{ alias: 'A' }] },
        ],
      },
    } as any;

    expect(() => assertNoAliasRefCycles(models)).toThrow(/Alias reference cycle detected/);
  });

  test('ignores disabled alias-ref edges when detecting cycles', () => {
    const models = {
      A: {
        target_groups: [
          {
            name: 'primary',
            selector: 'in_order' as const,
            targets: [{ alias: 'B', enabled: false }],
          },
        ],
      },
      B: {
        target_groups: [
          { name: 'primary', selector: 'in_order' as const, targets: [{ alias: 'A' }] },
        ],
      },
    } as any;

    expect(() => assertNoAliasRefCycles(models)).not.toThrow();
  });
});
