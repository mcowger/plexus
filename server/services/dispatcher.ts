import { logger } from "../utils/logger";
import { ProviderClient } from "./provider-client";
import { Router } from "./router";
import { PlexusErrorResponse } from "../types/errors";
import {
  transformerFactory,
  TransformerFactory,
  ApiType,
  getProviderApiType,
} from "./transformer-factory";
import type { PlexusConfig, ProviderConfig } from "../types/config";
import type { CooldownManager } from "./cooldown-manager";
import type { CooldownReason } from "../types/health";
import type { CostCalculator } from "./cost-calculator";
import type { MetricsCollector } from "./metrics-collector";
import type { DebugLogger } from "./debug-logger";
import { ServerContext } from "../types/server";
import { StreamTap } from "./streamtap";
import type { RequestContext, ResponseInfo } from "./usage-logger";

/**
 * Dispatcher service for routing requests to appropriate providers
 * Implements the full transformation pipeline using @musistudio/llms transformers
 */
export class Dispatcher {
  private router: Router;
  private context: ServerContext;

  constructor(context: ServerContext) {
    this.context = context;
    this.router = new Router(
      context.configManager!,
      context.cooldownManager,
      context.costCalculator,
      context.metricsCollector
    );
  }

  /**
   * Updates configuration (e.g., on config reload)
   */
  updateConfig(): void {
    this.router.updateConfig();
  }

  /**
   * Main dispatch method that handles the full transformation pipeline:
   * 1. Detect incoming API type
   * 2. Transform request: Client format → Unified format
   * 3. Route to provider
   * 4. Determine provider's native API type
   * 5. Transform request: Unified → Provider format
   * 6. Execute request
   * 7. Transform response: Provider → Client expected format
   *
   * @param request - The incoming request body
   * @param requestId - Request ID for tracing
   * @param clientApiType - The API type of the incoming request (chat or messages)
   * @param clientIp - Client IP address
   * @param apiKeyName - Name of the API key used for authentication
   * @returns Response in the client's expected format
   */
  async dispatch(
    request: any,
    requestId: string,
    clientApiType: ApiType,
    clientIp: string = "0.0.0.0",
    apiKeyName: string = "default"
  ): Promise<Response> {
    const requestLogger = logger.child({ requestId, clientApiType });

    // Create request context for usage logging
    const requestContext: RequestContext = {
      id: requestId,
      startTime: Date.now(),
      clientIp,
      apiKeyName,
      clientApiType,
      streaming: request.stream || false,
    };

    try {
      // Step 1: Resolve model using router
      const resolution = this.router.resolve(request.model);

      if (!resolution.success) {
        requestLogger.debug("Model resolution failed", {
          model: request.model,
          error: resolution.error,
          code: resolution.code,
        });
        throw new PlexusErrorResponse(
          "invalid_request_error",
          resolution.error,
          404,
          "model_not_found"
        );
      }

      const { provider, model, aliasUsed } = resolution.target;

      // Update request context with routing information
      requestContext.aliasUsed = aliasUsed;
      requestContext.actualProvider = provider.name;
      requestContext.actualModel = model;

      // Step 2: Determine provider's native API type
      const providerApiType = getProviderApiType(
        provider.apiTypes || ["chat"],
        clientApiType
      );

      requestContext.targetApiType = providerApiType;

      requestLogger.debug("Dispatching request", {
        requestedModel: request.model,
        resolvedAlias: aliasUsed,
        provider: provider.name,
        model,
        clientApiType,
        providerApiType,
        needsTransformation: TransformerFactory.needsTransformation(
          clientApiType,
          providerApiType
        ),
      });

      // Step 3: Transform request to unified format (from client format)
      const unifiedRequest = await transformerFactory.transformToUnified(
        request,
        clientApiType
      );

      // Override model with resolved model name
      unifiedRequest.model = model;

      requestLogger.debug("Request transformed to unified format", {
        messageCount: unifiedRequest.messages?.length,
      });

      // Step 4: Transform from unified to provider format
      const providerRequest = await transformerFactory.transformFromUnified(
        unifiedRequest,
        providerApiType
      );

      // Add any extra body params from provider config
      if (provider.extraBody) {
        Object.assign(providerRequest, provider.extraBody);
      }

      requestLogger.debug("Request transformed to provider format", {
        provider: provider.name,
        apiType: providerApiType,
      });

      requestLogger.silly("About to capture provider request", {
        requestId,
        providerApiType,
      });

      this.context.debugLogger?.captureProviderRequest(
        requestId,
        providerApiType,
        providerRequest
      );

      // Step 5: Get the appropriate endpoint URL
      const endpointUrl = this.getEndpointUrl(provider, providerApiType);
      if (!endpointUrl) {
        throw new Error(
          `Provider '${provider.name}' has no ${providerApiType} endpoint configured`
        );
      }

      // Step 6: Create provider client and make request
      const client = new ProviderClient(provider, requestLogger);

      const providerResponse = await client.requestRaw({
        method: "POST",
        url: endpointUrl,
        body: providerRequest,
        requestId,
      });

      requestLogger.debug("Dispatcher received provider response", {
        provider: provider.name,
        status: providerResponse.status,
      });

      // Check for error responses and trigger cooldowns
      if (!providerResponse.ok) {
        this.handleProviderError(provider.name, providerResponse);
      }

      // Step 7: Check if this is a streaming response
      const isStreaming = providerResponse.headers
        .get("Content-Type")
        ?.includes("text/event-stream");

      if (isStreaming) {
        requestLogger.debug("Streaming response detected", {
          providerApiType,
          clientApiType,
          needsTransformation: TransformerFactory.needsTransformation(
            clientApiType,
            providerApiType
          ),
        });

        // Log initial usage entry for streaming request (with 0 tokens)
        // This will be updated later when the stream completes and response is reconstructed
        if (this.context.usageLogger) {
          try {
            const responseInfo: ResponseInfo = {
              success: true,
              streaming: true,
              usage: {
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 0,
                cacheCreationTokens: 0,
                reasoningTokens: 0,
              },
            };

            await this.context.usageLogger.logRequest(requestContext, responseInfo);
            requestLogger.debug("Created initial usage log entry for streaming request", {
              requestId,
            });
          } catch (error) {
            requestLogger.error("Failed to log initial streaming usage", {
              error: error instanceof Error ? error.message : String(error),
            });
            // Don't throw - logging failures shouldn't break requests
          }
        }

        // --- TAP 1: Raw Provider Response (Silent / False) ---
        // Track first token time at provider level for fair performance measurement
        const streamTimeout = this.context.config.logging.debug?.streamTimeoutSeconds;

        const providerTap = new StreamTap(
          this.context.debugLogger!,
          requestId,
          false,
          this.context.usageLogger,
          requestContext,
          streamTimeout
        );

        const tappedProviderBody = providerResponse.body
          ? providerTap.tap(providerResponse.body, "provider")
          : null;
        // --- TRANSFORMATION ---
        // Pass the already-tapped provider body into the transformer.
        // Wrap the tapped body back into a proper Response instance
        // This prevents the "undefined is not an object" error
        const providerProxy = new Response(tappedProviderBody, {
          status: providerResponse.status,
          statusText: providerResponse.statusText,
          headers: providerResponse.headers,
        });

        // --- TRANSFORMATION ---
        const transformedResponse = await transformerFactory.transformResponse(
          providerProxy, // Pass the proxy Response, NOT the POJO
          providerApiType,
          clientApiType
        );

        // --- TAP 2: Transformed Client Response (Final) ---
        // Track client TTFT to measure transformation overhead
        const streamTap = new StreamTap(
          this.context.debugLogger!,
          requestId,
          true,
          this.context.usageLogger,
          requestContext,
          streamTimeout
        );

        // 3. Wrap the body in the tap
        // This is a "transparent pipe" that records while it flows
        const tappedBody = transformedResponse.body
          ? streamTap.tap(transformedResponse.body, "client")
          : null;

        // Return streaming response with proper SSE headers
        return new Response(tappedBody, {
          status: transformedResponse.status,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no", // Disable buffering for nginx
          },
        });
      }

      requestLogger.silly("About to capture provider response", {
        requestId,
        status: providerResponse.status,
      });

      // Parse provider response body to extract usage BEFORE transformation
      const providerResponseBody = await providerResponse.clone().json() as any;

      this.context.debugLogger?.captureProviderResponse(
        requestId,
        providerResponse.status,
        Object.fromEntries(providerResponse.headers),
        providerResponseBody
      );

      // Extract and parse usage from provider response
      let unifiedUsage = null;
      if (providerResponseBody?.usage || providerResponseBody?.usageMetadata) {
        try {
          const providerTransformer = transformerFactory.getTransformer(providerApiType);
          const rawUsage = providerResponseBody.usage || providerResponseBody.usageMetadata;
          unifiedUsage = providerTransformer.parseUsage(rawUsage);
        } catch (error) {
          requestLogger.error("Failed to parse usage from provider response", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Step 7: Transform non-streaming response back to client's expected format
      const transformedResponse = await transformerFactory.transformResponse(
        providerResponse,
        providerApiType,
        clientApiType
      );

      requestLogger.debug("Response transformed to client format", {
        clientApiType,
      });

      requestLogger.silly("About to capture client response", {
        requestId,
        status: providerResponse.status,
      });

      // Parse response body for debug logging
      const responseBody = await transformedResponse.clone().json();

      this.context.debugLogger?.captureClientResponse(
        requestId,
        providerResponse.status,
        responseBody
      );

      // Log usage if usageLogger is available and we have parsed usage
      if (this.context.usageLogger && unifiedUsage) {
        try {
          const responseInfo: ResponseInfo = {
            success: true,
            streaming: false,
            usage: {
              inputTokens: unifiedUsage.input_tokens,
              outputTokens: unifiedUsage.output_tokens,
              cacheReadTokens: unifiedUsage.cache_read_tokens,
              cacheCreationTokens: unifiedUsage.cache_creation_tokens,
              reasoningTokens: unifiedUsage.reasoning_tokens,
            },
          };

          await this.context.usageLogger.logRequest(requestContext, responseInfo);
        } catch (error) {
          requestLogger.error("Failed to log usage", {
            error: error instanceof Error ? error.message : String(error),
          });
          // Don't throw - logging failures shouldn't break requests
        }
      }

      this.context.debugLogger?.completeTrace(requestId);
      return transformedResponse;
    } catch (error) {
      requestLogger.error("Dispatcher error", {
        error: error instanceof Error ? error.message : String(error),
      });
      await this.context.debugLogger?.completeTrace(requestId);

      // Log error if usageLogger is available and we have provider info
      if (this.context.usageLogger && requestContext.actualProvider) {
        try {
          const responseInfo: ResponseInfo = {
            success: false,
            streaming: false,
            errorType: error instanceof PlexusErrorResponse ? error.type : "api_error",
            errorMessage: error instanceof Error ? error.message : String(error),
            httpStatus: error instanceof PlexusErrorResponse ? error.status : 500,
          };

          await this.context.usageLogger.logRequest(requestContext, responseInfo);
        } catch (logError) {
          requestLogger.error("Failed to log error", {
            error: logError instanceof Error ? logError.message : String(logError),
          });
          // Don't throw - logging failures shouldn't break error handling
        }
      }

      // Check if this is a network/connection error
      if (error instanceof Error && this.isConnectionError(error)) {
        // Get provider name from resolution if available
        const resolution = this.router.resolve(request.model);
        if (resolution.success && this.context.cooldownManager) {
          this.context.cooldownManager.setCooldown({
            provider: resolution.target.provider.name,
            reason: "connection_error",
            message: error.message,
          });
        }
      }

      // If already a PlexusErrorResponse, re-throw it
      if (error instanceof PlexusErrorResponse) {
        throw error;
      }

      // Convert other errors to API error
      throw new PlexusErrorResponse(
        "api_error",
        error instanceof Error ? error.message : "Unknown error",
        500
      );
    }
  }

  /**
   * Dispatch a chat completion request (OpenAI format)
   * Convenience method that calls dispatch with clientApiType="chat"
   */
  async dispatchChatCompletion(
    request: any,
    requestId: string,
    clientIp?: string,
    apiKeyName?: string
  ): Promise<Response> {
    return this.dispatch(request, requestId, "chat", clientIp, apiKeyName);
  }

  /**
   * Dispatch a messages request (Anthropic format)
   * Convenience method that calls dispatch with clientApiType="messages"
   */
  async dispatchMessages(
    request: any,
    requestId: string,
    clientIp?: string,
    apiKeyName?: string
  ): Promise<Response> {
    return this.dispatch(request, requestId, "messages", clientIp, apiKeyName);
  }

  /**
   * Get the appropriate endpoint URL for a provider based on API type
   */
  private getEndpointUrl(
    provider: ProviderConfig,
    apiType: ApiType
  ): string | undefined {
    if (apiType === "messages") {
      return provider.baseUrls.messages;
    }
    return provider.baseUrls.chat;
  }

  /**
   * Handles provider errors by triggering appropriate cooldowns
   */
  private handleProviderError(providerName: string, response: Response): void {
    if (!this.context.cooldownManager) {
      return;
    }

    const status = response.status;
    let reason: CooldownReason;
    let message = `HTTP ${status}`;

    // Map HTTP status to cooldown reason
    if (status === 429) {
      reason = "rate_limit";
      message = "Rate limit exceeded";
    } else if (status === 401 || status === 403) {
      reason = "auth_error";
      message = "Authentication error";
    } else if (status === 408) {
      reason = "timeout";
      message = "Request timeout";
    } else if (status >= 500 && status < 600) {
      reason = "server_error";
      message = "Server error";
    } else {
      // Don't trigger cooldown for other 4xx errors (bad request, etc.)
      return;
    }

    // Extract retry-after from headers
    const retryAfterInfo = ProviderClient.parseRetryAfter(response);

    // Set cooldown
    this.context.cooldownManager.setCooldown({
      provider: providerName,
      reason,
      httpStatus: status,
      message,
      retryAfter: retryAfterInfo.retryAfter,
    });
  }

  /**
   * Checks if an error is a connection/network error
   */
  private isConnectionError(error: Error): boolean {
    const connectionErrors = [
      "fetch failed",
      "ECONNREFUSED",
      "ENOTFOUND",
      "ETIMEDOUT",
      "ECONNRESET",
      "network",
      "connection",
    ];

    const errorMessage = error.message.toLowerCase();
    return connectionErrors.some((term) => errorMessage.includes(term));
  }
}
