import { describe, expect, test, beforeEach } from 'vitest';
import { ConcurrencyTracker } from '../concurrency-tracker';
import { setConfigForTesting } from '../../config';

describe('ConcurrencyTracker', () => {
  beforeEach(() => {
    ConcurrencyTracker.resetForTesting();
  });

  test('acquire increments provider and target counts', () => {
    setConfigForTesting({
      providers: {
        p1: { api_base_url: 'http://p1', api_key: 'k', maxConcurrency: 2, models: { m1: {} } },
      },
      models: {},
      keys: {},
      quotas: [],
    } as any);

    const tracker = ConcurrencyTracker.getInstance();
    expect(tracker.acquire('p1', 'm1')).toBe(true);
    expect(tracker.getProviderCount('p1')).toBe(1);
    expect(tracker.getTargetCount('p1', 'm1')).toBe(1);
  });

  test('acquire respects provider-wide limit', () => {
    setConfigForTesting({
      providers: {
        p1: { api_base_url: 'http://p1', api_key: 'k', maxConcurrency: 1, models: { m1: {} } },
      },
      models: {},
      keys: {},
      quotas: [],
    } as any);

    const tracker = ConcurrencyTracker.getInstance();
    expect(tracker.acquire('p1', 'm1')).toBe(true);
    expect(tracker.acquire('p1', 'm1')).toBe(false);
  });

  test('acquire respects model-specific limit', () => {
    setConfigForTesting({
      providers: {
        p1: {
          api_base_url: 'http://p1',
          api_key: 'k',
          models: { m1: { maxConcurrency: 1 } },
        },
      },
      models: {},
      keys: {},
      quotas: [],
    } as any);

    const tracker = ConcurrencyTracker.getInstance();
    expect(tracker.acquire('p1', 'm1')).toBe(true);
    expect(tracker.acquire('p1', 'm1')).toBe(false);
  });

  test('release decrements counts', () => {
    setConfigForTesting({
      providers: {
        p1: { api_base_url: 'http://p1', api_key: 'k', maxConcurrency: 2, models: { m1: {} } },
      },
      models: {},
      keys: {},
      quotas: [],
    } as any);

    const tracker = ConcurrencyTracker.getInstance();
    tracker.acquire('p1', 'm1');
    tracker.release('p1', 'm1');
    expect(tracker.getProviderCount('p1')).toBe(0);
    expect(tracker.getTargetCount('p1', 'm1')).toBe(0);
  });

  test('release never goes below zero', () => {
    setConfigForTesting({
      providers: {
        p1: { api_base_url: 'http://p1', api_key: 'k', models: { m1: {} } },
      },
      models: {},
      keys: {},
      quotas: [],
    } as any);

    const tracker = ConcurrencyTracker.getInstance();
    tracker.release('p1', 'm1');
    expect(tracker.getProviderCount('p1')).toBe(0);
    expect(tracker.getTargetCount('p1', 'm1')).toBe(0);
  });

  test('acquire succeeds when no limits are configured', () => {
    setConfigForTesting({
      providers: {
        p1: { api_base_url: 'http://p1', api_key: 'k', models: { m1: {} } },
      },
      models: {},
      keys: {},
      quotas: [],
    } as any);

    const tracker = ConcurrencyTracker.getInstance();
    expect(tracker.acquire('p1', 'm1')).toBe(true);
    expect(tracker.acquire('p1', 'm1')).toBe(true);
    expect(tracker.getProviderCount('p1')).toBe(2);
  });

  test('getSnapshot returns current state', () => {
    setConfigForTesting({
      providers: {
        p1: { api_base_url: 'http://p1', api_key: 'k', models: { m1: {}, m2: {} } },
      },
      models: {},
      keys: {},
      quotas: [],
    } as any);

    const tracker = ConcurrencyTracker.getInstance();
    tracker.acquire('p1', 'm1');
    tracker.acquire('p1', 'm2');
    const snapshot = tracker.getSnapshot();
    expect(snapshot.providers).toEqual({ p1: 2 });
    expect(snapshot.targets).toEqual({ 'p1/m1': 1, 'p1/m2': 1 });
  });
});
