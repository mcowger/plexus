import { Hono } from "hono";
import { ModelConfig } from "@plexus/types";
import { configLoader } from "../../config/loader.js";
import { logger } from "../../utils/logger.js";

// Helper function to transform ModelConfig to ModelInfo
export function transformModelConfigForV1Models(
  modelConfig: ModelConfig
) {
  // Convert provider map to an array of provider info
  const providersList = Object.entries(modelConfig.providers).map(([providerId, canonicalSlug]) => ({
    id: providerId,
    canonical_slug: canonicalSlug
  }));

  return {
    id: modelConfig.display_slug,
    name: modelConfig.display_name,
    context_length: modelConfig.contextWindow,
    pricing: {
      prompt: modelConfig.inputTokenPrice?.toString() || "0.0",
      completion: modelConfig.outputTokenPrice?.toString() || "0.0",
    },
    providers: providersList
  };
}

// Models route handler
export async function handleModelsEndpoint(c: any) {
  try {
    const configSnapshot = configLoader.getSnapshot();

    if (!configSnapshot) {
      return c.json([], 200);
    }

    // Transform all models to the required format
    const models: Record<string, any>[] = [];

    for (const [modelName, modelConfig] of configSnapshot.models) {
      try {
        const modelInfo = transformModelConfigForV1Models(
          modelConfig
        );
        models.push(modelInfo);
      } catch (error) {
        logger.warn(`Failed to transform model ${modelName}:`, error);
      }
    }

    return c.json(models);
  } catch (error) {
    logger.error("Models endpoint error:", error);
    return c.json(
      {
        error: error instanceof Error ? error.message : "Failed to get models",
      },
      500
    );
  }
}

// Register models routes
export function registerV1ModelsRoutes(app: Hono) {
  // Models endpoint - no authentication required
  app.get("/v1/models", handleModelsEndpoint);
}