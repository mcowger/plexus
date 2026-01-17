import { logger } from 'src/utils/logger';
import { getConfig, ProviderConfig, getProviderTypes } from '../config';
import { CooldownManager } from './cooldown-manager';
import { SelectorFactory } from './selectors/factory';

export interface RouteResult {
    provider: string; // provider key in config
    model: string;    // model slug for that provider
    config: ProviderConfig;      // ProviderConfig
    modelConfig?: any; // The specific model config within that provider
    incomingModelAlias?: string; // The alias requested by the user
    canonicalModel?: string; // The canonical alias key in config
}

export class Router {
    static resolve(modelName: string, incomingApiType?: string): RouteResult {
        const config = getConfig();
        
        // 1. Check aliases
        let alias = config.models?.[modelName];
        let canonicalModel = modelName;
        
        if (!alias) {
             // Check additional aliases
             if (config.models) {
                 for (const [key, value] of Object.entries(config.models)) {
                     if (value.additional_aliases?.includes(modelName)) {
                         alias = value;
                         canonicalModel = key;
                         break;
                     }
                 }
             }
        }

        if (alias) {
            // Load balancing: pick target using selector
            const targets = alias.targets;
            if (targets && targets.length > 0) {
                // Filter out disabled targets and disabled providers
                const enabledTargets = targets.filter(target => {
                    // First check if the target itself is disabled
                    if (target.enabled === false) {
                        return false;
                    }
                    // Then check if the provider is disabled
                    const providerConfig = config.providers[target.provider];
                    return providerConfig && providerConfig.enabled !== false;
                });

                if (enabledTargets.length === 0) {
                    throw new Error(`All targets for model alias '${modelName}' are disabled.`);
                }

                let healthyTargets = CooldownManager.getInstance().filterHealthyTargets(enabledTargets);

                if (healthyTargets.length < enabledTargets.length) {
                    const filteredCount = enabledTargets.length - healthyTargets.length;
                    logger.warn(`Router: ${filteredCount} target(s) for '${modelName}' were filtered out due to cooldowns.`);
                }

                if (healthyTargets.length === 0) {
                    throw new Error(`All providers for model alias '${modelName}' are currently on cooldown.`);
                }

                // If priority is 'api_match', try to narrow down healthy targets to those that support the incoming API type
                if (alias.priority === 'api_match' && incomingApiType) {
                    const normalizedIncoming = incomingApiType.toLowerCase();
                    
                    const compatibleTargets = healthyTargets.filter(target => {
                        const providerConfig = config.providers[target.provider];
                        if (!providerConfig) return false;

                        // Get supported types for the provider (inferred from api_base_url)
                        const providerTypes = getProviderTypes(providerConfig);

                        // Supported types for this specific model
                        let modelSpecificTypes: string[] | undefined = undefined;
                        if (!Array.isArray(providerConfig.models) && providerConfig.models) {
                            modelSpecificTypes = providerConfig.models[target.model]?.access_via;
                        }

                        const availableTypes = modelSpecificTypes || providerTypes;
                        return availableTypes.some(t => t.toLowerCase() === normalizedIncoming);
                    });

                    if (compatibleTargets.length > 0) {
                        logger.info(`Router: 'api_match' priority active. Narrowed ${healthyTargets.length} healthy targets to ${compatibleTargets.length} API-compatible targets.`);
                        healthyTargets = compatibleTargets;
                    } else {
                        logger.info(`Router: 'api_match' priority active, but no targets support '${incomingApiType}'. Falling back to all healthy targets.`);
                    }
                }

                // Enrich targets with modelConfig for selectors that need pricing info
                const enrichedTargets = healthyTargets.map(target => {
                    const providerConfig = config.providers[target.provider];
                    let modelConfig = undefined;
                    if (providerConfig && !Array.isArray(providerConfig.models) && providerConfig.models) {
                        modelConfig = providerConfig.models[target.model];
                    }
                    return { ...target, route: { modelConfig } };
                });

                const selectorStrategy = alias.selector || 'random'; // Default to random
                const selector = SelectorFactory.getSelector(selectorStrategy);
                const target = selector.select(enrichedTargets);
                
                if (!target) {
                    throw new Error(`No target selected for alias '${modelName}'`);
                }
                const providerConfig = config.providers[target.provider];
                
                if (!providerConfig) {
                    throw new Error(`Provider '${target.provider}' configured for alias '${modelName}' not found`);
                }
                
                logger.info(`Router: Selected '${target.provider}/${target.model}' using strategy '${selectorStrategy}'.`);
                
                let modelConfig = undefined;
                if (!Array.isArray(providerConfig.models) && providerConfig.models) {
                    modelConfig = providerConfig.models[target.model];
                }

                logger.info(`Router resolving ${modelName} (canonical: ${canonicalModel}). Target provider: ${target.provider}, Target model: ${target.model}`);

                return {
                    provider: target.provider,
                    model: target.model,
                    config: providerConfig,
                    modelConfig,
                    incomingModelAlias: modelName,
                    canonicalModel
                };
            }
        }

        throw new Error(`Model '${modelName}' not found in configuration`);
    }
}
