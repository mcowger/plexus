import { describe, expect, test } from 'vitest';
import { wireStallDetection, resolveStallConfig } from '../stall';
import type { StallConfig } from '../../services/inspectors/stall-inspector';

describe('wireStallDetection', () => {
  test('addStallConfig with empty overrides reverts to global config', () => {
    // Simulates failover: Provider A has overrides, Provider B has none.
    // After calling addStallConfig({}) for B, the inspector must use
    // the global config — not retain A's overrides.
    const abortController = new AbortController();
    const globalConfig: StallConfig = {
      ttfbMs: 30000,
      ttfbBytes: 200,
      minBytesPerSecond: 2000,
      windowMs: 30000,
      gracePeriodMs: 45000,
    };

    const result = wireStallDetection(abortController, globalConfig);

    // Provider A: relaxed overrides
    result!.addStallConfig({
      stallTtfbMs: 60000,
      stallMinBps: 100,
    });

    const afterA = result!.stallInspector.getConfig();
    expect(afterA.ttfbMs).toBe(60000);
    expect(afterA.minBytesPerSecond).toBe(100);

    // Provider B: no overrides — should revert to global
    result!.addStallConfig({});

    const afterB = result!.stallInspector.getConfig();
    // After the fix, the inspector reverts to global config instead of
    // retaining the previous provider's overrides.
    expect(afterB.ttfbMs).toBe(30000);
    expect(afterB.minBytesPerSecond).toBe(2000);
  });

  test('addStallConfig with empty overrides resets inspector when no global config', () => {
    // No global config. Provider A has overrides, Provider B has none.
    // addStallConfig({}) for B must reset the inspector, not retain A's config.
    // On main this leaks: resolveStallConfig(null, {}) returns null, and
    // addStallConfig skips updateConfig when merged is null.
    const abortController = new AbortController();
    const result = wireStallDetection(abortController, null);

    // Provider A: has overrides
    result!.addStallConfig({
      stallTtfbMs: 60000,
      stallMinBps: 100,
    });

    const afterA = result!.stallInspector.getConfig();
    expect(afterA.ttfbMs).toBe(60000);
    expect(afterA.minBytesPerSecond).toBe(100);

    // Provider B: no overrides — should reset to disabled skeleton
    result!.addStallConfig({});

    const afterB = result!.stallInspector.getConfig();
    expect(afterB.ttfbMs).toBeNull();
    expect(afterB.minBytesPerSecond).toBeNull();
  });

  test('addStallConfig does not throw with empty overrides and no global config', () => {
    const abortController = new AbortController();
    const result = wireStallDetection(abortController, null);
    expect(result).not.toBeNull();

    expect(() => {
      result!.addStallConfig({});
    }).not.toThrow();
  });

  test('addStallConfig applies per-provider overrides on top of global config', () => {
    const abortController = new AbortController();
    const globalConfig: StallConfig = {
      ttfbMs: 30000,
      ttfbBytes: 200,
      minBytesPerSecond: 2000,
      windowMs: 30000,
      gracePeriodMs: 45000,
    };

    const result = wireStallDetection(abortController, globalConfig);

    result!.addStallConfig({
      stallTtfbMs: 10000,
      stallMinBps: 100,
    });

    const config = result!.stallInspector.getConfig();
    expect(config.ttfbMs).toBe(10000);
    expect(config.minBytesPerSecond).toBe(100);
    expect(config.ttfbBytes).toBe(200); // From global
    expect(config.windowMs).toBe(30000); // From global
  });
});

describe('resolveStallConfig', () => {
  test('returns null when no global config and no overrides', () => {
    const result = resolveStallConfig(null, undefined);
    expect(result).toBeNull();
  });

  test('returns global config when no overrides', () => {
    const global: StallConfig = {
      ttfbMs: 5000,
      ttfbBytes: 100,
      minBytesPerSecond: 2000,
      windowMs: 10000,
      gracePeriodMs: 30000,
    };
    const result = resolveStallConfig(global, {});
    expect(result).toEqual(global);
  });

  test('merges provider overrides with global config', () => {
    const global: StallConfig = {
      ttfbMs: 30000,
      ttfbBytes: 200,
      minBytesPerSecond: 2000,
      windowMs: 30000,
      gracePeriodMs: 45000,
    };
    const result = resolveStallConfig(global, {
      stallTtfbMs: 10000,
      stallMinBps: 100,
    });
    expect(result).not.toBeNull();
    expect(result!.ttfbMs).toBe(10000);
    expect(result!.minBytesPerSecond).toBe(100);
    expect(result!.ttfbBytes).toBe(200); // From global
    expect(result!.windowMs).toBe(30000); // From global
  });
  test('returns null when no global config and empty overrides', () => {
    const result = resolveStallConfig(null, {});
    expect(result).toBeNull();
  });

  test('returns provider-only config when no global config but overrides exist', () => {
    const result = resolveStallConfig(null, {
      stallTtfbMs: 5000,
    });
    expect(result).not.toBeNull();
    expect(result!.ttfbMs).toBe(5000);
    expect(result!.minBytesPerSecond).toBeNull();
  });
});
