import type { ProviderAdapter } from '../types/provider-adapter';
import type { RouteResult } from './router';
import { ADAPTER_REGISTRY } from '../transformers/adapters';
import { logger } from '../utils/logger';

/**
 * Resolves the ordered list of ProviderAdapters for a given route.
 *
 * Resolution order:
 *   1. Provider-level `adapter` (applies to all models under the provider)
 *   2. Model-level `adapter`   (appended after provider-level adapters)
 *
 * Both fields accept either a single string or an array of strings.
 * Unknown adapter names are logged as warnings and skipped (rather than
 * throwing) so that a misconfigured adapter doesn't take down the whole route.
 *
 * Returns an empty array when no adapters are configured — zero-cost path.
 */
export function resolveAdapters(route: RouteResult): ProviderAdapter[] {
  const names: string[] = [
    ...normalizeAdapterField(route.config.adapter),
    ...normalizeAdapterField(route.modelConfig?.adapter),
  ];

  if (names.length === 0) return [];

  const adapters: ProviderAdapter[] = [];
  for (const name of names) {
    const adapter = ADAPTER_REGISTRY[name];
    if (!adapter) {
      logger.warn(
        `Unknown adapter '${name}' configured for provider '${route.provider}' ` +
          `model '${route.model}' — skipping`
      );
      continue;
    }
    adapters.push(adapter);
  }

  return adapters;
}

/**
 * Coerce the adapter config field (string | string[] | undefined) to string[].
 */
function normalizeAdapterField(field: string | string[] | undefined): string[] {
  if (!field) return [];
  return Array.isArray(field) ? field : [field];
}
