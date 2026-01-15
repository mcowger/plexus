import { logger } from "../utils/logger";
import { validateAuthHeader } from "../middleware/auth";
import { Router } from "../services/router";
import { PlexusErrorResponse } from "../types/errors";
import type { PlexusConfig } from "../types/config";

/**
 * OpenAI-compatible model list response
 */
interface ModelListResponse {
  object: "list";
  data: Array<{
    id: string;
    object: "model";
    created: number;
    owned_by: string;
    description?: string;
  }>;
}

/**
 * GET /v1/models handler
 * Returns list of available model aliases in OpenAI-compatible format
 */
export async function handleModels(
  req: Request,
  config: PlexusConfig,
  requestId: string
): Promise<Response> {
  const requestLogger = logger.child({ requestId, endpoint: "/v1/models" });

  try {
    // Validate authentication
    const auth = validateAuthHeader(req, config.apiKeys);
    requestLogger.debug("Request authenticated", { apiKey: auth.apiKeyName });

    // Note: For this simple route, we create a temporary router
    // In production, you might want to cache this or get it from context
    const configManager = {
      getCurrentConfig: () => config
    };
    const router = new Router(configManager as any);
    const aliases = router.getAllAliases();

    // Use consistent timestamp (current time)
    const created = Math.floor(Date.now() / 1000);

    // Build OpenAI-compatible response
    const response: ModelListResponse = {
      object: "list",
      data: aliases.map((alias) => ({
        id: alias.id,
        object: "model",
        created,
        owned_by: "plexus",
        description: alias.description,
      })),
    };

    requestLogger.debug("Models list generated", { count: aliases.length });

    return Response.json(response, { status: 200 });
  } catch (error) {
    requestLogger.error("Models request failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    // Handle PlexusErrorResponse
    if (error instanceof PlexusErrorResponse) {
      return error.toResponse();
    }

    // Generic error response
    const errorResponse = new PlexusErrorResponse(
      "api_error",
      error instanceof Error ? error.message : "Internal server error",
      500
    );
    return errorResponse.toResponse();
  }
}
