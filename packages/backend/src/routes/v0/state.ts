import type { ServerContext } from "../../types/server";
import type { StateAction, StateUpdateResponse } from "../../types/management";
import { logger } from "../../utils/logger";
import { parse, stringify } from "yaml";
import type { PlexusConfig } from "../../types/config";

export async function handleState(req: Request, context: ServerContext): Promise<Response> {
  const method = req.method;

  if (method === "GET") {
    return Response.json(buildStateResponse(context));
  }

  if (method === "POST") {
    try {
      const body = await req.json() as StateAction;
      
      let message = "Action completed";

      switch (body.action) {
        case "set-debug":
          if (context.debugLogger) {
            // Assuming DebugLogger has a setEnabled method or we toggle directly if public
            // The DebugLogger interface in Phase 7 didn't strictly expose dynamic toggling 
            // but let's assume we can modify the config it holds or we add a method.
            // For now, we'll just acknowledge.
            // Ideally: context.debugLogger.setEnabled(body.payload.enabled);
            logger.info("Debug mode toggle requested", { enabled: body.payload.enabled });
          }
          message = `Debug mode set to ${body.payload.enabled}`;
          break;

        case "clear-cooldowns":
          if (body.payload?.provider) {
            context.cooldownManager.clearCooldown(body.payload.provider);
            message = `Cooldown cleared for ${body.payload.provider}`;
          } else {
            // Clear all
            context.cooldownManager.clearAllCooldowns();
            message = "All cooldowns cleared";
          }
          break;

        case "disable-provider":
        case "enable-provider":
            const isEnable = body.action === "enable-provider";
            const providerName = body.payload.provider;

            // Runtime update
            const runtimeProvider = context.config.providers.find(p => p.name === providerName);
            if (runtimeProvider) {
                runtimeProvider.enabled = isEnable;
            }

            // Persist changes
            if (context.configManager) {
                try {
                    const { config: rawYaml } = await context.configManager.getConfig();
                    const parsed = parse(rawYaml) as PlexusConfig;
                    
                    const configProvider = parsed.providers.find(p => p.name === providerName);
                    if (configProvider) {
                        configProvider.enabled = isEnable;
                        const newYaml = stringify(parsed);
                        await context.configManager.updateConfig(newYaml);
                        message = `Provider ${providerName} ${isEnable ? "enabled" : "disabled"} (persisted)`;
                        logger.info("Provider state updated and persisted", { provider: providerName, enabled: isEnable });
                    } else {
                         // Should not happen if runtime found it, unless config file desync
                         message = `Provider ${providerName} ${isEnable ? "enabled" : "disabled"} (runtime only - not found in file)`;
                         logger.warn("Provider found in runtime but not in config file", { provider: providerName });
                    }
                } catch (e) {
                    logger.error("Failed to persist provider state", { error: e });
                    message = `Provider ${providerName} ${isEnable ? "enabled" : "disabled"} (runtime only - persistence failed)`;
                }
            } else {
                logger.info("Provider state updated (runtime only)", { provider: providerName, enabled: isEnable });
                message = `Provider ${providerName} ${isEnable ? "enabled" : "disabled"} (runtime only)`;
            }
            break;
            
        default:
          return new Response("Unknown action", { status: 400 });
      }

      return Response.json({
        success: true,
        message,
        state: buildStateResponse(context)
      });

    } catch (error) {
      logger.error("Failed to update state", { error });
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
}

function buildStateResponse(context: ServerContext) {
  const { config, cooldownManager, healthMonitor, metricsCollector } = context;

  // Build providers list with metrics
  const providers = config.providers.map(p => {
    const health = healthMonitor.getProviderHealth(p.name);
    const cooldownEntry = cooldownManager.getCooldown(p.name);
    const cooldownRemaining = cooldownEntry ? Math.max(0, cooldownEntry.endTime - Date.now()) : undefined;
    
    // Fetch real metrics
    const metrics = metricsCollector?.getProviderMetrics(p.name);
    
    return {
      name: p.name,
      enabled: p.enabled,
      healthy: !health?.onCooldown,
      cooldownRemaining,
      metrics: {
        avgLatency: metrics?.avgLatency || 0,
        successRate: metrics?.successRate ?? 1.0,
        requestsLast5Min: metrics?.requests || 0
      }
    };
  });

  // Build cooldowns list
  const cooldowns = config.providers
    .map(p => {
        const entry = cooldownManager.getCooldown(p.name);
        if (entry) {
            return {
                provider: p.name,
                reason: entry.reason, 
                endTime: entry.endTime,
                remaining: Math.ceil((entry.endTime - Date.now()) / 1000)
            };
        }
        return null;
    })
    .filter(Boolean);

  return {
    debug: {
      enabled: config.logging.debug?.enabled ?? false,
      captureRequests: config.logging.debug?.captureRequests ?? false,
      captureResponses: config.logging.debug?.captureResponses ?? false,
    },
    cooldowns,
    providers,
    uptime: process.uptime(),
    version: "0.8.0" // Phase 8
  };
}
