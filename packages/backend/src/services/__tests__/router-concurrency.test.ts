import { describe, expect, test, beforeEach } from 'vitest';
import { Router } from '../router';
import { ConcurrencyTracker } from '../concurrency-tracker';
import { CooldownManager } from '../cooldown-manager';
import { setConfigForTesting } from '../../config';

// We use resolveCandidates (plural) because it returns the full ordered
// list of healthy targets — this lets us assert on ordering and filtering.
// resolve() returns only the first pick.

describe('Router concurrency filter', () => {
  beforeEach(() => {
    ConcurrencyTracker.resetForTesting();
    CooldownManager.resetInstance();
  });

  test('preserves in_order target ordering when one provider has maxConcurrency', async () => {
    // Two providers: p1 has maxConcurrency=2, p2 has no limit.
    // With in_order selector, p1 should always be preferred when under limit.
    setConfigForTesting({
      providers: {
        p1: {
          api_base_url: 'http://p1',
          api_key: 'k1',
          enabled: true,
          maxConcurrency: 2,
          models: { 'model-a': {} },
        },
        p2: {
          api_base_url: 'http://p2',
          api_key: 'k2',
          enabled: true,
          models: { 'model-b': {} },
        },
      },
      models: {
        'test-model': {
          selector: 'in_order',
          target_groups: [
            {
              name: 'default',
              selector: 'in_order',
              targets: [
                { provider: 'p1', model: 'model-a', enabled: true },
                { provider: 'p2', model: 'model-b', enabled: true },
              ],
            },
          ],
        },
      },
      keys: {},
      quotas: [],
    } as any);

    // When no requests are in-flight, p1 should be the first result
    const result = await Router.resolveCandidates('test-model', 'chat');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.provider).toBe('p1');
  });

  test('filters out provider at concurrency limit but keeps lower-priority targets', async () => {
    setConfigForTesting({
      providers: {
        p1: {
          api_base_url: 'http://p1',
          api_key: 'k1',
          enabled: true,
          maxConcurrency: 1,
          models: { 'model-a': {} },
        },
        p2: {
          api_base_url: 'http://p2',
          api_key: 'k2',
          enabled: true,
          models: { 'model-b': {} },
        },
      },
      models: {
        'test-model': {
          selector: 'in_order',
          target_groups: [
            {
              name: 'default',
              selector: 'in_order',
              targets: [
                { provider: 'p1', model: 'model-a', enabled: true },
                { provider: 'p2', model: 'model-b', enabled: true },
              ],
            },
          ],
        },
      },
      keys: {},
      quotas: [],
    } as any);

    // Simulate p1 being at its concurrency limit
    const tracker = ConcurrencyTracker.getInstance();
    tracker.acquire('p1', 'model-a'); // count = 1, which equals maxConcurrency

    // p1 should be filtered out; p2 should remain as the only candidate
    const result = await Router.resolveCandidates('test-model', 'chat');
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((r) => r.provider !== 'p1')).toBe(true);
    expect(result.some((r) => r.provider === 'p2')).toBe(true);
  });

  test('preserves target order when concurrency-exempt and concurrency-eligible are interleaved', async () => {
    // Three providers in order: p1 (no limit), p2 (limit=1, at limit), p3 (no limit)
    // After concurrency filter, we should get [p1, p3] in that order — NOT [p1, p3, ...]
    // reorganized as [exempt, eligible] which was the old bug.
    setConfigForTesting({
      providers: {
        p1: {
          api_base_url: 'http://p1',
          api_key: 'k1',
          enabled: true,
          // no maxConcurrency → exempt
          models: { 'model-a': {} },
        },
        p2: {
          api_base_url: 'http://p2',
          api_key: 'k2',
          enabled: true,
          maxConcurrency: 1,
          models: { 'model-b': {} },
        },
        p3: {
          api_base_url: 'http://p3',
          api_key: 'k3',
          enabled: true,
          // no maxConcurrency → exempt
          models: { 'model-c': {} },
        },
      },
      models: {
        'test-model': {
          selector: 'in_order',
          target_groups: [
            {
              name: 'default',
              selector: 'in_order',
              targets: [
                { provider: 'p1', model: 'model-a', enabled: true },
                { provider: 'p2', model: 'model-b', enabled: true },
                { provider: 'p3', model: 'model-c', enabled: true },
              ],
            },
          ],
        },
      },
      keys: {},
      quotas: [],
    } as any);

    // Fill p2 to its limit
    const tracker = ConcurrencyTracker.getInstance();
    tracker.acquire('p2', 'model-b');

    // Result should preserve original order: p1 first, p3 second (p2 filtered)
    const result = await Router.resolveCandidates('test-model', 'chat');
    expect(result.length).toBe(2);
    expect(result[0]!.provider).toBe('p1');
    expect(result[1]!.provider).toBe('p3');
  });

  test('provider with maxConcurrency under limit remains in order', async () => {
    setConfigForTesting({
      providers: {
        p1: {
          api_base_url: 'http://p1',
          api_key: 'k1',
          enabled: true,
          maxConcurrency: 5,
          models: { 'model-a': {} },
        },
        p2: {
          api_base_url: 'http://p2',
          api_key: 'k2',
          enabled: true,
          models: { 'model-b': {} },
        },
      },
      models: {
        'test-model': {
          selector: 'in_order',
          target_groups: [
            {
              name: 'default',
              selector: 'in_order',
              targets: [
                { provider: 'p1', model: 'model-a', enabled: true },
                { provider: 'p2', model: 'model-b', enabled: true },
              ],
            },
          ],
        },
      },
      keys: {},
      quotas: [],
    } as any);

    // p1 has 2 in-flight but limit is 5, so it should still be first
    const tracker = ConcurrencyTracker.getInstance();
    tracker.acquire('p1', 'model-a');
    tracker.acquire('p1', 'model-a');

    const result = await Router.resolveCandidates('test-model', 'chat');
    expect(result.length).toBe(2);
    expect(result[0]!.provider).toBe('p1');
    expect(result[1]!.provider).toBe('p2');
  });

  test('all providers at concurrency limit returns empty targets', async () => {
    setConfigForTesting({
      providers: {
        p1: {
          api_base_url: 'http://p1',
          api_key: 'k1',
          enabled: true,
          maxConcurrency: 1,
          models: { 'model-a': {} },
        },
      },
      models: {
        'test-model': {
          selector: 'in_order',
          target_groups: [
            {
              name: 'default',
              selector: 'in_order',
              targets: [{ provider: 'p1', model: 'model-a', enabled: true }],
            },
          ],
        },
      },
      keys: {},
      quotas: [],
    } as any);

    // Fill p1 to its limit
    const tracker = ConcurrencyTracker.getInstance();
    tracker.acquire('p1', 'model-a');

    const result = await Router.resolveCandidates('test-model', 'chat');
    expect(result.length).toBe(0);
  });

  test('model-level maxConcurrency filters per-target independently', async () => {
    setConfigForTesting({
      providers: {
        p1: {
          api_base_url: 'http://p1',
          api_key: 'k1',
          enabled: true,
          models: {
            'model-a': { maxConcurrency: 1 },
            'model-b': { maxConcurrency: 1 },
          },
        },
      },
      models: {
        'test-model': {
          selector: 'in_order',
          target_groups: [
            {
              name: 'default',
              selector: 'in_order',
              targets: [
                { provider: 'p1', model: 'model-a', enabled: true },
                { provider: 'p1', model: 'model-b', enabled: true },
              ],
            },
          ],
        },
      },
      keys: {},
      quotas: [],
    } as any);

    // Fill model-a to its limit but leave model-b open
    const tracker = ConcurrencyTracker.getInstance();
    tracker.acquire('p1', 'model-a');

    const result = await Router.resolveCandidates('test-model', 'chat');
    // model-a should be filtered out, model-b should remain
    expect(result.length).toBe(1);
    expect(result[0]!.model).toBe('model-b');
  });
});
