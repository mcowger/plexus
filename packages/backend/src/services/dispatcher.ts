import { logger } from "../utils/logger";
import { ProviderClient } from "./provider-client";
import { Router } from "./router";
import { PlexusErrorResponse } from "../types/errors";
import { transformerFactory, TransformerFactory, ApiType, getProviderApiType } from "./transformer-factory";
import type { PlexusConfig, ProviderConfig } from "../types/config";
import type { CooldownManager } from "./cooldown-manager";
import type { CooldownReason } from "../types/health";
import type { CostCalculator } from "./cost-calculator";
import type { MetricsCollector } from "./metrics-collector";
import type { UsageLogger, RequestContext, ResponseInfo } from "./usage-logger";
import type { DebugLogger } from "./debug-logger";

/**
 * Dispatcher service for routing requests to appropriate providers
 * Implements the full transformation pipeline using @musistudio/llms transformers
 */
export class Dispatcher {
  private router: Router;
  private cooldownManager?: CooldownManager;
  private usageLogger?: UsageLogger;
  private metricsCollector?: MetricsCollector;
  private costCalculator?: CostCalculator;
  private debugLogger?: DebugLogger;

  constructor(
    private config: PlexusConfig,
    cooldownManager?: CooldownManager,
    costCalculator?: CostCalculator,
    metricsCollector?: MetricsCollector,
    usageLogger?: UsageLogger,
    debugLogger?: DebugLogger
  ) {
    this.router = new Router(config, cooldownManager, costCalculator, metricsCollector);
    this.cooldownManager = cooldownManager;
    this.usageLogger = usageLogger;
    this.metricsCollector = metricsCollector;
    this.costCalculator = costCalculator;
    this.debugLogger = debugLogger;
  }

  /**
   * Updates configuration (e.g., on config reload)
   * @param config - New configuration
   */
  updateConfig(config: PlexusConfig): void {
    this.config = config;
    this.router.updateConfig(config);
    this.cooldownManager?.updateConfig(config);
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

    // Create request context for observability (Phase 7)
    const requestContext: RequestContext | undefined = this.usageLogger
      ? {
          id: requestId,
          startTime: Date.now(),
          clientIp,
          apiKeyName,
          clientApiType,
        }
      : undefined;

    try {
      // Start debug trace (Phase 7)
      if (this.debugLogger?.enabled) {
        this.debugLogger.startTrace(requestId, clientApiType, request);
      }

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

      // Update request context with routing info (Phase 7)
      if (requestContext) {
        requestContext.aliasUsed = aliasUsed;
        requestContext.actualProvider = provider.name;
        requestContext.actualModel = model;
      }

      // Step 2: Determine provider's native API type
      const providerApiType = getProviderApiType(provider.apiTypes || ["chat"], clientApiType);

      // Update request context with API type info (Phase 7)
      if (requestContext) {
        requestContext.targetApiType = providerApiType;
        requestContext.passthrough = !TransformerFactory.needsTransformation(clientApiType, providerApiType);
      }

      requestLogger.debug("Dispatching request", {
        requestedModel: request.model,
        resolvedAlias: aliasUsed,
        provider: provider.name,
        model,
        clientApiType,
        providerApiType,
        needsTransformation: TransformerFactory.needsTransformation(clientApiType, providerApiType),
      });

      // Step 3: Transform request to unified format (from client format)
      const unifiedRequest = await transformerFactory.transformToUnified(
        request,
        clientApiType
      );

      // Override model with resolved model name
      unifiedRequest.model = model;

      // Capture unified request (Phase 7)
      if (this.debugLogger?.enabled) {
        this.debugLogger.captureUnifiedRequest(requestId, unifiedRequest);
      }

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

      // Capture provider request (Phase 7)
      if (this.debugLogger?.enabled) {
        this.debugLogger.captureProviderRequest(requestId, providerApiType, providerRequest);
      }

      requestLogger.debug("Request transformed to provider format", {
        provider: provider.name,
        apiType: providerApiType,
      });

      // Step 5: Get the appropriate endpoint URL
      const endpointUrl = this.getEndpointUrl(provider, providerApiType);
      if (!endpointUrl) {
        throw new Error(`Provider '${provider.name}' has no ${providerApiType} endpoint configured`);
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
      const isStreaming = providerResponse.headers.get("Content-Type")?.includes("text/event-stream");

      if (requestContext) {
        requestContext.streaming = isStreaming;
      }

      if (isStreaming) {
        requestLogger.debug("Streaming response detected", {
          providerApiType,
          clientApiType,
          needsTransformation: TransformerFactory.needsTransformation(clientApiType, providerApiType),
        });

        // For streaming, transform response back to client's expected format
        // The transformer will handle stream-to-stream transformation
        const transformedResponse = await transformerFactory.transformResponse(
          providerResponse,
          providerApiType,
          clientApiType
        );

        // Intercept the stream to extract usage from final snapshot (Phase 7)
        const { stream, usagePromise } = this.interceptStreamForUsage(
          transformedResponse.body,
          clientApiType,
          requestContext,
          requestLogger
        );

        // Return streaming response with proper SSE headers
        return new Response(stream, {
          status: transformedResponse.status,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no", // Disable buffering for nginx
          },
        });
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

      // Log usage for non-streaming requests (Phase 7)
      if (this.usageLogger && requestContext) {
        try {
          // Parse response to extract usage information
          const responseBody = await transformedResponse.json() as any;
          
          // Capture provider and client responses for debug (Phase 7)
          if (this.debugLogger?.enabled) {
            // For non-streaming, we already have the full response body
            this.debugLogger.captureProviderResponse(
              requestId,
              providerResponse.status,
              Object.fromEntries(providerResponse.headers.entries()),
              responseBody
            );
            this.debugLogger.captureClientResponse(
              requestId,
              transformedResponse.status,
              responseBody
            );
            await this.debugLogger.completeTrace(requestId);
          }

          let usageInfo: {
              inputTokens: number;
              outputTokens: number;
              cacheReadTokens: number;
              cacheCreationTokens: number;
              reasoningTokens: number;
          } | undefined;

          const clientTransformer = transformerFactory.getTransformer(clientApiType);
          const rawUsage = responseBody.usage || responseBody.usageMetadata;
          
          if (rawUsage) {
             const unifiedUsage = clientTransformer.parseUsage(rawUsage);
             usageInfo = {
                 inputTokens: unifiedUsage.input_tokens,
                 outputTokens: unifiedUsage.output_tokens,
                 cacheReadTokens: unifiedUsage.cache_read_tokens || 0,
                 cacheCreationTokens: unifiedUsage.cache_creation_tokens || 0,
                 reasoningTokens: unifiedUsage.reasoning_tokens || 0
             };
          }

          const responseInfo: ResponseInfo = {
            success: true,
            streaming: false,
            usage: usageInfo,
          };

          await this.usageLogger.logRequest(requestContext, responseInfo);

          // Return a new Response with the parsed body
          return Response.json(responseBody, {
            status: transformedResponse.status,
            headers: transformedResponse.headers,
          });
        } catch (error) {
          requestLogger.warn("Failed to log usage", {
            error: error instanceof Error ? error.message : String(error),
          });
          // Return original response if logging fails
          return transformedResponse;
        }
      }

      return transformedResponse;
    } catch (error) {
      requestLogger.error("Dispatcher error", {
        error: error instanceof Error ? error.message : String(error),
      });

      // Log error (Phase 7)
      if (this.usageLogger && requestContext) {
        const responseInfo: ResponseInfo = {
          success: false,
          streaming: false,
          errorType: error instanceof PlexusErrorResponse ? error.type : "api_error",
          errorMessage: error instanceof Error ? error.message : String(error),
          httpStatus: error instanceof PlexusErrorResponse ? error.status : 500,
        };
        await this.usageLogger.logRequest(requestContext, responseInfo);
      }

      // Check if this is a network/connection error
      if (error instanceof Error && this.isConnectionError(error)) {
        // Get provider name from resolution if available
        const resolution = this.router.resolve(request.model);
        if (resolution.success && this.cooldownManager) {
          this.cooldownManager.setCooldown({
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
  private getEndpointUrl(provider: ProviderConfig, apiType: ApiType): string | undefined {
    if (apiType === "messages") {
      return provider.baseUrls.messages;
    }
    return provider.baseUrls.chat;
  }

  /**
   * Handles provider errors by triggering appropriate cooldowns
   */
  private handleProviderError(providerName: string, response: Response): void {
    if (!this.cooldownManager) {
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
    this.cooldownManager.setCooldown({
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

  /**
   * Intercept streaming response to extract usage from final snapshot
   * Returns a pass-through stream and a promise that resolves with usage info
   */
  private interceptStreamForUsage(
    originalBody: ReadableStream<Uint8Array> | null,
    clientApiType: ApiType,
    requestContext: RequestContext | undefined,
    requestLogger: any
  ): { stream: ReadableStream<Uint8Array>; usagePromise: Promise<void> } {
    if (!originalBody || !this.usageLogger || !requestContext) {
      // No interception needed
      return {
        stream: originalBody || new ReadableStream(),
        usagePromise: Promise.resolve(),
      };
    }

    const reader = originalBody.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let firstTokenSent = false;
    let finalSnapshot: any = null;
    let chunkCount = 0;

    const usageLogger = this.usageLogger;
    const debugLogger = this.debugLogger;
    const context = requestContext;

    const usagePromise = (async () => {
      try {
        // We'll extract usage after the stream completes
        // This is done in the stream's finally block
      } catch (error) {
        requestLogger.warn("Failed to extract streaming usage", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              // Stream complete - extract usage from final snapshot
              if (finalSnapshot && context) {
                try {
                  let usageInfo: {
                      inputTokens: number;
                      outputTokens: number;
                      cacheReadTokens: number;
                      cacheCreationTokens: number;
                      reasoningTokens: number;
                  } | undefined;
                  
                  const rawUsage = finalSnapshot.usage || finalSnapshot.usageMetadata;
                  if (rawUsage) {
                      const clientTransformer = transformerFactory.getTransformer(clientApiType);
                      const unifiedUsage = clientTransformer.parseUsage(rawUsage);
                      usageInfo = {
                         inputTokens: unifiedUsage.input_tokens,
                         outputTokens: unifiedUsage.output_tokens,
                         cacheReadTokens: unifiedUsage.cache_read_tokens || 0,
                         cacheCreationTokens: unifiedUsage.cache_creation_tokens || 0,
                         reasoningTokens: unifiedUsage.reasoning_tokens || 0
                      };
                  }

                  const responseInfo: ResponseInfo = {
                    success: true,
                    streaming: true,
                    usage: usageInfo,
                  };

                  await usageLogger.logRequest(context, responseInfo);
                } catch (error) {
                  requestLogger.warn("Failed to log streaming usage", {
                    error: error instanceof Error ? error.message : String(error),
                  });
                }
              }

              // Complete debug trace for streaming (Phase 7)
              if (debugLogger?.enabled && finalSnapshot) {
                debugLogger.captureClientResponse(context.id, 200, finalSnapshot);
                await debugLogger.completeTrace(context.id);
              }

              controller.close();
              break;
            }

            // Mark first token time for TTFT
            if (!firstTokenSent && context) {
              usageLogger.markFirstToken(context);
              firstTokenSent = true;
            }

            // Pass through the chunk
            controller.enqueue(value);

            // Parse chunk to look for usage
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || ""; // Keep incomplete line in buffer

            for (const line of lines) {
              const trimmedLine = line.trim();
              if (!trimmedLine || !trimmedLine.startsWith("data: ")) continue;

              if (trimmedLine === "data: [DONE]") continue;

              try {
                const data = JSON.parse(trimmedLine.slice(6));
                
                // Track latest usage
                if (data.usage || data.usageMetadata) {
                  finalSnapshot = data;
                }
              } catch (e) {
                // Ignore parse errors from partial chunks or non-JSON data
              }
            }
          }
        } catch (error) {
          requestLogger.error("Stream interception error", {
            error: error instanceof Error ? error.message : String(error),
          });
          controller.error(error);
        }
      },
    });

    return { stream, usagePromise };
  }
}
