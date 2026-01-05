import { logger } from 'src/utils/logger';
import { getConfig, ProviderConfig } from '../config';
import { CooldownManager } from './cooldown-manager';
import { SelectorFactory } from './selectors/factory';

export interface RouteResult {
    provider: string; // provider key in config
    model: string;    // model slug for that provider
    config: ProviderConfig;      // ProviderConfig
    modelConfig?: any; // The specific model config within that provider
}

export class Router {
    static resolve(modelName: string): RouteResult {
        const config = getConfig();
        
        // 1. Check aliases
        const alias = config.models?.[modelName];
        if (alias) {
            // Load balancing: pick target using selector
            const targets = alias.targets;
            if (targets && targets.length > 0) {
                const healthyTargets = CooldownManager.getInstance().filterHealthyTargets(targets);

                if (healthyTargets.length === 0) {
                    throw new Error(`All providers for model alias '${modelName}' are currently on cooldown.`);
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

                const selector = SelectorFactory.getSelector(alias.selector);
                const target = selector.select(enrichedTargets);
                
                if (!target) {
                    throw new Error(`No target selected for alias '${modelName}'`);
                }
                const providerConfig = config.providers[target.provider];
                
                if (!providerConfig) {
                    throw new Error(`Provider '${target.provider}' configured for alias '${modelName}' not found`);
                }
                
                // logger.debug(`Routed '${modelName}' to '${target.provider}/${target.model}' using ${alias.selector || 'default'} selector`);
                
                let modelConfig = undefined;
                if (!Array.isArray(providerConfig.models) && providerConfig.models) {
                    modelConfig = providerConfig.models[target.model];
                }

                logger.info(`Router resolving ${modelName}. Target provider: ${target.provider}, Target model: ${target.model}`);

                return {
                    provider: target.provider,
                    model: target.model,
                    config: providerConfig,
                    modelConfig
                };
            }
        }

        throw new Error(`Model '${modelName}' not found in configuration`);
    }
}
