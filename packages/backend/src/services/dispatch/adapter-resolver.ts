import type { ProviderAdapter, ResolvedAdapter } from '../../types/provider-adapter';
import type { RouteResult } from '../routing/router';
import type { AdapterEntry } from '../../config';
import { ADAPTER_REGISTRY } from '../../transformers/adapters/index';
import { stripUnsupportedToolSearchAdapter } from '../../transformers/adapters/strip-unsupported-tool-search.adapter';
import { suppressUnsupportedGpt5OptionsAdapter } from '../../transformers/adapters/suppress-unsupported-gpt5-options.adapter';
import { logger } from '../../utils/logger';

/**
 * Resolves the ordered list of ProviderAdapters for a given route.
 *
 * Resolution order:
 *   1. Implicit adapters automatically injected for the route's target
 *      provider (currently: tool-search stripping for `pi_ai_provider ===
 *      'openrouter'`). These run first so user-configured adapters see the
 *      cleaned-up payload if they inspect it.
 *   2. Provider-level `adapter` (applies to all models under the provider)
 *   3. Model-level `adapter`   (appended after provider-level adapters)
 *
 * An `{ name, enabled: false }` entry removes earlier instances of that adapter,
 * including implicit defaults. A later enabled entry restores it.
 *
 * Each entry is an { name, options } object. Unknown adapter names are logged
 * as warnings and skipped (rather than throwing) so that a misconfigured
 * adapter doesn't take down the whole route.
 *
 * Returns an empty array when no adapters are configured — zero-cost path.
 */
export function resolveAdapters(route: RouteResult): ResolvedAdapter[] {
  const entries: AdapterEntry[] = [
    ...resolveImplicitAdapters(route),
    ...(route.config.adapter ?? []),
    ...(route.modelConfig?.adapter ?? []),
  ];

  if (entries.length === 0) return [];

  let resolved: ResolvedAdapter[] = [];
  for (const entry of entries) {
    if (entry.enabled === false) {
      resolved = resolved.filter((resolvedEntry) => resolvedEntry.adapter.name !== entry.name);
      continue;
    }
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

/**
 * Adapters automatically injected for a route based on its target pi-ai
 * provider, independent of user-configured adapters.
 *
 * Today this fires for `pi_ai_provider === 'openrouter'`, because OpenRouter's
 * Anthropic-compat /v1/messages endpoint only accepts a small subset of
 * Anthropic server-tool shorthands and rejects the rest with HTTP 400
 * "Unknown server-tool shorthand". We strip the unsupported ones (currently
 * `tool_search_tool_*`) so that messages<>messages pass-through and the
 * transformer-driven dispatch both end up with a body OpenRouter will accept.
 *
 * Implicit adapters go through the same registry path as user-configured
 * adapters, so an unresolved name here would fail loudly rather than
 * silently no-op.
 */
function resolveImplicitAdapters(route: RouteResult): AdapterEntry[] {
  const adapters: AdapterEntry[] = [];
  if (isGpt5Model(route.model)) {
    adapters.push({ name: suppressUnsupportedGpt5OptionsAdapter.name, options: {}, enabled: true });
  }
  if (route.config.pi_ai_provider === 'openrouter') {
    adapters.push({ name: stripUnsupportedToolSearchAdapter.name, options: {}, enabled: true });
  }
  return adapters;
}

function isGpt5Model(model: string): boolean {
  return /^gpt-5(?:[.-]|$)/i.test(model);
}
