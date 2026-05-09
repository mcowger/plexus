import { logger } from '../utils/logger';
import {
  getConfig,
  ModelTarget,
  ProviderConfig,
  ModelProviderConfig,
  getProviderTypes,
  type ModelConfig,
  type ModelTargetGroup,
} from '../config';
import { CooldownManager } from './cooldown-manager';
import { SelectorFactory } from './selectors/factory';
import { EnrichedModelTarget } from './selectors/base';
import type { ModelArchitecture } from '@plexus/shared';

export interface RouteResult {
  provider: string;
  model: string;
  config: ProviderConfig;
  modelConfig?: ModelProviderConfig;
  modelArchitecture?: ModelArchitecture;
  incomingModelAlias?: string;
  canonicalModel?: string;
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
  const enabledTargets = groupTargets.filter((target) => {
    if (target.enabled === false) return false;
    const providerConfig = config.providers[target.provider];
    return providerConfig && providerConfig.enabled !== false;
  });

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

  // 3. Embeddings type filter
  if (incomingApiType === 'embeddings') {
    const embeddingsTargets = healthyTargets.filter((target) => {
      const providerConfig = config.providers[target.provider];
      if (!providerConfig) return false;

      if (!Array.isArray(providerConfig.models) && providerConfig.models) {
        const modelConfig = providerConfig.models[target.model];
        if (modelConfig?.type === 'embeddings') return true;
        if (modelConfig?.type === 'chat') return false;
      }

      if (alias.type === 'embeddings') return true;
      return getProviderTypes(providerConfig).includes('embeddings');
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

  // 4. API match filter
  if (alias.priority === 'api_match' && incomingApiType) {
    const normalizedIncoming = incomingApiType.toLowerCase();
    const compatibleTargets = healthyTargets.filter((target) => {
      const providerConfig = config.providers[target.provider];
      if (!providerConfig) return false;

      const providerTypes = getProviderTypes(providerConfig);
      let modelSpecificTypes: string[] | undefined;
      if (!Array.isArray(providerConfig.models) && providerConfig.models) {
        modelSpecificTypes = providerConfig.models[target.model]?.access_via;
      }
      const availableTypes = modelSpecificTypes || providerTypes;
      return availableTypes.some((t) => t.toLowerCase() === normalizedIncoming);
    });

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

export class Router {
  static async resolveCandidates(
    modelName: string,
    incomingApiType?: string
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
          const enriched = await filterGroupTargets(
            group.targets,
            config,
            alias,
            incomingApiType,
            modelName
          );

          if (enriched.length === 0) return [];

          const ordered = await selectOrderedTargets(group.selector, enriched);

          const results: RouteResult[] = [];
          for (const target of ordered) {
            const providerConfig = config.providers[target.provider];
            if (!providerConfig) continue;

            let modelConfig = undefined;
            if (!Array.isArray(providerConfig.models) && providerConfig.models) {
              modelConfig = providerConfig.models[target.model];
            }

            results.push({
              provider: target.provider,
              model: target.model,
              config: providerConfig,
              modelConfig,
              modelArchitecture: config.models?.[canonicalModel]?.model_architecture,
              incomingModelAlias: modelName,
              canonicalModel,
            });
          }
          return results;
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

    const orderedCandidates: RouteResult[] = [];

    for (const group of alias.target_groups) {
      const enriched = await filterGroupTargets(
        group.targets,
        config,
        alias,
        incomingApiType,
        modelName
      );

      if (enriched.length === 0) continue;

      const ordered = await selectOrderedTargets(group.selector, enriched);

      for (const target of ordered) {
        const providerConfig = config.providers[target.provider];
        if (!providerConfig) continue;

        let modelConfig = undefined;
        if (!Array.isArray(providerConfig.models) && providerConfig.models) {
          modelConfig = providerConfig.models[target.model];
        }

        orderedCandidates.push({
          provider: target.provider,
          model: target.model,
          config: providerConfig,
          modelConfig,
          modelArchitecture: config.models?.[modelName]?.model_architecture,
          incomingModelAlias: modelName,
          canonicalModel,
        });
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
            const enriched = await filterGroupTargets(
              group.targets,
              config,
              alias,
              incomingApiType,
              modelName
            );

            if (enriched.length === 0) {
              throw new Error(
                `No healthy targets in group '${groupName}' for alias '${aliasName}'`
              );
            }

            const selector = SelectorFactory.getSelector(group.selector);
            const target = await selector.select(enriched);

            if (!target) {
              throw new Error(
                `No target selected in group '${groupName}' for alias '${aliasName}'`
              );
            }

            const providerConfig = config.providers[target.provider];
            if (!providerConfig) {
              throw new Error(`Provider '${target.provider}' not found`);
            }

            let modelConfig = undefined;
            if (!Array.isArray(providerConfig.models) && providerConfig.models) {
              modelConfig = providerConfig.models[target.model];
            }

            logger.info(
              `Router: Direct group routing to '${target.provider}/${target.model}' from group '${groupName}' of alias '${aliasName}'`
            );

            return {
              provider: target.provider,
              model: target.model,
              config: providerConfig,
              modelConfig,
              incomingModelAlias: modelName,
              canonicalModel,
            };
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
      for (const group of alias.target_groups) {
        const enriched = await filterGroupTargets(group.targets, config, alias, incomingApiType);

        if (enriched.length === 0) continue;

        const selector = SelectorFactory.getSelector(group.selector);
        const target = await selector.select(enriched);

        if (!target) continue;

        const providerConfig = config.providers[target.provider];
        if (!providerConfig) {
          throw new Error(
            `Provider '${target.provider}' configured for alias '${modelName}' not found`
          );
        }

        logger.info(
          `Router: Selected '${target.provider}/${target.model}' using strategy '${group.selector}'.`
        );
        logger.info(
          `Router resolving ${modelName} (canonical: ${canonicalModel}). Target provider: ${target.provider}, Target model: ${target.model}`
        );

        let modelConfig = undefined;
        if (!Array.isArray(providerConfig.models) && providerConfig.models) {
          modelConfig = providerConfig.models[target.model];
        }

        return {
          provider: target.provider,
          model: target.model,
          config: providerConfig,
          modelConfig,
          incomingModelAlias: modelName,
          canonicalModel,
        };
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

    let modelConfig = undefined;
    if (!Array.isArray(providerConfig.models) && providerConfig.models) {
      modelConfig = providerConfig.models[providerModel];
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
