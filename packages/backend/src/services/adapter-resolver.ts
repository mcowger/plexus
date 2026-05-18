import type { ProviderAdapter, ResolvedAdapter } from '../types/provider-adapter';
import type { RouteResult } from './router';
import type { AdapterEntry } from '../config';
import { ADAPTER_REGISTRY } from '../transformers/adapters';
import { logger } from '../utils/logger';

/**
 * Resolves the ordered list of ProviderAdapters for a given route.
 *
 * Resolution order:
 *   1. Provider-level `adapter` (applies to all models under the provider)
 *   2. Model-level `adapter`   (appended after provider-level adapters)
 *
 * Each entry is an { name, options } object. Unknown adapter names are logged
 * as warnings and skipped (rather than throwing) so that a misconfigured
 * adapter doesn't take down the whole route.
 *
 * Returns an empty array when no adapters are configured — zero-cost path.
 */
export function resolveAdapters(route: RouteResult): ResolvedAdapter[] {
  const entries: AdapterEntry[] = [
    ...(route.config.adapter ?? []),
    ...(route.modelConfig?.adapter ?? []),
  ];

  if (entries.length === 0) return [];

  const resolved: ResolvedAdapter[] = [];
  for (const entry of entries) {
    const adapter = ADAPTER_REGISTRY[entry.name];
    if (!adapter) {
      logger.warn(
        `Unknown adapter '${entry.name}' configured for provider '${route.provider}' ` +
          `model '${route.model}' — skipping`
      );
      continue;
    }
    resolved.push({ adapter, options: entry.options });
  }

  return resolved;
}
