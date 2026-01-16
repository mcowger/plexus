import { logger } from "../utils/logger";
import { validateAuthHeader } from "../middleware/auth";
import { Dispatcher } from "../services/dispatcher";
import { PlexusErrorResponse } from "../types/errors";
import type { ServerContext } from "../types/server";

/**
 * POST /v1beta/models/:modelWithAction handler
 * Accepts Gemini-native API requests with model and action in the URL
 * Format: /v1beta/models/{model}:{action}
 * Examples:
 *   - /v1beta/models/gemini-1.5-pro:generateContent
 *   - /v1beta/models/gemini-1.5-flash:streamGenerateContent
 */
export async function handleGemini(
  req: Request,
  context: ServerContext,
  requestId: string,
  clientIp: string,
  modelWithAction: string
): Promise<Response> {
  const requestLogger = logger.child({ 
    requestId, 
    endpoint: "/v1beta/models/:modelWithAction", 
    clientIp,
    modelWithAction 
  });
  const debugLogger = context.debugLogger!;

  try {
    // Parse URL components: "gemini-1.5-pro:streamGenerateContent"
    const parts = modelWithAction.split(':');
    const modelName = parts[0];
    const action = parts[1] || 'generateContent'; // Default to non-streaming

    requestLogger.debug("Parsing Gemini request", { modelName, action });

    // Parse request body
    let body: any;
    try {
      body = await req.json();
    } catch (error) {
      requestLogger.debug("Failed to parse request body");
      throw new PlexusErrorResponse(
        "invalid_request_error",
        "Invalid request body: must be valid JSON",
        400,
        "invalid_json"
      );
    }

    // Inject model name from URL into request body
    body.model = modelName;

    // Auto-detect streaming from action name
    if (action.includes('streamGenerateContent')) {
      body.stream = true;
      requestLogger.debug("Streaming request detected from action", { action });
    } else {
      body.stream = false;
    }

    // Start debug trace and capture the incoming client request
    debugLogger.startTrace(requestId, "gemini", body, Object.fromEntries(req.headers));

    // Validate authentication
    const auth = validateAuthHeader(req, context.config.apiKeys);
    requestLogger.debug("Request authenticated", { apiKey: auth.apiKeyName });

    requestLogger.debug("Dispatching Gemini request", {
      model: modelName,
      action,
      streaming: body.stream,
      contentsCount: body.contents?.length || 0,
    });

    // Create dispatcher and process request using the transformation pipeline
    const dispatcher = new Dispatcher(context);
    const response = await dispatcher.dispatchGemini(
      body, 
      requestId, 
      clientIp, 
      auth.apiKeyName
    );

    // The dispatcher returns a Response object that's already been transformed
    // to the client's expected format (Gemini native format)
    return response;
  } catch (error) {
    requestLogger.error("Gemini request failed", {
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
