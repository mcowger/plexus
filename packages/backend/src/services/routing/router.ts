import { logger } from '../../utils/logger';
import {
  getConfig,
  ModelTarget,
  ProviderConfig,
  ModelProviderConfig,
  getProviderTypes,
  type ModelConfig,
  type ModelTargetGroup,
} from '../../config';
import { BackgroundExplorer } from './background-explorer';
import { CooldownManager } from '../runtime/cooldown-manager';
import { ConcurrencyTracker } from '../runtime/concurrency-tracker';
import { SelectorFactory } from './selectors/factory';
import { EnrichedModelTarget } from './selectors/base';
import { StickySessionManager } from './sticky-session-manager';
import {
  getApiBaseType,
  isApiSubtype,
  isDecisionsTargetApiType,
  isImageTargetApiType,
  normalizeApiAccessList,
} from '../../utils/api-format';
import type { AutoTargetProfile } from '@plexus/shared';

/**
 * Group/logical-target provenance for a resolved candidate leaf.
 *
 * The `auto` policy must rank whole logical targets (a concrete target or an
 * alias reference) while ordinary selectors rank individual concrete targets.
 * These fields are optional so ordinary routing and direct routes are
 * unaffected; the auto runtime reads them to reconstruct logical targets and
 * write a ranked order back into the flat candidate list.
 */
export interface RouteAutoProvenance {
  /** Index of the owning group within the alias's `target_groups`. */
  groupIndex: number;
  groupName: string;
  groupSelector: string;
  /** Index of the logical target within `group.targets` declaration order. */
  targetIndex: number;
  /** Stable logical-target id: `<provider>/<model>` or `alias:<name>`. */
  targetKey: string;
  /** Outer administrator qualification for the logical target, when declared. */
  profile?: AutoTargetProfile;
  /** 0-based leaf position within the logical target's resolved order. */
  leafIndex: number;
}

export interface RouteResult {
  provider: string;
  model: string;
  config: ProviderConfig;
  modelConfig?: ModelProviderConfig;
  incomingModelAlias?: string;
  canonicalModel?: string;
  /** Present when resolved through an alias target group. */
  autoProvenance?: RouteAutoProvenance;
}

function tryParseDirectGroup(modelName: string): { aliasName: string; groupName: string } | null {
  if (!modelName.startsWith('direct/')) return null;
  const withoutPrefix = modelName.substring(7);
  const firstSlashIndex = withoutPrefix.indexOf('/');
  if (firstSlashIndex === -1) return null;
  return {
    aliasName: withoutPrefix.substring(0, firstSlashIndex),
    groupName: withoutPrefix.substring(firstSlashIndex + 1),
  };
}

function findAlias(config: ReturnType<typeof getConfig>, modelName: string) {
  let alias = config.models?.[modelName];
  let canonicalModel = modelName;

  if (!alias && config.models) {
    for (const [key, value] of Object.entries(config.models)) {
      if (value.additional_aliases?.includes(modelName)) {
        alias = value;
        canonicalModel = key;
        break;
      }
    }
  }
  return { alias, canonicalModel };
}

async function filterGroupTargets(
  groupTargets: ModelTarget[],
  config: ReturnType<typeof getConfig>,
  alias: ModelConfig,
  incomingApiType?: string,
  logModelName?: string
): Promise<EnrichedModelTarget[]> {
  if (groupTargets.length === 0) return [];

  // 1. Filter out disabled targets and disabled providers
  const enabledTargets = groupTargets.filter(
    (target): target is ModelTarget & { provider: string; model: string } => {
      if (target.enabled === false) return false;
      if (!target.provider || !target.model) return false;
      const providerConfig = config.providers[target.provider];
      return !!providerConfig && providerConfig.enabled !== false;
    }
  );

  if (enabledTargets.length === 0) return [];

  // 2. Cooldown filter
  const cooldownExempt = enabledTargets.filter(
    (t) => config.providers[t.provider]?.disable_cooldown === true
  );
  const cooldownEligible = enabledTargets.filter(
    (t) => config.providers[t.provider]?.disable_cooldown !== true
  );

  const healthyEligible =
    await CooldownManager.getInstance().filterHealthyTargets(cooldownEligible);

  if (logModelName) {
    if (healthyEligible.length < cooldownEligible.length) {
      logger.warn(
        `Router: ${cooldownEligible.length - healthyEligible.length} target(s) for '${logModelName}' were filtered out due to cooldowns.`
      );
    }
    if (cooldownExempt.length > 0) {
      logger.debug(
        `Router: ${cooldownExempt.length} target(s) for '${logModelName}' bypassed cooldown check (disable_cooldown=true).`
      );
    }
  }

  let healthyTargets = [...healthyEligible, ...cooldownExempt];

  if (healthyTargets.length === 0) return [];

  // 2.5 Concurrency filter
  const concurrencyExempt = healthyTargets.filter((t) => {
    const providerConfig = config.providers[t.provider];
    const modelConfig =
      providerConfig && !Array.isArray(providerConfig.models) && providerConfig.models
        ? providerConfig.models[t.model]
        : undefined;
    return providerConfig?.maxConcurrency == null && modelConfig?.maxConcurrency == null;
  });
  const concurrencyEligible = healthyTargets.filter((t) => {
    const providerConfig = config.providers[t.provider];
    const modelConfig =
      providerConfig && !Array.isArray(providerConfig.models) && providerConfig.models
        ? providerConfig.models[t.model]
        : undefined;
    return providerConfig?.maxConcurrency != null || modelConfig?.maxConcurrency != null;
  });

  const concurrencyHealthy = concurrencyEligible.filter((t) => {
    const providerConfig = config.providers[t.provider];
    if (providerConfig?.maxConcurrency != null) {
      const count = ConcurrencyTracker.getInstance().getProviderCount(t.provider);
      logger.debug(
        `Router: concurrency check for ${t.provider}/${t.model}: providerCount=${count}, maxConcurrency=${providerConfig.maxConcurrency}`
      );
      if (count >= providerConfig.maxConcurrency) return false;
    }
    const modelConfig =
      providerConfig && !Array.isArray(providerConfig.models) && providerConfig.models
        ? providerConfig.models[t.model]
        : undefined;
    if (modelConfig?.maxConcurrency != null) {
      const count = ConcurrencyTracker.getInstance().getTargetCount(t.provider, t.model);
      logger.debug(
        `Router: concurrency check for ${t.provider}/${t.model}: targetCount=${count}, maxConcurrency=${modelConfig.maxConcurrency}`
      );
      if (count >= modelConfig.maxConcurrency) return false;
    }
    return true;
  });

  if (logModelName) {
    logger.debug(
      `Router: concurrency filter for '${logModelName}': exempt=[${concurrencyExempt.map((t) => t.provider + '/' + t.model).join(', ')}], eligible=[${concurrencyEligible.map((t) => t.provider + '/' + t.model).join(', ')}], healthy=[${concurrencyHealthy.map((t) => t.provider + '/' + t.model).join(', ')}]`
    );
    if (concurrencyHealthy.length < concurrencyEligible.length) {
      logger.warn(
        `Router: ${concurrencyEligible.length - concurrencyHealthy.length} target(s) for '${logModelName}' were filtered out due to concurrency limits.`
      );
    }
  }

  // Merge back preserving original order — concurrencyExempt and concurrencyHealthy
  // are subsets of the original healthyTargets list, so we iterate the original
  // order and include each target if it appears in either set.
  const concurrencyExemptSet = new Set(concurrencyExempt);
  const concurrencyHealthySet = new Set(concurrencyHealthy);
  healthyTargets = healthyTargets.filter(
    (t) => concurrencyExemptSet.has(t) || concurrencyHealthySet.has(t)
  );

  if (healthyTargets.length === 0) return [];

  // 3. Embeddings type filter
  if (incomingApiType === 'embeddings') {
    const embeddingsTargets = healthyTargets.filter((target) => {
      const providerConfig = config.providers[target.provider];
      if (!providerConfig) return false;

      if (!Array.isArray(providerConfig.models) && providerConfig.models) {
        const modelConfig = providerConfig.models[target.model];
        if (modelConfig?.type === 'embeddings') return true;
        if (modelConfig?.type === 'text') return false;
      }

      if (alias.type === 'embeddings') return true;
      const providerTypes = getProviderTypes(providerConfig);
      return providerTypes.includes('embeddings') || providerTypes.includes('gemini');
    });

    if (embeddingsTargets.length > 0) {
      if (logModelName) {
        logger.info(
          `Router: Filtered to ${embeddingsTargets.length} embeddings-compatible targets (from ${healthyTargets.length} total).`
        );
      }
      healthyTargets = embeddingsTargets;
    } else if (logModelName) {
      logger.warn(
        `Router: No embeddings-compatible targets found for '${logModelName}'. Falling back to all healthy targets.`
      );
    }
  }

  // 3.5. Image capability filter
  if (incomingApiType === 'images') {
    const imageTargets = healthyTargets.filter((target) => {
      const providerConfig = config.providers[target.provider];
      if (!providerConfig) return false;

      const providerTypes = getProviderTypes(providerConfig);
      let modelSpecificTypes: ModelProviderConfig['access_via'];
      let modelType: ModelProviderConfig['type'];
      if (!Array.isArray(providerConfig.models) && providerConfig.models) {
        const modelConfig = providerConfig.models[target.model];
        modelSpecificTypes = modelConfig?.access_via;
        modelType = modelConfig?.type;
        if (modelType === 'text' || modelType === 'embeddings') return false;
      }

      const availableTypes =
        modelSpecificTypes && modelSpecificTypes.length > 0
          ? normalizeApiAccessList(modelSpecificTypes)
          : providerTypes;
      const supportsImageProtocol = availableTypes.some((type) => isImageTargetApiType(type));

      return supportsImageProtocol;
    });

    if (imageTargets.length > 0) {
      if (logModelName) {
        logger.info(
          `Router: Filtered to ${imageTargets.length} image-compatible targets (from ${healthyTargets.length} total).`
        );
      }
    } else if (logModelName) {
      logger.warn(`Router: No image-compatible targets found for '${logModelName}'.`);
    }
    healthyTargets = imageTargets;
  }

  // 3.6. Decisions capability filter.
  //
  // Decisions requests never fall back to incompatible providers: with no
  // decisions-capable target the candidate list stays empty (strict), so the
  // caller fails instead of mistranslating the payload onto a chat model.
  // Conversely, decisions-only targets (and `decisions` aliases) never serve
  // any other incoming API type. Targets with unconstrained `access_via`
  // keep the existing generic cross-format fallback in both directions.
  if (incomingApiType === 'decisions') {
    const decisionsTargets = healthyTargets.filter((target) => {
      const providerConfig = config.providers[target.provider];
      if (!providerConfig) return false;

      let modelSpecificTypes: ModelProviderConfig['access_via'];
      if (!Array.isArray(providerConfig.models) && providerConfig.models) {
        modelSpecificTypes = providerConfig.models[target.model]?.access_via;
      }
      const availableTypes =
        modelSpecificTypes && modelSpecificTypes.length > 0
          ? normalizeApiAccessList(modelSpecificTypes)
          : getProviderTypes(providerConfig);
      if (availableTypes.some((type) => isDecisionsTargetApiType(type))) return true;
      // A `decisions` alias with unconstrained targets may serve decisions.
      if ((!modelSpecificTypes || modelSpecificTypes.length === 0) && alias.type === 'decisions') {
        return true;
      }
      return false;
    });

    if (decisionsTargets.length > 0) {
      if (logModelName) {
        logger.info(
          `Router: Filtered to ${decisionsTargets.length} decisions-compatible targets (from ${healthyTargets.length} total).`
        );
      }
    } else if (logModelName) {
      logger.warn(`Router: No decisions-compatible targets found for '${logModelName}'.`);
    }
    healthyTargets = decisionsTargets;
  } else {
    const nonDecisionsTargets = healthyTargets.filter((target) => {
      if (alias.type === 'decisions') return false;
      const providerConfig = config.providers[target.provider];
      if (!providerConfig) return false;

      let modelSpecificTypes: ModelProviderConfig['access_via'];
      if (!Array.isArray(providerConfig.models) && providerConfig.models) {
        modelSpecificTypes = providerConfig.models[target.model]?.access_via;
      }
      const advertised =
        modelSpecificTypes && modelSpecificTypes.length > 0
          ? normalizeApiAccessList(modelSpecificTypes)
          : [];
      // Only constrained decisions-only targets are excluded; unconstrained
      // targets keep the generic cross-format fallback.
      if (advertised.length > 0 && advertised.every((type) => isDecisionsTargetApiType(type))) {
        return false;
      }
      return true;
    });

    healthyTargets = nonDecisionsTargets;
  }

  const findApiCompatibleTargets = (
    targets: (ModelTarget & { provider: string; model: string })[],
    requestedApiType: string
  ): (ModelTarget & { provider: string; model: string })[] => {
    const normalizedIncoming = requestedApiType.toLowerCase();
    return targets.filter((target) => {
      const providerConfig = config.providers[target.provider];
      if (!providerConfig) return false;

      const providerTypes = getProviderTypes(providerConfig);
      let modelSpecificTypes: ModelProviderConfig['access_via'];
      let modelType: ModelProviderConfig['type'];
      if (!Array.isArray(providerConfig.models) && providerConfig.models) {
        const modelConfig = providerConfig.models[target.model];
        modelSpecificTypes = modelConfig?.access_via;
        modelType = modelConfig?.type;
      }
      if (normalizedIncoming === 'images' && (modelType === 'text' || modelType === 'embeddings')) {
        return false;
      }
      const availableTypes =
        modelSpecificTypes && modelSpecificTypes.length > 0
          ? normalizeApiAccessList(modelSpecificTypes)
          : providerTypes;
      if (normalizedIncoming === 'decisions') {
        return availableTypes.some((t) => isDecisionsTargetApiType(t));
      }
      // Decisions-only targets never satisfy other API types, even under
      // `api_match` priority where cross-format fallback otherwise applies.
      if (availableTypes.length > 0 && availableTypes.every((t) => isDecisionsTargetApiType(t))) {
        return false;
      }
      return availableTypes.some(
        (t) =>
          t.toLowerCase() === normalizedIncoming ||
          (normalizedIncoming === 'images' && isImageTargetApiType(t))
      );
    });
  };

  // 4. API match filter
  //
  // Subtype requests (e.g. "responses:lite") prefer targets that advertise
  // the exact subtype, then targets advertising the base API type (e.g.
  // "responses") — Plexus fully translates the subtype's wire extensions
  // (Codex CLI's namespace/custom tools, `additional_tools` input items)
  // via the transform pipeline, so neither is strictly required. If no
  // target advertises either, fall back to all healthy targets rather than
  // excluding the alias entirely; the dispatcher's own per-target API type
  // selection (and full transform pipeline) still handles cross-format
  // translation from there (e.g. to a chat-completions-only target).
  if (incomingApiType && isApiSubtype(incomingApiType)) {
    const exactTargets = findApiCompatibleTargets(healthyTargets, incomingApiType);
    const baseTargets =
      exactTargets.length > 0
        ? []
        : findApiCompatibleTargets(healthyTargets, getApiBaseType(incomingApiType));
    const compatibleTargets =
      exactTargets.length > 0 ? exactTargets : baseTargets.length > 0 ? baseTargets : null;

    if (compatibleTargets) {
      if (logModelName) {
        logger.info(
          `Router: Incoming API subtype '${incomingApiType}' narrowed ${healthyTargets.length} healthy targets to ${compatibleTargets.length} compatible targets` +
            (exactTargets.length === 0
              ? ` (fell back to base type '${getApiBaseType(incomingApiType)}')`
              : '') +
            '.'
        );
      }
      healthyTargets = compatibleTargets;
    } else if (logModelName) {
      logger.info(
        `Router: Incoming API subtype '${incomingApiType}' has no directly compatible targets. Falling back to all healthy targets for cross-format translation.`
      );
    }
  } else if (alias.priority === 'api_match' && incomingApiType) {
    const compatibleTargets = findApiCompatibleTargets(healthyTargets, incomingApiType);

    if (compatibleTargets.length > 0) {
      if (logModelName) {
        logger.info(
          `Router: 'api_match' priority active. Narrowed ${healthyTargets.length} healthy targets to ${compatibleTargets.length} API-compatible targets.`
        );
      }
      healthyTargets = compatibleTargets;
    } else if (logModelName) {
      logger.info(
        `Router: 'api_match' priority active, but no targets support '${incomingApiType}'. Falling back to all healthy targets.`
      );
    }
  }

  // 5. Enrich with modelConfig
  return healthyTargets.map((target) => {
    const providerConfig = config.providers[target.provider];
    let modelConfig = undefined;
    if (providerConfig && !Array.isArray(providerConfig.models) && providerConfig.models) {
      modelConfig = providerConfig.models[target.model];
    }
    return { ...target, route: { modelConfig } };
  });
}

async function selectOrderedTargets(
  selectorType: string,
  enrichedTargets: EnrichedModelTarget[]
): Promise<ModelTarget[]> {
  const selector = SelectorFactory.getSelector(selectorType);
  const ordered: ModelTarget[] = [];
  const remaining: EnrichedModelTarget[] = [...enrichedTargets];

  while (remaining.length > 0) {
    const selected = await selector.select(remaining);
    if (!selected) break;
    ordered.push(selected);

    const idx = remaining.findIndex(
      (t) => t.provider === selected.provider && t.model === selected.model
    );
    if (idx >= 0) {
      remaining.splice(idx, 1);
    } else {
      remaining.shift();
    }
  }

  for (const target of remaining) {
    ordered.push(target);
  }

  return ordered;
}

function withVisited(visited: Set<string>, slug: string): Set<string> {
  const next = new Set(visited);
  next.add(slug);
  return next;
}

function dedupeCandidates(candidates: RouteResult[]): RouteResult[] {
  const seen = new Set<string>();
  const result: RouteResult[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.provider}\u0000${candidate.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function makeAutoProvenance(params: {
  group: ModelTargetGroup;
  groupIndex: number;
  targetIndex: number;
  targetKey: string;
  profile?: AutoTargetProfile;
  leafIndex: number;
}): RouteAutoProvenance {
  return {
    groupIndex: params.groupIndex,
    groupName: params.group.name,
    groupSelector: params.group.selector,
    targetIndex: params.targetIndex,
    targetKey: params.targetKey,
    profile: params.profile,
    leafIndex: params.leafIndex,
  };
}

function buildRouteResult(params: {
  provider: string;
  model: string;
  config: ReturnType<typeof getConfig>;
  incomingModelAlias: string | undefined;
  canonicalModel: string;
  autoProvenance?: RouteAutoProvenance;
}): RouteResult {
  const providerConfig = params.config.providers[params.provider];
  let modelConfig = undefined;
  if (providerConfig && !Array.isArray(providerConfig.models) && providerConfig.models) {
    modelConfig = providerConfig.models[params.model];
  }
  return {
    provider: params.provider,
    model: params.model,
    config: providerConfig!,
    modelConfig,
    incomingModelAlias: params.incomingModelAlias,
    canonicalModel: params.canonicalModel,
    autoProvenance: params.autoProvenance,
  };
}

/**
 * Resolve an `auto` group's candidates without running a selector.
 *
 * Logical targets are emitted in configured declaration order, each alias
 * reference expanded through the child alias's own ordinary policy so its
 * leaf order is preserved. Health/API admission filtering still applies to
 * concrete targets (and again per attempt); access/quota filtering and the
 * final auto ranking run later in `route-candidates.ts`.
 */
async function buildAutoGroupCandidates(
  group: ModelTargetGroup,
  config: ReturnType<typeof getConfig>,
  alias: ModelConfig,
  incomingApiType: string | undefined,
  logModelName: string | undefined,
  canonicalModel: string,
  sessionKey: string | null | undefined,
  visited: Set<string>,
  groupIndex: number
): Promise<RouteResult[]> {
  const concreteTargets = group.targets.filter((t) => !t.alias);
  const enriched = await filterGroupTargets(
    concreteTargets,
    config,
    alias,
    incomingApiType,
    logModelName
  );
  const enrichedByKey = new Map<string, EnrichedModelTarget>();
  for (const target of enriched) {
    enrichedByKey.set(`${target.provider}\u0000${target.model}`, target);
  }

  const results: RouteResult[] = [];
  for (let targetIndex = 0; targetIndex < group.targets.length; targetIndex++) {
    const target = group.targets[targetIndex]!;
    if (target.enabled === false) continue;

    if (target.alias) {
      if (visited.has(target.alias)) {
        logger.warn(
          `Router: alias-ref cycle detected while expanding '${target.alias}'; skipping to avoid infinite recursion.`
        );
        continue;
      }
      const nested = await Router.resolveCandidates(
        target.alias,
        incomingApiType,
        sessionKey,
        visited
      );
      nested.forEach((candidate, leafIndex) => {
        results.push({
          ...candidate,
          canonicalModel,
          incomingModelAlias: logModelName,
          autoProvenance: makeAutoProvenance({
            group,
            groupIndex,
            targetIndex,
            targetKey: `alias:${target.alias}`,
            profile: target.auto_profile,
            leafIndex,
          }),
        });
      });
      continue;
    }

    if (!target.provider || !target.model) continue;
    const enrichedTarget = enrichedByKey.get(`${target.provider}\u0000${target.model}`);
    if (!enrichedTarget) continue;
    results.push(
      buildRouteResult({
        provider: target.provider,
        model: target.model,
        config,
        incomingModelAlias: logModelName,
        canonicalModel,
        autoProvenance: makeAutoProvenance({
          group,
          groupIndex,
          targetIndex,
          targetKey: `${target.provider}/${target.model}`,
          profile: target.auto_profile,
          leafIndex: 0,
        }),
      })
    );
  }

  return results;
}

async function buildGroupCandidates(
  group: ModelTargetGroup,
  config: ReturnType<typeof getConfig>,
  alias: ModelConfig,
  incomingApiType: string | undefined,
  logModelName: string | undefined,
  canonicalModel: string,
  sessionKey: string | null | undefined,
  visited: Set<string>,
  groupIndex: number
): Promise<RouteResult[]> {
  if (group.selector === 'auto') {
    const autoResults = await buildAutoGroupCandidates(
      group,
      config,
      alias,
      incomingApiType,
      logModelName,
      canonicalModel,
      sessionKey,
      visited,
      groupIndex
    );
    BackgroundExplorer.getInstance()?.maybeTrigger(group, alias.type);
    return autoResults;
  }

  const concreteTargets = group.targets.filter((t) => !t.alias);

  const enriched = await filterGroupTargets(
    concreteTargets,
    config,
    alias,
    incomingApiType,
    logModelName
  );
  const ordered = await selectOrderedTargets(group.selector, enriched);

  const targetIndexByKey = new Map<string, number>();
  group.targets.forEach((target, index) => {
    if (target.provider && target.model) {
      targetIndexByKey.set(`${target.provider}\u0000${target.model}`, index);
    }
  });

  const results: RouteResult[] = ordered.map((target) => {
    const key = `${target.provider}\u0000${target.model}`;
    const targetIndex = targetIndexByKey.get(key) ?? -1;
    return buildRouteResult({
      provider: target.provider!,
      model: target.model!,
      config,
      incomingModelAlias: logModelName,
      canonicalModel,
      autoProvenance: makeAutoProvenance({
        group,
        groupIndex,
        targetIndex,
        targetKey: `${target.provider}/${target.model}`,
        profile: targetIndex >= 0 ? group.targets[targetIndex]?.auto_profile : undefined,
        leafIndex: 0,
      }),
    });
  });

  // Selector order is authoritative for concrete targets. Alias-ref
  // expansions are appended after the selector-ordered concrete candidates,
  // in their declared relative order. This preserves selector behaviour
  // (cost/random/latency/performance/usage) while making alias-refs act
  // as fallback chains.
  const merged: RouteResult[] = [...results];

  for (let targetIndex = 0; targetIndex < group.targets.length; targetIndex++) {
    const target = group.targets[targetIndex]!;
    if (!target.alias) continue;
    if (target.enabled === false) continue;
    if (visited.has(target.alias)) {
      logger.warn(
        `Router: alias-ref cycle detected while expanding '${target.alias}'; skipping to avoid infinite recursion.`
      );
      continue;
    }
    const nested = await Router.resolveCandidates(
      target.alias,
      incomingApiType,
      sessionKey,
      visited
    );
    // Rewrite metadata to the outer alias so downstream logic (extraBody,
    // advanced behaviors, context limits, vision fallthrough, compaction,
    // sticky sessions) treats the request as the outer alias, not the
    // referenced one.
    nested.forEach((candidate, leafIndex) => {
      merged.push({
        ...candidate,
        canonicalModel,
        incomingModelAlias: logModelName,
        autoProvenance: makeAutoProvenance({
          group,
          groupIndex,
          targetIndex,
          targetKey: `alias:${target.alias}`,
          profile: target.auto_profile,
          leafIndex,
        }),
      });
    });
  }

  BackgroundExplorer.getInstance()?.maybeTrigger(group, alias.type);

  return merged;
}

export class Router {
  static async resolveCandidates(
    modelName: string,
    incomingApiType?: string,
    sessionKey?: string | null,
    visited: Set<string> = new Set()
  ): Promise<RouteResult[]> {
    const config = getConfig();

    // Direct target group routing: direct/alias/target_group
    const parsed = tryParseDirectGroup(modelName);
    if (parsed) {
      const { aliasName, groupName } = parsed;
      const { alias, canonicalModel } = findAlias(config, aliasName);

      if (alias?.target_groups) {
        const group = alias.target_groups.find((g) => g.name === groupName);
        if (group) {
          const results = await buildGroupCandidates(
            group,
            config,
            alias,
            incomingApiType,
            modelName,
            canonicalModel,
            sessionKey,
            withVisited(visited, canonicalModel),
            alias.target_groups.indexOf(group)
          );
          // Auto aliases keep duplicate provider/model leaves until the auto
          // runtime ranks logical targets, so a shared leaf reached by two
          // paths retains each path's local profile. Only an active auto
          // policy defers dedupe; off-mode direct groups dedupe as before.
          return group.selector === 'auto' && alias.auto_routing?.mode === 'active'
            ? results
            : dedupeCandidates(results);
        }
        // Alias exists but group doesn't → fall through to resolve() which throws 404
        return [];
      }
      // Not an alias with target groups → fall through to resolveDirect
    }

    const { alias, canonicalModel } = findAlias(config, modelName);

    if (!alias || !alias.target_groups || alias.target_groups.length === 0) {
      return [];
    }

    if (visited.has(canonicalModel)) {
      logger.warn(
        `Router: alias-ref cycle detected while expanding '${canonicalModel}'; skipping to avoid infinite recursion.`
      );
      return [];
    }
    const nextVisited = withVisited(visited, canonicalModel);

    let orderedCandidates: RouteResult[] = [];

    // Sticky session: if enabled and we have a session key, look up the
    // provider:model used last turn. We don't return early — we still build
    // the full candidate list so failover works — but we hoist the sticky
    // pick to position 0 if it's still a healthy candidate.
    //
    // Aliases with an active `auto` policy are excluded: auto owns incumbent
    // preference and cache economics, and an unconditional hoist must not
    // cross the policy's suitability rules (it would also undo the ranked
    // order written by the auto runtime). An alias whose auto policy is off
    // keeps ordinary sticky and dedupe behavior.
    const hasAutoGroup = alias.target_groups.some((g) => g.selector === 'auto');
    const activeAuto = hasAutoGroup && alias.auto_routing?.mode === 'active';
    let stickyPick: { provider: string; model: string } | null = null;
    if (alias.sticky_session && sessionKey && !activeAuto) {
      stickyPick = StickySessionManager.getInstance().get(
        canonicalModel,
        incomingApiType || 'chat',
        sessionKey
      );
    }

    for (let groupIndex = 0; groupIndex < alias.target_groups.length; groupIndex++) {
      const group = alias.target_groups[groupIndex]!;
      const results = await buildGroupCandidates(
        group,
        config,
        alias,
        incomingApiType,
        modelName,
        canonicalModel,
        sessionKey,
        nextVisited,
        groupIndex
      );
      orderedCandidates.push(...results);
    }

    if (!activeAuto) {
      orderedCandidates = dedupeCandidates(orderedCandidates);
    }

    if (stickyPick) {
      const idx = orderedCandidates.findIndex(
        (c) => c.provider === stickyPick!.provider && c.model === stickyPick!.model
      );
      if (idx > 0) {
        const [picked] = orderedCandidates.splice(idx, 1);
        orderedCandidates.unshift(picked!);
        logger.info(
          `Router: sticky_session hoisted '${stickyPick.provider}/${stickyPick.model}' to front for alias '${modelName}'.`
        );
      } else if (idx === -1) {
        logger.debug(
          `Router: sticky_session pick '${stickyPick.provider}/${stickyPick.model}' for alias '${modelName}' is no longer a healthy candidate; using normal selection.`
        );
      }
    }

    return orderedCandidates;
  }

  static async resolve(modelName: string, incomingApiType?: string): Promise<RouteResult> {
    const config = getConfig();

    // Direct routing bypass
    if (modelName.startsWith('direct/')) {
      const parsed = tryParseDirectGroup(modelName);
      if (parsed) {
        const { aliasName, groupName } = parsed;
        const { alias, canonicalModel } = findAlias(config, aliasName);

        if (alias?.target_groups) {
          const group = alias.target_groups.find((g) => g.name === groupName);
          if (group) {
            const candidates = await buildGroupCandidates(
              group,
              config,
              alias,
              incomingApiType,
              modelName,
              canonicalModel,
              null,
              withVisited(new Set(), canonicalModel),
              alias.target_groups.indexOf(group)
            );

            const [target] = dedupeCandidates(candidates);

            if (!target) {
              throw new Error(
                `No healthy targets in group '${groupName}' for alias '${aliasName}'`
              );
            }

            logger.info(
              `Router: Direct group routing to '${target.provider}/${target.model}' from group '${groupName}' of alias '${aliasName}'`
            );

            return target;
          }

          const error = new Error(
            `Direct routing failed: Target group '${groupName}' not found for alias '${aliasName}'`
          ) as any;
          error.routingContext = { statusCode: 404 };
          throw error;
        }

        // alias exists but has no target_groups → not an alias we can group-route.
        // Fall through to resolveDirect (which will likely 404 as an unknown provider/model).
      }

      return Router.resolveDirect(modelName, config);
    }

    const { alias, canonicalModel } = findAlias(config, modelName);

    if (alias && alias.target_groups && alias.target_groups.length > 0) {
      const visited = withVisited(new Set(), canonicalModel);
      for (let groupIndex = 0; groupIndex < alias.target_groups.length; groupIndex++) {
        const group = alias.target_groups[groupIndex]!;
        const candidates = await buildGroupCandidates(
          group,
          config,
          alias,
          incomingApiType,
          modelName,
          canonicalModel,
          null,
          visited,
          groupIndex
        );

        if (candidates.length === 0) continue;

        BackgroundExplorer.getInstance()?.maybeTrigger(group, alias.type);

        const deduped = dedupeCandidates(candidates);
        const target = deduped[0]!;

        logger.info(
          `Router: Selected '${target.provider}/${target.model}' using strategy '${group.selector}'.`
        );
        logger.info(
          `Router resolving ${modelName} (canonical: ${canonicalModel}). Target provider: ${target.provider}, Target model: ${target.model}`
        );

        return target;
      }

      throw new Error(`No healthy target selected for alias '${modelName}'`);
    }

    throw new Error(`Model '${modelName}' not found in configuration`);
  }

  private static resolveDirect(
    modelName: string,
    config: ReturnType<typeof getConfig>
  ): RouteResult {
    const withoutPrefix = modelName.substring(7);
    const firstSlashIndex = withoutPrefix.indexOf('/');

    if (firstSlashIndex === -1) {
      const error = new Error(
        `Direct routing failed: Invalid format '${modelName}'. Expected 'direct/provider/model'`
      ) as any;
      error.routingContext = { statusCode: 400 };
      throw error;
    }

    const providerId = withoutPrefix.substring(0, firstSlashIndex);
    const providerModel = withoutPrefix.substring(firstSlashIndex + 1);

    const providerConfig = config.providers[providerId];
    if (!providerConfig) {
      const error = new Error(
        `Direct routing failed: Provider '${providerId}' not found in configuration`
      ) as any;
      error.routingContext = { statusCode: 404 };
      throw error;
    }

    if (providerConfig.enabled === false) {
      const error = new Error(`Direct routing failed: Provider '${providerId}' is disabled`) as any;
      error.routingContext = { statusCode: 404 };
      throw error;
    }

    if (providerConfig.maxConcurrency != null) {
      const count = ConcurrencyTracker.getInstance().getProviderCount(providerId);
      if (count >= providerConfig.maxConcurrency) {
        const error = new Error(
          `Direct routing failed: Concurrency limit exceeded for provider '${providerId}'`
        ) as any;
        error.routingContext = { statusCode: 429 };
        throw error;
      }
    }

    let modelConfig = undefined;
    if (!Array.isArray(providerConfig.models) && providerConfig.models) {
      modelConfig = providerConfig.models[providerModel];
    }

    if (modelConfig?.maxConcurrency != null) {
      const count = ConcurrencyTracker.getInstance().getTargetCount(providerId, providerModel);
      if (count >= modelConfig.maxConcurrency) {
        const error = new Error(
          `Direct routing failed: Concurrency limit exceeded for model '${providerId}/${providerModel}'`
        ) as any;
        error.routingContext = { statusCode: 429 };
        throw error;
      }
    }

    logger.info(`Router: Direct routing to '${providerId}/${providerModel}' (bypassing selector)`);

    return {
      provider: providerId,
      model: providerModel,
      config: providerConfig,
      modelConfig,
      incomingModelAlias: modelName,
      canonicalModel: modelName,
    };
  }
}
