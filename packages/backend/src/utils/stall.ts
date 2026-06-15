/**
 * Stall detection wiring utility.
 *
 * Analogous to `wireUpstreamTimeout()` — creates a `StallInspector` stream
 * and wires it into the route's `AbortController` so that when a stall is
 * detected, the request is aborted with a DOMException('TimeoutError').
 *
 * This triggers `onDisconnect('stall')` in `response-handler.ts`, which sets
 * `usageRecord.responseStatus = 'stall'`.
 */

import { getConfig } from '../config';
import { logger } from './logger';
import { StallInspector, type StallConfig } from '../services/inspectors/stall-inspector';

const DEFAULT_STALL_CONFIG: StallConfig = {
  ttfbMs: null,
  ttfbBytes: 100,
  minBytesPerSecond: null,
  windowMs: 10000,
  gracePeriodMs: 30000,
};

/**
 * Resolve the effective stall configuration by merging global settings
 * with per-provider overrides.
 */
export function resolveStallConfig(
  globalConfig: StallConfig | null,
  providerOverrides?: {
    stallTtfbMs?: number | null;
    stallTtfbBytes?: number | null;
    stallMinBps?: number | null;
    stallWindowMs?: number | null;
    stallGracePeriodMs?: number | null;
  }
): StallConfig | null {
  // Base defaults used when there is no global config
  const defaults: StallConfig = DEFAULT_STALL_CONFIG;

  const base = globalConfig ?? defaults;

  // If no per-provider overrides, check if base has any active dimension
  if (!providerOverrides || Object.keys(providerOverrides).length === 0) {
    if (!globalConfig) return null; // No global config and no overrides = disabled
    return globalConfig;
  }

  // Merge: per-provider overrides take precedence when defined (not undefined)
  // For nullable fields (ttfbMs, minBytesPerSecond), null means "disabled".
  // For non-nullable fields (ttfbBytes, windowMs, gracePeriodMs), null means "use base".
  const merged: StallConfig = {
    ttfbMs:
      providerOverrides.stallTtfbMs !== undefined ? providerOverrides.stallTtfbMs : base.ttfbMs,
    ttfbBytes:
      providerOverrides.stallTtfbBytes != null ? providerOverrides.stallTtfbBytes : base.ttfbBytes,
    minBytesPerSecond:
      providerOverrides.stallMinBps !== undefined
        ? providerOverrides.stallMinBps
        : base.minBytesPerSecond,
    windowMs:
      providerOverrides.stallWindowMs != null ? providerOverrides.stallWindowMs : base.windowMs,
    gracePeriodMs:
      providerOverrides.stallGracePeriodMs != null
        ? providerOverrides.stallGracePeriodMs
        : base.gracePeriodMs,
  };

  // If both TTFB and throughput monitoring are null, stall detection is off
  if (merged.ttfbMs == null && merged.minBytesPerSecond == null) {
    return null;
  }

  return merged;
}

/**
 * Build the global stall configuration from the PlexusConfig cache.
 * Returns null if stall detection is globally disabled (all settings null).
 */
export function getGlobalStallConfig(): StallConfig | null {
  const config = getConfig();
  const stall = (config as any).stall;

  if (!stall) return null;

  const ttfbMs = stall.ttfbSeconds != null ? stall.ttfbSeconds * 1000 : null;
  const ttfbBytes = stall.ttfbBytes ?? 100;
  const minBytesPerSecond = stall.minBytesPerSecond ?? null;
  const windowMs = (stall.windowSeconds ?? 10) * 1000;
  const gracePeriodMs = (stall.gracePeriodSeconds ?? 30) * 1000;

  // If both TTFB and throughput monitoring are disabled, stall detection is off
  if (ttfbMs == null && minBytesPerSecond == null) {
    return null;
  }

  return {
    ttfbMs,
    ttfbBytes,
    minBytesPerSecond,
    windowMs,
    gracePeriodMs,
  };
}

/**
 * Wire stall detection into the route's AbortController.
 *
 * Creates a `StallInspector` PassThrough stream that monitors the upstream
 * response for stalls. When a stall is detected, it aborts the route's
 * `AbortController`, which triggers `onDisconnect()` in `response-handler.ts`.
 *
 * @param abortController The route's AbortController (same one passed to
 *   `handleResponse` for stream disconnect detection and `wireUpstreamTimeout`).
 * @param globalStallConfig The resolved global stall config (or null if disabled).
 * @returns An object with the `stallInspector` stream and an `addStallConfig`
 *   callback. Always returns a non-null result — without a global config the
 *   inspector starts with a disabled skeleton that per-provider overrides can
 *   activate later.
 */
export function wireStallDetection(
  abortController: AbortController,
  globalStallConfig: StallConfig | null
): {
  stallInspector: StallInspector;
  addStallConfig: (providerOverrides: {
    stallTtfbMs?: number | null;
    stallTtfbBytes?: number | null;
    stallMinBps?: number | null;
    stallWindowMs?: number | null;
    stallGracePeriodMs?: number | null;
  }) => void;
} {
  // When global stall config is null, we still create a StallInspector
  // with a "disabled" skeleton config so that per-provider overrides can
  // activate it later via addStallConfig(). This handles the case where
  // the user only configures stall detection on individual providers
  // without any global settings.
  //
  // If there truly is no stall config at any level, the inspector will
  // simply pass all data through without monitoring (both ttfbMs and
  // minBytesPerSecond are null = no timers, no checks). The periodic
  // check never starts because we never enter MONITORING state.
  const baseConfig: StallConfig = globalStallConfig ?? DEFAULT_STALL_CONFIG;

  const stallInspector = new StallInspector(
    crypto.randomUUID(), // Will be overwritten by the request ID in the pipeline
    baseConfig,
    abortController
  );

  const hadGlobalConfig = globalStallConfig !== null;

  logger.debug(
    `wireStallDetection: creating inspector (hadGlobalConfig=${hadGlobalConfig}, ` +
      `baseConfig=${JSON.stringify(baseConfig)}, globalStallConfig=${JSON.stringify(globalStallConfig)})`
  );

  return {
    stallInspector,
    addStallConfig: (providerOverrides) => {
      const merged = resolveStallConfig(
        // If we started from a skeleton config, resolve against it
        hadGlobalConfig ? globalStallConfig! : null,
        providerOverrides
      );
      logger.debug(
        `wireStallDetection.addStallConfig: overrides=${JSON.stringify(providerOverrides)}, ` +
          `merged=${JSON.stringify(merged)}`
      );
      // Always update the inspector — even when merged is null, we must reset
      // the StallInspector to a disabled skeleton so that a previous provider's
      // overrides don't leak into the next failover target.
      stallInspector.updateConfig(merged ?? DEFAULT_STALL_CONFIG);
    },
  };
}
