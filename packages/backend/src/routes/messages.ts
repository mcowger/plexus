import { logger } from "../utils/logger";
import { Dispatcher } from "../services/dispatcher";
import { PlexusErrorResponse } from "../types/errors";
import type { ServerContext } from "../types/server";

/**
 * POST /v1/messages handler
 * Accepts Anthropic Messages API requests and routes to configured providers
 * Uses the transformation pipeline to handle cross-provider routing
 */
export async function handleMessages(
  req: Request,
  context: ServerContext,
  requestId: string,
  clientIp: string
): Promise<Response> {
  const requestLogger = logger.child({ requestId, endpoint: "/v1/messages", clientIp });

  try {
    // Validate authentication - support both Bearer and x-api-key headers
    const authHeader = req.headers.get("Authorization") || req.headers.get("x-api-key");
    if (!authHeader) {
      throw new PlexusErrorResponse(
        "authentication_error",
        "Missing authentication header",
        401
      );
    }

    // Extract API key from either Bearer token or x-api-key header
    const apiKey = authHeader.startsWith("Bearer ") 
      ? authHeader.substring(7)
      : authHeader;

    // Validate against configured API keys
    const validKey = context.config.apiKeys.find(k => k.secret === apiKey && k.enabled);
    if (!validKey) {
      throw new PlexusErrorResponse(
        "authentication_error",
        "Invalid API key",
        401
      );
    }

    requestLogger.debug("Request authenticated", { apiKey: validKey.name });

    // Parse request body
    let body: any;
    try {
      body = await req.json();
    } catch (error) {
      requestLogger.debug("Failed to parse request body");
      throw new PlexusErrorResponse(
        "invalid_request_error",
        "Invalid request body: must be valid JSON",
        400
      );
    }

    // Basic validation of required fields
    if (!body.model) {
      throw new PlexusErrorResponse(
        "invalid_request_error",
        "Missing required field: model",
        400
      );
    }

    if (!body.messages || !Array.isArray(body.messages)) {
      throw new PlexusErrorResponse(
        "invalid_request_error",
        "Missing required field: messages",
        400
      );
    }

    if (!body.max_tokens || typeof body.max_tokens !== "number") {
      throw new PlexusErrorResponse(
        "invalid_request_error",
        "Missing required field: max_tokens",
        400
      );
    }

    requestLogger.debug("Request validated", {
      model: body.model,
      messageCount: body.messages.length,
      maxTokens: body.max_tokens,
    });

    // Create dispatcher and process request using the transformation pipeline
    const dispatcher = new Dispatcher(
      context.config,
      context.cooldownManager,
      context.costCalculator,
      context.metricsCollector,
      context.usageLogger,
      context.debugLogger
    );
    const response = await dispatcher.dispatchMessages(body, requestId, clientIp, validKey.name);

    // The dispatcher returns a Response object that's already been transformed
    // to the client's expected format (Anthropic messages format)
    return response;
  } catch (error) {
    requestLogger.error("Messages request failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    // Handle PlexusErrorResponse - convert to Anthropic error format
    if (error instanceof PlexusErrorResponse) {
            return Response.json(
              {
                type: "error",
                error: error.toJSON().error,
              },
              { status: error.status }
            );    }

    // Generic error response in Anthropic format
    return Response.json(
      {
        type: "error",
        error: {
          type: "api_error",
          message: error instanceof Error ? error.message : "Internal server error",
        },
      },
      { status: 500 }
    );
  }
}
