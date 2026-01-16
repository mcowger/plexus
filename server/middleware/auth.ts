import { logger } from "../utils/logger";
import { PlexusErrorResponse } from "../types/errors";
import type { ApiKeyConfig } from "../types/config";

/**
 * Context attached to authenticated requests
 */
export interface AuthContext {
  apiKeyName: string;
  isAuthenticated: boolean;
}

/**
 * Extracts and validates the API key from Authorization header or x-goog-api-key header
 * Supports:
 * - Authorization: Bearer <token> (OpenAI/Anthropic style)
 * - x-goog-api-key: <token> (Google/Gemini style)
 * @param req - The incoming request
 * @param apiKeys - List of valid API keys from configuration
 * @returns AuthContext if valid, throws PlexusErrorResponse if invalid
 */
export function validateAuthHeader(
  req: Request,
  apiKeys: ApiKeyConfig[]
): AuthContext {
  const authHeader = req.headers.get("authorization");
  const googApiKey = req.headers.get("x-goog-api-key");

  let token: string | undefined;

  // Check for x-goog-api-key header (Gemini style)
  if (googApiKey) {
    token = googApiKey;
    logger.debug("Using x-goog-api-key for authentication");
  }
  // Check for Authorization: Bearer header (OpenAI/Anthropic style)
  else if (authHeader) {
    // Parse Bearer token
    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0]?.toLowerCase() !== "bearer") {
      logger.debug("Invalid Authorization header format", { authHeader });
      throw new PlexusErrorResponse(
        "authentication_error",
        "Invalid Authorization header format. Use 'Bearer <token>'",
        401,
        "invalid_auth_format"
      );
    }
    token = parts[1];
    logger.debug("Using Authorization Bearer for authentication");
  }
  // No authentication header found
  else {
    logger.debug("Missing authentication header");
    throw new PlexusErrorResponse(
      "authentication_error",
      "Missing authentication header. Provide 'Authorization: Bearer <token>' or 'x-goog-api-key: <token>'",
      401,
      "missing_auth_header"
    );
  }

  // Find matching API key
  const apiKey = apiKeys.find((key) => key.secret === token && key.enabled);

  if (!apiKey || !token) {
    logger.debug("Invalid or disabled API key", { token: token?.slice(0, 10) + "..." });
    throw new PlexusErrorResponse(
      "authentication_error",
      "Invalid API key",
      401,
      "invalid_api_key"
    );
  }

  logger.debug("API key validated", { apiKeyName: apiKey.name });

  return {
    apiKeyName: apiKey.name,
    isAuthenticated: true,
  };
}
