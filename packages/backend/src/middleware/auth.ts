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
 * Extracts and validates the Bearer token from Authorization header
 * @param req - The incoming request
 * @param apiKeys - List of valid API keys from configuration
 * @returns AuthContext if valid, throws PlexusErrorResponse if invalid
 */
export function validateAuthHeader(
  req: Request,
  apiKeys: ApiKeyConfig[]
): AuthContext {
  const authHeader = req.headers.get("authorization");

  if (!authHeader) {
    logger.debug("Missing Authorization header");
    throw new PlexusErrorResponse(
      "authentication_error",
      "Missing Authorization header",
      401,
      "missing_auth_header"
    );
  }

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

  const token = parts[1];

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
