import { logger } from "../utils/logger";
import { filterHeadersForForwarding, addTracingHeaders, headersToObject } from "../utils/headers";
import type { ProviderConfig } from "../types/config";
import type { RetryAfterInfo } from "../types/health";

/**
 * Configuration for provider HTTP requests
 */
export interface ProviderRequestOptions {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
  requestId?: string;
}

/**
 * Provider client for making HTTP requests to LLM providers
 */
export class ProviderClient {
  private readonly defaultTimeout = 120_000; // 120 seconds for LLM responses

  constructor(
    private config: ProviderConfig,
    private requestLogger = logger
  ) {}

  /**
   * Makes an HTTP request to the provider
   * Handles authentication, headers, and error responses
   */
  async request<T = unknown>(options: ProviderRequestOptions): Promise<T> {
    const {
      method,
      url,
      headers: customHeaders = {},
      body,
      timeout = this.defaultTimeout,
      requestId = "unknown",
    } = options;

    try {
      // Get provider API key from environment
      const apiKey = this.getProviderApiKey();

      // Build headers
      const headers = this.buildHeaders(customHeaders, apiKey, requestId);

      this.requestLogger.debug("Making provider request", {
        provider: this.config.name,
        method,
        url: url.split("?")[0], // Log without query params
        requestId,
      });

      // Make the HTTP request with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Log response status
        this.requestLogger.debug("ProviderClient response received", {
          provider: this.config.name,
          status: response.status,
          requestId,
        });

        // Handle error responses from provider
        if (!response.ok) {
          const errorData = await this.parseResponseBody(response);
          throw new Error(
            `Provider returned error: ${response.status} ${JSON.stringify(errorData)}`
          );
        }

        // Parse response body
        const data = await this.parseResponseBody(response);
        return data as T;
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    } catch (error) {
      this.requestLogger.error("Provider request failed", {
        provider: this.config.name,
        error: error instanceof Error ? error.message : String(error),
        requestId,
      });
      throw error;
    }
  }

  /**
   * Builds headers for provider request
   * Includes custom headers, authentication, and tracing
   */
  private buildHeaders(
    customHeaders: Record<string, string>,
    apiKey: string,
    requestId: string
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...customHeaders,
    };

    // Add authentication based on provider config
    if (this.config.auth.type === "bearer") {
      headers["authorization"] = `Bearer ${apiKey}`;
    } else if (this.config.auth.type === "x-api-key") {
      headers["x-api-key"] = apiKey;
    }

    // Add custom headers from config if provided
    if (this.config.customHeaders) {
      Object.assign(headers, this.config.customHeaders);
    }

    // Add tracing headers
    return addTracingHeaders(headers, requestId);
  }

  /**
   * Gets the provider API key, supporting both direct values and {env:VAR} references
   */
  private getProviderApiKey(): string {
    const keyConfig = this.config.auth.apiKey;

    // Check for {env:VAR_NAME} format
    const envMatch = keyConfig.match(/^\{env:([^}]+)\}$/);
    if (envMatch && envMatch[1]) {
      const varName = envMatch[1];
      const apiKey = process.env[varName];

      if (!apiKey) {
        throw new Error(
          `Provider API key not found in environment: ${varName}`
        );
      }
      return apiKey;
    }

    // Return as direct string
    return keyConfig;
  }

  /**
   * Makes an HTTP request to the provider and returns the raw Response
   * Used for transformation pipeline where transformers need access to the raw response
   */
  async requestRaw(options: ProviderRequestOptions): Promise<Response> {
    const {
      method,
      url,
      headers: customHeaders = {},
      body,
      timeout = this.defaultTimeout,
      requestId = "unknown",
    } = options;

    try {
      // Get provider API key from environment
      const apiKey = this.getProviderApiKey();

      // Build headers
      const headers = this.buildHeaders(customHeaders, apiKey, requestId);

      this.requestLogger.debug("Making provider request (raw)", {
        provider: this.config.name,
        method,
        url: url.split("?")[0], // Log without query params
        requestId,
      });

      // Make the HTTP request with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Log response status
        this.requestLogger.debug("ProviderClient raw response received", {
          provider: this.config.name,
          status: response.status,
          requestId,
        });

        // For raw responses, we don't parse or throw on error status
        // Let the caller/transformer handle it
        return response;
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    } catch (error) {
      this.requestLogger.error("Provider request failed", {
        provider: this.config.name,
        error: error instanceof Error ? error.message : String(error),
        requestId,
      });
      throw error;
    }
  }

  /**
   * Parses response body as JSON
   */
  private async parseResponseBody(response: Response): Promise<unknown> {
    const contentType = response.headers.get("content-type");

    if (contentType && contentType.includes("application/json")) {
      return response.json();
    }

    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  /**
   * Extracts retry-after information from response
   * Supports both seconds and HTTP date formats
   */
  static parseRetryAfter(response: Response): RetryAfterInfo {
    const retryAfterHeader = response.headers.get("retry-after");

    if (!retryAfterHeader) {
      return { source: "default" };
    }

    // Try parsing as integer (seconds)
    const seconds = parseInt(retryAfterHeader, 10);
    if (!isNaN(seconds)) {
      return {
        retryAfter: seconds,
        source: "header",
      };
    }

    // Try parsing as HTTP date
    try {
      const date = new Date(retryAfterHeader);
      if (!isNaN(date.getTime())) {
        const secondsUntil = Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1000));
        return {
          retryAfter: secondsUntil,
          source: "header",
        };
      }
    } catch {
      // Invalid date format
    }

    // Could not parse, return default
    return { source: "default" };
  }
}
