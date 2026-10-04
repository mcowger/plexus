import type { PiAiQuirks } from '@plexus/shared';
import { getProviderTypes } from '../../config';
import type { ModelConfig, ProviderConfig } from '../../config';
import { getApiBaseType, normalizeApiAccessList } from '../../utils/api-format';
import { applyQuirkOverlay, resolveInlineQuirks } from '../dispatch/dispatcher-auto-compat';
import {
  inferServiceTierFormat,
  type CanonicalServiceTier,
  type ServiceTierFormat,
  type ServiceTierMap,
} from '../dispatch/service-tier-selection';
import { resolvePiAiModel } from '../pi-ai/registry';

const CANONICAL_TIERS: readonly CanonicalServiceTier[] = [
  'auto',
  'standard',
  'flex',
  'priority',
  'ultrafast',
];

/**
 * Union of native capabilities across enabled targets, not a routing guarantee.
 * Only per-model maps (`pi_ai_quirks.<api>.models[model].serviceTierMap` or the
 * linked catalog model) are advertised; provider-wide maps are ignored.
 * Unknown targets contribute nothing; fallback-only tiers are never advertised.
 */
export function resolveAliasServiceTiers(
  aliasId: string,
  models: Record<string, ModelConfig>,
  providers: Record<string, ProviderConfig>
): CanonicalServiceTier[] | undefined {
  const supported = new Set<CanonicalServiceTier>();
  const visited = new Set<ModelConfig>();
  let known = false;

  function visit(name: string): void {
    const alias =
      models[name] ??
      Object.values(models).find((model) => model.additional_aliases?.includes(name));
    if (!alias || visited.has(alias)) return;
    visited.add(alias);

    for (const target of (alias.target_groups ?? []).flatMap((group) => group.targets)) {
      if (target.enabled === false) continue;
      if (target.alias) {
        visit(target.alias);
        continue;
      }
      if (!target.provider || !target.model) continue;
      const provider = providers[target.provider];
      if (!provider || provider.enabled === false) continue;
      const model =
        provider.models && !Array.isArray(provider.models)
          ? provider.models[target.model]
          : undefined;
      if (provider.auto_compat !== true && model?.auto_compat !== true) continue;
      // Match dispatch: explicit model links are authoritative, and unresolved
      // links fall back to inline quirks rather than another catalog identity.
      const base = provider.pi_ai_provider
        ? resolvePiAiModel(provider.pi_ai_provider, model?.pi_ai_model_id ?? target.model)
        : null;
      const apiTypes = model?.access_via?.length
        ? normalizeApiAccessList(model.access_via)
        : getProviderTypes(provider);
      for (const apiType of apiTypes) {
        const capability = base
          ? applyQuirkOverlay(base, provider.pi_ai_quirks, apiType, target.model)
          : resolveInlineQuirks(provider.pi_ai_quirks, apiType, target.model);
        // Only a per-model declaration counts. A provider/API-wide map is a
        // dispatch default (e.g. gateways like OpenRouter), not an assertion
        // that every model behind the provider supports those tiers.
        const common = provider.pi_ai_quirks?.[getApiBaseType(apiType) as keyof PiAiQuirks];
        const map: ServiceTierMap | undefined =
          common?.models?.[target.model]?.serviceTierMap ??
          (base as { serviceTierMap?: ServiceTierMap } | null)?.serviceTierMap;
        if (!map || !capability) continue;
        const format: ServiceTierFormat | undefined =
          capability.compat?.serviceTierFormat ?? inferServiceTierFormat(capability.api);
        if (!format || (format === 'anthropic-speed' && capability.api !== 'anthropic-messages')) {
          continue;
        }
        known = true;
        for (const tier of CANONICAL_TIERS) {
          const native = map[tier];
          if (typeof native !== 'string' || native.length === 0) continue;
          // These are the only native speed values the dispatcher can emit.
          if (format === 'anthropic-speed' && native !== 'fast' && native !== 'standard') continue;
          supported.add(tier);
        }
      }
    }
  }

  visit(aliasId);
  return known ? CANONICAL_TIERS.filter((tier) => supported.has(tier)) : undefined;
}
