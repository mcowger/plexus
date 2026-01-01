import { getConfig } from '../config';
import { logger } from '../utils/logger';

export interface RouteResult {
    provider: string; // provider key in config
    model: string;    // model slug for that provider
    config: any;      // ProviderConfig
}

export class Router {
    static resolve(modelName: string): RouteResult {
        const config = getConfig();
        
        // 1. Check aliases
        const alias = config.models?.[modelName];
        if (alias) {
            // Load balancing: pick random target
            const targets = alias.targets;
            if (targets && targets.length > 0) {
                const target = targets[Math.floor(Math.random() * targets.length)];
                if (!target) {
                    throw new Error(`No target found for alias '${modelName}'`);
                }
                const providerConfig = config.providers[target.provider];
                
                if (!providerConfig) {
                    throw new Error(`Provider '${target.provider}' configured for alias '${modelName}' not found`);
                }
                
                logger.debug(`Routed '${modelName}' to '${target.provider}/${target.model}'`);
                return {
                    provider: target.provider,
                    model: target.model,
                    config: providerConfig
                };
            }
        }
        
        // 2. Fallback: Search providers for direct match
        for (const [providerKey, providerConfig] of Object.entries(config.providers)) {
            if (providerConfig.models && providerConfig.models.includes(modelName)) {
                logger.debug(`Direct match '${modelName}' in '${providerKey}'`);
                return {
                    provider: providerKey,
                    model: modelName,
                    config: providerConfig
                };
            }
        }

        throw new Error(`Model '${modelName}' not found in configuration`);
    }
}
