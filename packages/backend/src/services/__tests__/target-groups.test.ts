import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { registerSpy } from '../../../test/test-utils';
import { Router } from '../router';
import { setConfigForTesting } from '../../config';
import { CooldownManager, type Target } from '../cooldown-manager';

const cooldownManager = CooldownManager.getInstance();

function makeGroupedConfig(
  groups: { name: string; selector: string; targets: any[] }[],
  providerOverrides?: Record<string, any>
) {
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
      ...providerOverrides,
    },
    models: {
      'test-alias': {
        target_groups: groups,
      },
    },
    keys: {},
  } as any;
}

describe('Router target groups', () => {
  beforeEach(async () => {
    await cooldownManager.clearCooldown();
  });

  afterEach(async () => {
    registerSpy(cooldownManager, 'filterHealthyTargets').mockRestore();
    await cooldownManager.clearCooldown();
  });

  test('resolve picks from first group when all targets healthy', async () => {
    setConfigForTesting(
      makeGroupedConfig([
        { name: 'primary', selector: 'in_order', targets: [{ provider: 'p1', model: 'model-1' }] },
        { name: 'fallback', selector: 'in_order', targets: [{ provider: 'p2', model: 'model-2' }] },
      ])
    );

    // No cooldowns — all healthy
    registerSpy(cooldownManager, 'filterHealthyTargets').mockImplementation(
      async (targets: Target[]) => targets
    );

    const result = await Router.resolve('test-alias');
    expect(result.provider).toBe('p1');
    expect(result.model).toBe('model-1');
  });

  test('resolve falls back to second group when first group is fully unhealthy', async () => {
    setConfigForTesting(
      makeGroupedConfig([
        { name: 'primary', selector: 'in_order', targets: [{ provider: 'p1', model: 'model-1' }] },
        { name: 'fallback', selector: 'in_order', targets: [{ provider: 'p2', model: 'model-2' }] },
      ])
    );

    // p1 on cooldown, p2 healthy
    registerSpy(cooldownManager, 'filterHealthyTargets').mockImplementation(
      async (targets: Target[]) => targets.filter((t: any) => t.provider === 'p2')
    );

    const result = await Router.resolve('test-alias');
    expect(result.provider).toBe('p2');
    expect(result.model).toBe('model-2');
  });

  test('resolve falls back through three groups', async () => {
    setConfigForTesting(
      makeGroupedConfig([
        { name: 'g1', selector: 'in_order', targets: [{ provider: 'p1', model: 'model-1' }] },
        { name: 'g2', selector: 'in_order', targets: [{ provider: 'p2', model: 'model-2' }] },
        { name: 'g3', selector: 'in_order', targets: [{ provider: 'p3', model: 'model-3' }] },
      ])
    );

    // Only p3 healthy
    registerSpy(cooldownManager, 'filterHealthyTargets').mockImplementation(
      async (targets: Target[]) => targets.filter((t: any) => t.provider === 'p3')
    );

    const result = await Router.resolve('test-alias');
    expect(result.provider).toBe('p3');
    expect(result.model).toBe('model-3');
  });

  test('resolve throws when all groups are exhausted', async () => {
    setConfigForTesting(
      makeGroupedConfig([
        { name: 'g1', selector: 'in_order', targets: [{ provider: 'p1', model: 'model-1' }] },
        { name: 'g2', selector: 'in_order', targets: [{ provider: 'p2', model: 'model-2' }] },
      ])
    );

    registerSpy(cooldownManager, 'filterHealthyTargets').mockResolvedValue([]);

    await expect(Router.resolve('test-alias')).rejects.toThrow(
      "No healthy target selected for alias 'test-alias'"
    );
  });

  test('empty group is skipped', async () => {
    setConfigForTesting(
      makeGroupedConfig([
        { name: 'empty', selector: 'in_order', targets: [] },
        { name: 'fallback', selector: 'in_order', targets: [{ provider: 'p2', model: 'model-2' }] },
      ])
    );

    registerSpy(cooldownManager, 'filterHealthyTargets').mockImplementation(
      async (targets: Target[]) => targets
    );

    const result = await Router.resolve('test-alias');
    expect(result.provider).toBe('p2');
  });

  test('resolveCandidates returns ordered targets grouped by priority', async () => {
    setConfigForTesting(
      makeGroupedConfig([
        {
          name: 'primary',
          selector: 'in_order',
          targets: [
            { provider: 'p1', model: 'model-1' },
            { provider: 'p2', model: 'model-2' },
          ],
        },
        {
          name: 'fallback',
          selector: 'in_order',
          targets: [{ provider: 'p3', model: 'model-3' }],
        },
      ])
    );

    registerSpy(cooldownManager, 'filterHealthyTargets').mockImplementation(
      async (targets: Target[]) => targets
    );

    const result = await Router.resolveCandidates('test-alias');
    expect(result).toHaveLength(3);
    expect(result[0]?.provider).toBe('p1');
    expect(result[1]?.provider).toBe('p2');
    expect(result[2]?.provider).toBe('p3');
  });

  test('resolveCandidates skips empty groups', async () => {
    setConfigForTesting(
      makeGroupedConfig([
        { name: 'empty', selector: 'in_order', targets: [] },
        {
          name: 'primary',
          selector: 'in_order',
          targets: [
            { provider: 'p1', model: 'model-1' },
            { provider: 'p2', model: 'model-2' },
          ],
        },
      ])
    );

    registerSpy(cooldownManager, 'filterHealthyTargets').mockImplementation(
      async (targets: Target[]) => targets
    );

    const result = await Router.resolveCandidates('test-alias');
    expect(result).toHaveLength(2);
    expect(result[0]?.provider).toBe('p1');
    expect(result[1]?.provider).toBe('p2');
  });

  test('resolveCandidates skips fully unhealthy groups', async () => {
    setConfigForTesting(
      makeGroupedConfig([
        {
          name: 'primary',
          selector: 'in_order',
          targets: [{ provider: 'p1', model: 'model-1' }],
        },
        {
          name: 'fallback',
          selector: 'in_order',
          targets: [{ provider: 'p3', model: 'model-3' }],
        },
      ])
    );

    // p1 on cooldown, p3 healthy
    registerSpy(cooldownManager, 'filterHealthyTargets').mockImplementation(
      async (targets: Target[]) => targets.filter((t: any) => t.provider === 'p3')
    );

    const result = await Router.resolveCandidates('test-alias');
    expect(result).toHaveLength(1);
    expect(result[0]?.provider).toBe('p3');
  });

  test('different selector per group', async () => {
    setConfigForTesting(
      makeGroupedConfig([
        {
          name: 'random-group',
          selector: 'random',
          targets: [
            { provider: 'p1', model: 'model-1' },
            { provider: 'p2', model: 'model-2' },
          ],
        },
        {
          name: 'fallback',
          selector: 'in_order',
          targets: [{ provider: 'p3', model: 'model-3' }],
        },
      ])
    );

    // All healthy
    registerSpy(cooldownManager, 'filterHealthyTargets').mockImplementation(
      async (targets: Target[]) => targets
    );

    // Random selector should pick one of p1/p2
    const result = await Router.resolve('test-alias');
    expect(['p1', 'p2']).toContain(result.provider);

    // If we cool down p1 and p2, it should fall back to p3
    registerSpy(cooldownManager, 'filterHealthyTargets').mockImplementation(
      async (targets: Target[]) => targets.filter((t: any) => t.provider === 'p3')
    );

    const fallbackResult = await Router.resolve('test-alias');
    expect(fallbackResult.provider).toBe('p3');
  });

  test('disabled targets within a group are excluded', async () => {
    setConfigForTesting(
      makeGroupedConfig([
        {
          name: 'primary',
          selector: 'in_order',
          targets: [
            { provider: 'p1', model: 'model-1', enabled: false },
            { provider: 'p2', model: 'model-2' },
          ],
        },
      ])
    );

    registerSpy(cooldownManager, 'filterHealthyTargets').mockImplementation(
      async (targets: Target[]) => targets
    );

    const result = await Router.resolve('test-alias');
    expect(result.provider).toBe('p2');
  });

  test('disabled provider targets are excluded', async () => {
    setConfigForTesting(
      makeGroupedConfig(
        [
          {
            name: 'primary',
            selector: 'in_order',
            targets: [
              { provider: 'p1', model: 'model-1' },
              { provider: 'p2', model: 'model-2' },
            ],
          },
        ],
        {
          p1: {
            type: 'openai',
            api_base_url: 'https://p1.example.com/v1',
            enabled: false,
            models: { 'model-1': {} },
          },
        }
      )
    );

    registerSpy(cooldownManager, 'filterHealthyTargets').mockImplementation(
      async (targets: Target[]) => targets
    );

    const result = await Router.resolve('test-alias');
    expect(result.provider).toBe('p2');
  });

  test('alias without target_groups returns empty candidates', async () => {
    setConfigForTesting({
      providers: {},
      models: {
        'no-groups': {},
      },
      keys: {},
    } as any);

    const result = await Router.resolveCandidates('no-groups');
    expect(result).toEqual([]);
  });

  test('resolve preserves canonical model and incoming alias through groups', async () => {
    setConfigForTesting({
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
      },
      models: {
        'canonical-model': {
          target_groups: [
            { name: 'g1', selector: 'in_order', targets: [{ provider: 'p1', model: 'model-1' }] },
          ],
          additional_aliases: ['alias-name'],
        },
      },
      keys: {},
    } as any);

    registerSpy(cooldownManager, 'filterHealthyTargets').mockImplementation(
      async (targets: Target[]) => targets
    );

    const result = await Router.resolve('alias-name');
    expect(result.canonicalModel).toBe('canonical-model');
    expect(result.incomingModelAlias).toBe('alias-name');
  });
});
