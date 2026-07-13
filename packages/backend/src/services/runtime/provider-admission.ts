import type { RouteResult } from '../routing/router';
import { CooldownManager } from './cooldown-manager';
import { ConcurrencyTracker } from './concurrency-tracker';

export type ProviderAdmission =
  | { admitted: true; release: () => void }
  | { admitted: false; reason: string };

/**
 * Checks whether a provider can accept a request and reserves its concurrency
 * slot. Call `release` exactly once after an admitted attempt completes.
 */
export async function admitProvider(route: RouteResult): Promise<ProviderAdmission> {
  const healthy = await CooldownManager.getInstance().isProviderHealthy(
    route.provider,
    route.model
  );
  if (!healthy) {
    return {
      admitted: false,
      reason: `Provider ${route.provider}/${route.model} is on cooldown`,
    };
  }

  const acquired = ConcurrencyTracker.getInstance().acquire(route.provider, route.model);
  if (!acquired) {
    return {
      admitted: false,
      reason: `Provider ${route.provider}/${route.model} concurrency limit exceeded`,
    };
  }

  let released = false;
  return {
    admitted: true,
    release: () => {
      if (!released) {
        released = true;
        ConcurrencyTracker.getInstance().release(route.provider, route.model);
      }
    },
  };
}
