import { UnifiedChatRequest, UnifiedChatResponse, UnifiedTranscriptionRequest, UnifiedTranscriptionResponse, UnifiedSpeechRequest, UnifiedSpeechResponse, UnifiedImageGenerationRequest, UnifiedImageGenerationResponse, UnifiedImageEditRequest, UnifiedImageEditResponse } from "../types/unified";
import { Router } from "./router";
import { TransformerFactory } from "./transformer-factory";
import { logger } from "../utils/logger";
import { CooldownManager } from "./cooldown-manager";
import { RouteResult } from "./router";
import { DebugManager } from "./debug-manager";
import { UsageStorageService } from "./usage-storage";
import { CooldownParserRegistry } from "./cooldown-parsers";
import { getConfig, getProviderTypes } from "../config";
import { getModels } from "@mariozechner/pi-ai";

export class Dispatcher {
  private usageStorage?: UsageStorageService;

  private async recordAttemptMetric(route: RouteResult, requestId: string | undefined, success: boolean): Promise<void> {
    if (!this.usageStorage) return;

    const metricRequestId = requestId || `failover-attempt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (success) {
      await this.usageStorage.recordSuccessfulAttempt(
        route.provider,
        route.model,
        route.canonicalModel ?? null,
        metricRequestId
      );
      return;
    }

    await this.usageStorage.recordFailedAttempt(
      route.provider,
      route.model,
      route.canonicalModel ?? null,
      metricRequestId
    );
  }

  setUsageStorage(storage: UsageStorageService) {
    this.usageStorage = storage;
  }

  async dispatch(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    const config = getConfig();
    const failover = config.failover;
    const failoverEnabled = failover?.enabled !== false;

    // 1. Route (ordered candidates)
    let candidates = await Router.resolveCandidates(request.model, request.incomingApiType);

    // Fallback for direct/provider/model syntax and legacy single-route behavior
    if (candidates.length === 0) {
      const singleRoute = await Router.resolve(request.model, request.incomingApiType);
      candidates = [singleRoute];
    }

    if (candidates.length === 0) {
      throw new Error(`No route candidates found for model '${request.model}'`);
    }

    const targets = failoverEnabled ? candidates : [candidates[0]!];
    const attemptedProviders: string[] = [];
    let lastError: any = null;

    for (let i = 0; i < targets.length; i++) {
      const route = targets[i]!;
      attemptedProviders.push(`${route.provider}/${route.model}`);

      try {
        // Determine Target API Type
        const { targetApiType, selectionReason } = this.selectTargetApiType(
          route,
          request.incomingApiType
        );

        logger.info(
          `Dispatcher: Selected API type '${targetApiType}' for model '${route.model}'. Reason: ${selectionReason}`
        );

        // 2. Get Transformer
        const transformerType = targetApiType;
        const transformer = TransformerFactory.getTransformer(transformerType);

        // 3. Transform Request
        const requestWithTargetModel = { ...request, model: route.model };

        const { payload: providerPayload, bypassTransformation } =
          await this.transformRequestPayload(
            requestWithTargetModel,
            route,
            transformer,
            targetApiType
          );

        // Capture transformed request
        if (request.requestId) {
          DebugManager.getInstance().addTransformedRequest(request.requestId, providerPayload);
        }

        if (this.isOAuthRoute(route, targetApiType)) {
          try {
            const oauthResponse = await this.dispatchOAuthRequest(
              providerPayload,
              request,
              route,
              targetApiType,
              transformer
            );
            await this.recordAttemptMetric(route, request.requestId, true);
            this.attachAttemptMetadata(oauthResponse, attemptedProviders, route);
            return oauthResponse;
          } catch (oauthError: any) {
            lastError = oauthError;
            const canRetry =
              failoverEnabled &&
              i < targets.length - 1 &&
              this.isRetryableOAuthError(oauthError);

            if (canRetry) {
              await this.recordAttemptMetric(route, request.requestId, false);
              CooldownManager.getInstance().markProviderFailure(route.provider, route.model);
              logger.warn(
                `Failover: retrying after OAuth error from ${route.provider}/${route.model}: ${oauthError.message}`
              );
              continue;
            }

            throw oauthError;
          }
        }

        // 4. Execute Request
        const url = this.buildRequestUrl(route, transformer, requestWithTargetModel, targetApiType);
        const headers = this.setupHeaders(route, targetApiType, requestWithTargetModel);
        const incomingApi = request.incomingApiType || "unknown";

        logger.info(
          `Dispatching ${request.model} to ${route.provider}:${route.model} ${incomingApi} <-> ${transformer.name}`
        );

        logger.silly("Upstream Request Payload", providerPayload);

        const response = await this.executeProviderRequest(url, headers, providerPayload);

        if (!response.ok) {
          const errorText = await response.text();
          const canRetry =
            failoverEnabled &&
            i < targets.length - 1 &&
            this.isRetryableStatus(response.status, failover?.retryableStatusCodes || []);

          try {
            await this.handleProviderError(response, route, errorText, url, headers, targetApiType);
          } catch (e: any) {
            lastError = e;

            if (canRetry) {
              await this.recordAttemptMetric(route, request.requestId, false);
              logger.warn(
                `Failover: retrying after HTTP ${response.status} from ${route.provider}/${route.model}`
              );
              continue;
            }

            throw e;
          }
        }

        // 5. Handle Response
        if (request.stream) {
          const streamProbe = await this.probeStreamingStart(response);

          if (!streamProbe.ok) {
            const error = streamProbe.error;
            lastError = error;

            const canRetry =
              failoverEnabled &&
              i < targets.length - 1 &&
              !streamProbe.streamStarted &&
              this.isRetryableNetworkError(error, failover?.retryableErrors || []);

            if (canRetry) {
              await this.recordAttemptMetric(route, request.requestId, false);
              logger.warn(
                `Failover: retrying stream before first byte after ${route.provider}/${route.model} failure: ${error.message}`
              );
              continue;
            }

            throw error;
          }

          const streamResponse = this.handleStreamingResponse(
            streamProbe.response,
            request,
            route,
            targetApiType,
            bypassTransformation
          );
          await this.recordAttemptMetric(route, request.requestId, true);
          this.attachAttemptMetadata(streamResponse, attemptedProviders, route);
          return streamResponse;
        }

        const nonStreamingResponse = await this.handleNonStreamingResponse(
          response,
          request,
          route,
          targetApiType,
          transformer,
          bypassTransformation
        );
        await this.recordAttemptMetric(route, request.requestId, true);
        this.attachAttemptMetadata(nonStreamingResponse, attemptedProviders, route);
        return nonStreamingResponse;
      } catch (error: any) {
        lastError = error;

        CooldownManager.getInstance().markProviderFailure(route.provider, route.model);
        await this.recordAttemptMetric(route, request.requestId, false);

        const canRetryNetwork =
          failoverEnabled &&
          i < targets.length - 1 &&
          this.isRetryableNetworkError(error, failover?.retryableErrors || []);

        if (canRetryNetwork) {
          logger.warn(
            `Failover: retrying after network/transport error from ${route.provider}/${route.model}: ${error.message}`
          );
          continue;
        }

        throw this.buildAllTargetsFailedError(lastError, attemptedProviders);
      }
    }

    throw this.buildAllTargetsFailedError(lastError, attemptedProviders);
  }

  private isRetryableStatus(statusCode: number, retryableStatusCodes: number[]): boolean {
    return retryableStatusCodes.includes(statusCode);
  }

  /**
   * Determines if an OAuth error is retryable.
   * Retryable errors include network issues, rate limiting, and transient failures.
   */
  private isRetryableOAuthError(error: any): boolean {
    if (!error) return false;

    const errorMessage = error.message?.toLowerCase() || '';
    const statusCode = error.status || error.statusCode;

    // Retry on network errors (no status code means network failure)
    if (!statusCode) {
      return true;
    }

    // Retry on 5xx server errors
    if (statusCode >= 500 && statusCode < 600) {
      return true;
    }

    // Retry on 429 rate limiting
    if (statusCode === 429) {
      return true;
    }

    // Retry on specific transient error messages
    const retryablePatterns = [
      'timeout',
      'econnrefused',
      'ECONNREFUSED',
      'etimedout',
      'ETIMEDOUT',
      'network',
      'socket',
      'temporary',
      'unavailable',
      'service unavailable'
    ];

    for (const pattern of retryablePatterns) {
      if (errorMessage.includes(pattern)) {
        return true;
      }
    }

    return false;
  }

  private isRetryableNetworkError(error: any, retryableErrors: string[]): boolean {
    if (!error) return false;
    const code = String(error.code || "").toUpperCase();
    const message = String(error.message || "").toUpperCase();
    return retryableErrors.some((token) => {
      const normalized = token.toUpperCase();
      return code.includes(normalized) || message.includes(normalized);
    });
  }

  private async probeStreamingStart(response: Response): Promise<
    | { ok: true; response: Response }
    | { ok: false; error: Error; streamStarted: boolean }
  > {
    if (!response.body) {
      return { ok: true, response };
    }

    const reader = response.body.getReader();

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<{ timeout: true }>((resolve) => {
      timeoutId = setTimeout(() => resolve({ timeout: true }), 100);
    });

    try {
      const readResult = await Promise.race([reader.read(), timeoutPromise]);

      if ((readResult as any).timeout) {
        const passthrough = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const next = await reader.read();
              if (next.done) {
                controller.close();
              } else {
                controller.enqueue(next.value);
              }
            } catch (error) {
              controller.error(error);
            }
          },
          cancel(reason) {
            return reader.cancel(reason);
          },
        });

        return {
          ok: true,
          response: new Response(passthrough, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          }),
        };
      }

      const first = readResult as ReadableStreamReadResult<Uint8Array>;
      const replay = new ReadableStream<Uint8Array>({
        start(controller) {
          if (!first.done && first.value) {
            controller.enqueue(first.value);
          }
        },
        async pull(controller) {
          try {
            const next = await reader.read();
            if (next.done) {
              controller.close();
            } else {
              controller.enqueue(next.value);
            }
          } catch (error) {
            controller.error(error);
          }
        },
        cancel(reason) {
          return reader.cancel(reason);
        },
      });

      return {
        ok: true,
        response: new Response(replay, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        }),
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error instanceof Error ? error : new Error(String(error)),
        streamStarted: false,
      };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  private attachAttemptMetadata(
    response: any,
    attemptedProviders: string[],
    finalRoute: RouteResult
  ): void {
    response.plexus = {
      ...(response.plexus || {}),
      attemptCount: attemptedProviders.length,
      finalAttemptProvider: finalRoute.provider,
      finalAttemptModel: finalRoute.model,
      allAttemptedProviders: JSON.stringify(attemptedProviders),
    } as any;
  }

  private buildAllTargetsFailedError(lastError: any, attemptedProviders: string[]): Error {
    const summary = attemptedProviders.length > 0 ? attemptedProviders.join(", ") : "none";
    const baseMessage = lastError?.message || "Unknown provider error";
    const enriched = new Error(`All targets failed: ${summary}. Last error: ${baseMessage}`) as any;

    enriched.cause = lastError;
    enriched.routingContext = {
      ...(lastError?.routingContext || {}),
      allAttemptedProviders: attemptedProviders,
      attemptCount: attemptedProviders.length,
      statusCode: lastError?.routingContext?.statusCode || 500,
    };

    return enriched;
  }

  setupHeaders(route: RouteResult, apiType: string, request: UnifiedChatRequest): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Set Accept header based on streaming
    if (request.stream) {
      headers["Accept"] = "text/event-stream";
    } else {
      headers["Accept"] = "application/json";
    }

    // Use static API key
    if (route.config.api_key) {
      const type = apiType.toLowerCase();
      if (type === "messages") {
        headers["x-api-key"] = route.config.api_key;
        headers["anthropic-version"] = "2023-06-01";
      } else if (type === "gemini") {
        headers["x-goog-api-key"] = route.config.api_key;
      } else {
        // Default to Bearer for Chat (OpenAI) and others
        headers["Authorization"] = `Bearer ${route.config.api_key}`;
      }
    } else {
      throw new Error(`No API key configured for provider '${route.provider}'`);
    }

    if (route.config.headers) {
      Object.assign(headers, route.config.headers);
    }
    return headers;
  }

  private getApiMetadata(metadata: Record<string, any>): Record<string, any> {
    return metadata || {};
  }

  /**
   * Extracts provider types using the helper function that infers from api_base_url
   */
  private extractProviderTypes(route: RouteResult): string[] {
    return getProviderTypes(route.config);
  }

  /**
   * Determines which API type to use based on configuration and incoming request type
   * @returns Selected API type and human-readable reason for selection
   */
  private selectTargetApiType(
    route: RouteResult,
    incomingApiType?: string
  ): { targetApiType: string; selectionReason: string } {
    const providerTypes = this.extractProviderTypes(route);

    // Check if model specific access_via is defined
    const modelSpecificTypes = route.modelConfig?.access_via;

    // The available types for this specific routing
    // If model specific types are defined and not empty, use them. Otherwise fallback to provider types.
    const availableTypes =
      modelSpecificTypes && modelSpecificTypes.length > 0
        ? modelSpecificTypes
        : providerTypes;

    let targetApiType = availableTypes[0]; // Default to first one

    if (!targetApiType) {
      throw new Error(
        `No available API type found for provider '${route.provider}' and model '${route.model}'. Check configuration.`
      );
    }
    let selectionReason = "default (first available)";

    // Try to match incoming
    if (incomingApiType) {
      const incoming = incomingApiType.toLowerCase();
      // Case-insensitive match
      const match = availableTypes.find((t: string) => t.toLowerCase() === incoming);
      if (match) {
        targetApiType = match;
        selectionReason = `matched incoming request type '${incoming}'`;
      } else {
        selectionReason = `incoming type '${incoming}' not supported, defaulted to '${targetApiType}'`;
      }
    }

    return { targetApiType, selectionReason };
  }

  /**
   * Resolves the provider base URL from configuration, handling both string and record formats
   * @returns Normalized base URL without trailing slash
   */
  private resolveBaseUrl(route: RouteResult, targetApiType: string): string {
    let rawBaseUrl: string;

    if (typeof route.config.api_base_url === "string") {
      rawBaseUrl = route.config.api_base_url;
    } else {
      // It's a record/map
      const typeKey = targetApiType.toLowerCase();
      // Check exact match first, then fallback to just looking for keys that might match?
      // Actually the config keys should probably match the api types (chat, messages, etc)
      const specificUrl = route.config.api_base_url[typeKey];
      const defaultUrl = route.config.api_base_url["default"];

      if (specificUrl) {
        rawBaseUrl = specificUrl;
        logger.debug(`Dispatcher: Using specific base URL for '${targetApiType}'.`);
      } else if (defaultUrl) {
        rawBaseUrl = defaultUrl;
        logger.debug(`Dispatcher: Using default base URL.`);
      } else {
        // If we can't find a specific URL for this type, and no default, fall back to the first one?
        // Or throw error.
        const firstKey = Object.keys(route.config.api_base_url)[0];

        if (firstKey) {
          const firstUrl = route.config.api_base_url[firstKey];
          if (firstUrl) {
            rawBaseUrl = firstUrl;
            logger.warn(
              `No specific base URL found for api type '${targetApiType}'. using '${firstKey}' as fallback.`
            );
          } else {
            throw new Error(
              `No base URL configured for api type '${targetApiType}' and no default found.`
            );
          }
        } else {
          throw new Error(
            `No base URL configured for api type '${targetApiType}' and no default found.`
          );
        }
      }
    }

    // Ensure api_base_url doesn't end with slash
    return rawBaseUrl.replace(/\/$/, "");
  }

  private isOAuthRoute(route: RouteResult, targetApiType: string): boolean {
    if (targetApiType.toLowerCase() === 'oauth') return true;
    if (typeof route.config.api_base_url === 'string') {
      return route.config.api_base_url.startsWith('oauth://');
    }
    const urlMap = route.config.api_base_url as Record<string, string>;
    return Object.values(urlMap).some((value) => value.startsWith('oauth://'));
  }

  private isAsyncIterable<T>(input: any): input is AsyncIterable<T> {
    return input && typeof input[Symbol.asyncIterator] === 'function';
  }

  private isReadableStream<T>(input: any): input is ReadableStream<T> {
    return !!input && typeof input.getReader === 'function';
  }

  private describeStreamResult(result: any): Record<string, any> {
    return {
      isPromise: !!result && typeof result.then === 'function',
      isAsyncIterable: this.isAsyncIterable(result),
      isReadableStream: this.isReadableStream(result),
      hasIterator: !!result && typeof result[Symbol.asyncIterator] === 'function',
      hasGetReader: !!result && typeof result.getReader === 'function',
      constructorName: result?.constructor?.name || typeof result
    };
  }

  private streamFromAsyncIterable<T>(iterable: AsyncIterable<T>): ReadableStream<T> {
    const iterator = iterable[Symbol.asyncIterator]();
    let closed = false;
    let reading = false;

    return new ReadableStream<T>({
      async pull(controller) {
        if (closed || reading) return;
        reading = true;
        try {
          const { value, done } = await iterator.next();
          if (done) {
            closed = true;
            controller.close();
          } else if (!closed) {
            controller.enqueue(value);
          }
        } catch (error) {
          if (!closed) {
            logger.error('OAuth: Stream pull failed', error as Error);
            closed = true;
            controller.error(error);
          }
        } finally {
          reading = false;
        }
      },
      async cancel(reason) {
        closed = true;
        await iterator.return?.(reason);
      }
    });
  }

  private async dispatchOAuthRequest(
    context: any,
    request: UnifiedChatRequest,
    route: RouteResult,
    targetApiType: string,
    transformer: any
  ): Promise<UnifiedChatResponse> {
    if (!transformer.executeRequest) {
      throw new Error('OAuth transformer missing executeRequest()');
    }

    try {
      const oauthProvider = route.config.oauth_provider || route.provider;
      const oauthAccount = route.config.oauth_account?.trim();
      if (!oauthAccount) {
        throw new Error(
          `OAuth account is not configured for provider '${route.provider}'. ` +
            `Set providers.${route.provider}.oauth_account in plexus config.`
        );
      }

      this.assertOAuthModelSupported(oauthProvider, route.model);
      const oauthContext = context?.context ? context.context : context;
      const oauthOptions = context?.options;

      logger.debug('OAuth: Dispatching request', {
        routeProvider: route.provider,
        oauthProvider,
        oauthAccount,
        model: route.model,
        targetApiType,
        streaming: !!request.stream,
        hasOptions: !!oauthOptions
      });

      if (!oauthContext.systemPrompt) {
        oauthContext.systemPrompt = this.resolveOAuthInstructions(request, oauthProvider) || oauthContext.systemPrompt;
      }
      const result = await transformer.executeRequest(
        oauthContext,
        oauthProvider,
        oauthAccount,
        route.model,
        !!request.stream,
        oauthOptions
      );

      if (request.stream) {
        let rawStream: ReadableStream<any>;

        if (this.isReadableStream(result)) {
          rawStream = result;
        } else if (this.isAsyncIterable(result)) {
          rawStream = this.streamFromAsyncIterable(result);
        } else {
          throw new Error('OAuth provider returned an unsupported stream type');
        }
        logger.debug('OAuth: Normalized stream result', this.describeStreamResult(result));
        const streamResponse: UnifiedChatResponse = {
          id: 'stream-' + Date.now(),
          model: request.model,
          content: null,
          stream: rawStream,
          bypassTransformation: false
        };

        this.enrichResponseWithMetadata(streamResponse, route, targetApiType);
        return streamResponse;
      }

      const unified = await transformer.transformResponse(result);
      this.enrichResponseWithMetadata(unified, route, targetApiType);
      return unified;
    } catch (error: any) {
      throw this.wrapOAuthError(error, route, targetApiType);
    }
  }

  private assertOAuthModelSupported(oauthProvider: string, modelId: string) {
    const supportedModels = getModels(oauthProvider as any);
    if (!supportedModels || supportedModels.length === 0) {
      throw new Error(`OAuth provider '${oauthProvider}' has no known models.`);
    }

    const isSupported = supportedModels.some((model) => model.id === modelId);
    if (!isSupported) {
      const modelList = supportedModels.map((model) => model.id).sort().join(", ");
      throw new Error(
        `OAuth model '${modelId}' is not supported for provider '${oauthProvider}'. ` +
          `Supported models: ${modelList}`
      );
    }
  }

  private wrapOAuthError(error: Error, route: RouteResult, targetApiType: string): Error {
    const message = error?.message || 'OAuth provider error';
    let statusCode = 500;

    if (message.includes('Not authenticated') || message.includes('re-authenticate') || message.includes('expired')) {
      statusCode = 401;
    } else if (message.toLowerCase().includes('model') && message.toLowerCase().includes('not')) {
      statusCode = 400;
    }

    const enriched = new Error(message) as any;
    enriched.routingContext = {
      provider: route.provider,
      oauthProvider: route.config.oauth_provider || route.provider,
      oauthAccount: route.config.oauth_account,
      targetModel: route.model,
      targetApiType,
      statusCode
    };

    return enriched;
  }

  private resolveOAuthInstructions(
    request: UnifiedChatRequest,
    oauthProvider: string
  ): string | undefined {
    const requestInstructions = request.originalBody?.instructions;
    if (typeof requestInstructions === 'string' && requestInstructions.trim()) {
      return requestInstructions;
    }

    const systemMessage = request.messages.find((msg) => msg.role === 'system');
    const developerMessage = (request.messages as any[]).find((msg) => msg.role === 'developer');
    const instructionSource = systemMessage || developerMessage;
    const instructionContent = instructionSource?.content;
    if (typeof instructionContent === 'string' && instructionContent.trim()) {
      return instructionContent;
    }

    if (oauthProvider === 'openai-codex') {
      logger.info("OAuth: Inserted default instructions for openai-codex");
      return 'You are a helpful coding assistant.';
    }

    return undefined;
  }

  /**
   * Determines if pass-through optimization should be used
   */
  private shouldUsePassThrough(
    request: UnifiedChatRequest,
    targetApiType: string,
    route: RouteResult
  ): boolean {
    const isCompatible =
      !!request.incomingApiType?.toLowerCase() &&
      request.incomingApiType?.toLowerCase() === targetApiType.toLowerCase();

    return isCompatible && !!request.originalBody;
  }

  /**
   * Transforms the request payload or uses pass-through optimization
   * @returns Transformed payload and bypass flag
   */
  private async transformRequestPayload(
    request: UnifiedChatRequest,
    route: RouteResult,
    transformer: any,
    targetApiType: string
  ): Promise<{ payload: any; bypassTransformation: boolean }> {
    let providerPayload: any;
    let bypassTransformation = false;

    if (this.shouldUsePassThrough(request, targetApiType, route)) {
      logger.info(
        `Pass-through optimization active: ${request.incomingApiType} -> ${targetApiType}`
      );
      providerPayload = JSON.parse(JSON.stringify(request.originalBody));
      providerPayload.model = route.model;

      // Add metadata from request
      if (request.metadata) {
        const apiMetadata = this.getApiMetadata(request.metadata);
        if (Object.keys(apiMetadata).length > 0) {
          providerPayload.metadata = apiMetadata;
        }
      }

      bypassTransformation = true;
    } else {
      providerPayload = await transformer.transformRequest(request);
    }

    if (route.config.extraBody) {
      providerPayload = { ...providerPayload, ...route.config.extraBody };
    }

    return { payload: providerPayload, bypassTransformation };
  }

  /**
   * Constructs the full provider request URL
   */
  private buildRequestUrl(
    route: RouteResult,
    transformer: any,
    request: UnifiedChatRequest,
    targetApiType: string
  ): string {
    const baseUrl = this.resolveBaseUrl(route, targetApiType);
    const endpoint = transformer.getEndpoint
      ? transformer.getEndpoint(request)
      : transformer.defaultEndpoint;
    return `${baseUrl}${endpoint}`;
  }

  /**
   * Executes the HTTP POST request to the provider
   */
  private async executeProviderRequest(
    url: string,
    headers: Record<string, string>,
    payload: any
  ): Promise<Response> {
    return await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  }

  /**
   * Handles failed provider responses with cooldown logic
   */
  private async handleProviderError(
    response: Response,
    route: RouteResult,
    errorText: string,
    url?: string,
    headers?: Record<string, string>,
    targetApiType?: string
  ): Promise<never> {
    logger.error(`Provider error: ${response.status} ${errorText}`);

    const cooldownManager = CooldownManager.getInstance();

    if (response.status >= 500 || [401, 403, 408, 429].includes(response.status)) {
      let cooldownDuration: number | undefined;

      // For 429 errors, try to parse provider-specific cooldown duration
      if (response.status === 429) {
        // Get provider type for parser lookup
        const providerTypes = this.extractProviderTypes(route);
        const providerType = providerTypes[0];

        // Try to parse cooldown duration from error message
        if (providerType) {
          const parsedDuration = CooldownParserRegistry.parseCooldown(
            providerType,
            errorText
          );

          if (parsedDuration) {
            cooldownDuration = parsedDuration;
            logger.info(
              `Parsed cooldown duration: ${cooldownDuration}ms (${cooldownDuration / 1000}s)`
            );
          } else {
            logger.debug(`No cooldown duration parsed from error, using default`);
          }
        }
      }

      // Mark provider+model as failed with optional duration
      // For non-429 errors, cooldownDuration will be undefined and default (10 minutes) will be used
      cooldownManager.markProviderFailure(route.provider, route.model, cooldownDuration);
    }

    // Create enriched error with routing context
    const error = new Error(`Provider failed: ${response.status} ${errorText}`) as any;
    error.routingContext = {
      provider: route.provider,
      targetModel: route.model,
      targetApiType: targetApiType,
      url: url,
      headers: this.sanitizeHeaders(headers || {}),
      statusCode: response.status,
      providerResponse: errorText
    };

    throw error;
  }

  /**
   * Sanitize headers to remove sensitive information before logging
   */
  private sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    const sanitized = { ...headers };

    // Mask sensitive headers
    if (sanitized['x-api-key']) {
      sanitized['x-api-key'] = this.maskSecret(sanitized['x-api-key']);
    }
    if (sanitized['Authorization']) {
      sanitized['Authorization'] = this.maskSecret(sanitized['Authorization']);
    }
    if (sanitized['x-goog-api-key']) {
      sanitized['x-goog-api-key'] = this.maskSecret(sanitized['x-goog-api-key']);
    }

    return sanitized;
  }

  /**
   * Mask secret values, showing only first and last few characters
   */
  private maskSecret(value: string): string {
    if (value.length <= 8) return '***';

    // For Bearer tokens, preserve the "Bearer " prefix
    if (value.startsWith('Bearer ')) {
      const token = value.substring(7);
      if (token.length <= 8) return 'Bearer ***';
      return `Bearer ${token.substring(0, 4)}...${token.substring(token.length - 4)}`;
    }

    return `${value.substring(0, 4)}...${value.substring(value.length - 4)}`;
  }

  /**
   * Enriches response with Plexus metadata
   */
  private enrichResponseWithMetadata(
    response: UnifiedChatResponse,
    route: RouteResult,
    targetApiType: string
  ): void {
    response.plexus = {
      provider: route.provider,
      model: route.model,
      apiType: targetApiType,
      pricing: route.modelConfig?.pricing,
      providerDiscount: route.config.discount,
      canonicalModel: route.canonicalModel,
      config: route.config,
    };
  }

  /**
   * Handles streaming responses
   */
  private handleStreamingResponse(
    response: Response,
    request: UnifiedChatRequest,
    route: RouteResult,
    targetApiType: string,
    bypassTransformation: boolean
  ): UnifiedChatResponse {
    logger.info("Streaming response detected");

    const rawStream = response.body!;

    const streamResponse: UnifiedChatResponse = {
      id: "stream-" + Date.now(),
      model: request.model,
      content: null,
      stream: rawStream,
      bypassTransformation: bypassTransformation,
    };

    this.enrichResponseWithMetadata(streamResponse, route, targetApiType);

    return streamResponse;
  }

  /**
   * Handles non-streaming responses
   */
  private async handleNonStreamingResponse(
    response: Response,
    request: UnifiedChatRequest,
    route: RouteResult,
    targetApiType: string,
    transformer: any,
    bypassTransformation: boolean
  ): Promise<UnifiedChatResponse> {
    const responseBody = JSON.parse(await response.text());
    logger.silly("Upstream Response Payload", responseBody);

    if (request.requestId) {
      DebugManager.getInstance().addRawResponse(request.requestId, responseBody);
    }

    let unifiedResponse: UnifiedChatResponse;

    if (bypassTransformation) {
      // We still need unified response for usage stats, so we transform purely for that
      // But we set the bypass flag and attach raw response
      const syntheticResponse = await transformer.transformResponse(responseBody);
      unifiedResponse = {
        ...syntheticResponse,
        bypassTransformation: true,
        rawResponse: responseBody,
      };
    } else {
      unifiedResponse = await transformer.transformResponse(responseBody);
    }

    this.enrichResponseWithMetadata(unifiedResponse, route, targetApiType);

    return unifiedResponse;
  }

  /**
   * Dispatch embeddings request to provider
   * Simplified version of dispatch() since embeddings:
   * - Don't support streaming
   * - Use universal API format (no transformation needed)
   * - Always use /embeddings endpoint
   */
  async dispatchEmbeddings(request: any): Promise<any> {
    const config = getConfig();
    const failover = config.failover;
    const failoverEnabled = failover?.enabled !== false;

    let candidates = await Router.resolveCandidates(request.model, 'embeddings');
    if (candidates.length === 0) {
      const singleRoute = await Router.resolve(request.model, 'embeddings');
      candidates = [singleRoute];
    }

    const targets = failoverEnabled ? candidates : [candidates[0]!];
    const attemptedProviders: string[] = [];
    let lastError: any = null;

    for (let i = 0; i < targets.length; i++) {
      const route = targets[i]!;
      attemptedProviders.push(`${route.provider}/${route.model}`);

      try {
        const baseUrl = this.resolveBaseUrl(route, 'embeddings');
        const url = `${baseUrl}/embeddings`;

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "Accept": "application/json",
        };

        if (route.config.api_key) {
          headers["Authorization"] = `Bearer ${route.config.api_key}`;
        }

        if (route.config.headers) {
          Object.assign(headers, route.config.headers);
        }

        const payload = {
          ...request.originalBody,
          model: route.model
        };

        if (route.config.extraBody) {
          Object.assign(payload, route.config.extraBody);
        }

        logger.info(`Dispatching embeddings ${request.model} to ${route.provider}:${route.model}`);
        logger.silly("Embeddings Request Payload", payload);

        if (request.requestId) {
          DebugManager.getInstance().addTransformedRequest(request.requestId, payload);
        }

        const response = await this.executeProviderRequest(url, headers, payload);

        if (!response.ok) {
          const errorText = await response.text();
          const canRetry =
            failoverEnabled &&
            i < targets.length - 1 &&
            this.isRetryableStatus(response.status, failover?.retryableStatusCodes || []);

          try {
            await this.handleProviderError(response, route, errorText, url, headers, 'embeddings');
          } catch (e: any) {
            lastError = e;
            if (canRetry) {
              await this.recordAttemptMetric(route, request.requestId, false);
              logger.warn(
                `Failover: retrying embeddings after HTTP ${response.status} from ${route.provider}/${route.model}`
              );
              continue;
            }
            throw e;
          }
        }

        const responseBody = await response.json();
        logger.silly("Embeddings Response Payload", responseBody);

        if (request.requestId) {
          DebugManager.getInstance().addRawResponse(request.requestId, responseBody);
        }

        const enrichedResponse: any = {
          ...responseBody,
          plexus: {
            provider: route.provider,
            model: route.model,
            apiType: 'embeddings',
            pricing: route.modelConfig?.pricing,
            providerDiscount: route.config.discount,
            canonicalModel: route.canonicalModel,
            config: route.config,
          }
        };

        await this.recordAttemptMetric(route, request.requestId, true);
        this.attachAttemptMetadata(enrichedResponse, attemptedProviders, route);
        return enrichedResponse;
      } catch (error: any) {
        lastError = error;
        CooldownManager.getInstance().markProviderFailure(route.provider, route.model);
        await this.recordAttemptMetric(route, request.requestId, false);

        const canRetryNetwork =
          failoverEnabled &&
          i < targets.length - 1 &&
          this.isRetryableNetworkError(error, failover?.retryableErrors || []);

        if (canRetryNetwork) {
          logger.warn(
            `Failover: retrying embeddings after network/transport error from ${route.provider}/${route.model}: ${error.message}`
          );
          continue;
        }

        throw this.buildAllTargetsFailedError(lastError, attemptedProviders);
      }
    }

    throw this.buildAllTargetsFailedError(lastError, attemptedProviders);
  }

  /**
   * Dispatches audio transcription requests
   * Handles multipart/form-data file uploads to OpenAI-compatible transcription endpoints
   */
  async dispatchTranscription(request: UnifiedTranscriptionRequest): Promise<UnifiedTranscriptionResponse> {
    const { TranscriptionsTransformer } = await import('../transformers/transcriptions');
    const transformer = new TranscriptionsTransformer();

    const config = getConfig();
    const failover = config.failover;
    const failoverEnabled = failover?.enabled !== false;

    let candidates = await Router.resolveCandidates(request.model, 'transcriptions');
    if (candidates.length === 0) {
      const singleRoute = await Router.resolve(request.model, 'transcriptions');
      candidates = [singleRoute];
    }

    const targets = failoverEnabled ? candidates : [candidates[0]!];
    const attemptedProviders: string[] = [];
    let lastError: any = null;

    for (let i = 0; i < targets.length; i++) {
      const route = targets[i]!;
      attemptedProviders.push(`${route.provider}/${route.model}`);

      try {
        const baseUrl = this.resolveBaseUrl(route, 'transcriptions');
        const url = `${baseUrl}/audio/transcriptions`;

        const headers: Record<string, string> = {};

        if (route.config.api_key) {
          headers["Authorization"] = `Bearer ${route.config.api_key}`;
        }

        if (route.config.headers) {
          Object.assign(headers, route.config.headers);
        }

        const formData = await transformer.transformRequest({
          ...request,
          model: route.model,
        });

        logger.info(`Dispatching transcription ${request.model} to ${route.provider}:${route.model}`);
        logger.silly("Transcription Request", { model: request.model, filename: request.filename });

        if (request.requestId) {
          DebugManager.getInstance().addTransformedRequest(request.requestId, {
            model: request.model,
            filename: request.filename,
            mimeType: request.mimeType,
            language: request.language,
            prompt: request.prompt,
            response_format: request.response_format,
            temperature: request.temperature,
          });
        }

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: formData
        });

        if (!response.ok) {
          const errorText = await response.text();
          const canRetry =
            failoverEnabled &&
            i < targets.length - 1 &&
            this.isRetryableStatus(response.status, failover?.retryableStatusCodes || []);

          try {
            await this.handleProviderError(response, route, errorText, url, headers, 'transcriptions');
          } catch (e: any) {
            lastError = e;
            if (canRetry) {
              await this.recordAttemptMetric(route, request.requestId, false);
              logger.warn(
                `Failover: retrying transcription after HTTP ${response.status} from ${route.provider}/${route.model}`
              );
              continue;
            }
            throw e;
          }
        }

        const responseFormat = request.response_format || 'json';
        let responseBody: any;

        if (responseFormat === 'text') {
          responseBody = await response.text();
        } else {
          responseBody = await response.json();
        }

        logger.silly("Transcription Response", responseBody);

        if (request.requestId) {
          DebugManager.getInstance().addRawResponse(request.requestId, responseBody);
        }

        const unifiedResponse = await transformer.transformResponse(responseBody, responseFormat);

        unifiedResponse.plexus = {
          provider: route.provider,
          model: route.model,
          apiType: 'transcriptions',
          pricing: route.modelConfig?.pricing,
          providerDiscount: route.config.discount,
          canonicalModel: route.canonicalModel,
          config: route.config,
        };

        await this.recordAttemptMetric(route, request.requestId, true);
        this.attachAttemptMetadata(unifiedResponse, attemptedProviders, route);
        return unifiedResponse;
      } catch (error: any) {
        lastError = error;
        CooldownManager.getInstance().markProviderFailure(route.provider, route.model);
        await this.recordAttemptMetric(route, request.requestId, false);

        const canRetryNetwork =
          failoverEnabled &&
          i < targets.length - 1 &&
          this.isRetryableNetworkError(error, failover?.retryableErrors || []);

        if (canRetryNetwork) {
          logger.warn(
            `Failover: retrying transcription after network/transport error from ${route.provider}/${route.model}: ${error.message}`
          );
          continue;
        }

        throw this.buildAllTargetsFailedError(lastError, attemptedProviders);
      }
    }

    throw this.buildAllTargetsFailedError(lastError, attemptedProviders);
  }

  /**
   * Dispatches text-to-speech requests
   * Handles JSON body requests to OpenAI-compatible speech endpoints
   * Supports both binary audio responses and SSE streaming
   */
  async dispatchSpeech(request: UnifiedSpeechRequest): Promise<UnifiedSpeechResponse> {
    const { SpeechTransformer } = await import('../transformers/speech');
    const transformer = new SpeechTransformer();

    const config = getConfig();
    const failover = config.failover;
    const failoverEnabled = failover?.enabled !== false;

    let candidates = await Router.resolveCandidates(request.model, 'speech');
    if (candidates.length === 0) {
      const singleRoute = await Router.resolve(request.model, 'speech');
      candidates = [singleRoute];
    }

    const targets = failoverEnabled ? candidates : [candidates[0]!];
    const attemptedProviders: string[] = [];
    let lastError: any = null;

    for (let i = 0; i < targets.length; i++) {
      const route = targets[i]!;
      attemptedProviders.push(`${route.provider}/${route.model}`);

      try {
        const baseUrl = this.resolveBaseUrl(route, 'speech');
        const url = `${baseUrl}/audio/speech`;

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };

        if (route.config.api_key) {
          headers["Authorization"] = `Bearer ${route.config.api_key}`;
        }

        if (route.config.headers) {
          Object.assign(headers, route.config.headers);
        }

        const payload = await transformer.transformRequest({
          ...request,
          model: route.model,
        });

        if (route.config.extraBody) {
          Object.assign(payload, route.config.extraBody);
        }

        logger.info(`Dispatching speech ${request.model} to ${route.provider}:${route.model}`);
        logger.silly("Speech Request Payload", payload);

        if (request.requestId) {
          DebugManager.getInstance().addTransformedRequest(request.requestId, payload);
        }

        const isStreamed = request.stream_format === 'sse';
        const acceptHeader = isStreamed ? 'text/event-stream' : 'audio/*';
        headers["Accept"] = acceptHeader;

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorText = await response.text();
          const canRetry =
            failoverEnabled &&
            i < targets.length - 1 &&
            this.isRetryableStatus(response.status, failover?.retryableStatusCodes || []);

          try {
            await this.handleProviderError(response, route, errorText, url, headers, 'speech');
          } catch (e: any) {
            lastError = e;
            if (canRetry) {
              await this.recordAttemptMetric(route, request.requestId, false);
              logger.warn(
                `Failover: retrying speech after HTTP ${response.status} from ${route.provider}/${route.model}`
              );
              continue;
            }
            throw e;
          }
        }

        let responseForProcessing = response;
        if (isStreamed) {
          const streamProbe = await this.probeStreamingStart(response);

          if (!streamProbe.ok) {
            const error = streamProbe.error;
            lastError = error;

            const canRetry =
              failoverEnabled &&
              i < targets.length - 1 &&
              !streamProbe.streamStarted &&
              this.isRetryableNetworkError(error, failover?.retryableErrors || []);

            if (canRetry) {
              await this.recordAttemptMetric(route, request.requestId, false);
              logger.warn(
                `Failover: retrying speech stream before first byte after ${route.provider}/${route.model} failure: ${error.message}`
              );
              continue;
            }

            throw error;
          }

          responseForProcessing = streamProbe.response;
        }

        const responseBuffer = Buffer.from(await responseForProcessing.arrayBuffer());
        logger.silly("Speech Response", { size: responseBuffer.length, isStreamed });

        if (request.requestId) {
          DebugManager.getInstance().addRawResponse(request.requestId, { size: responseBuffer.length, isStreamed });
        }

        const unifiedResponse = await transformer.transformResponse(responseBuffer, {
          stream_format: request.stream_format,
          response_format: request.response_format,
        });

        unifiedResponse.plexus = {
          provider: route.provider,
          model: route.model,
          apiType: 'speech',
          pricing: route.modelConfig?.pricing,
          providerDiscount: route.config.discount,
          canonicalModel: route.canonicalModel,
          config: route.config,
        };

        await this.recordAttemptMetric(route, request.requestId, true);
        this.attachAttemptMetadata(unifiedResponse, attemptedProviders, route);
        return unifiedResponse;
      } catch (error: any) {
        lastError = error;
        CooldownManager.getInstance().markProviderFailure(route.provider, route.model);
        await this.recordAttemptMetric(route, request.requestId, false);

        const canRetryNetwork =
          failoverEnabled &&
          i < targets.length - 1 &&
          this.isRetryableNetworkError(error, failover?.retryableErrors || []);

        if (canRetryNetwork) {
          logger.warn(
            `Failover: retrying speech after network/transport error from ${route.provider}/${route.model}: ${error.message}`
          );
          continue;
        }

        throw this.buildAllTargetsFailedError(lastError, attemptedProviders);
      }
    }

    throw this.buildAllTargetsFailedError(lastError, attemptedProviders);
  }

  /**
   * Dispatches image generation requests
   * Handles JSON body requests to OpenAI-compatible image generation endpoints
   */
  async dispatchImageGenerations(request: UnifiedImageGenerationRequest): Promise<UnifiedImageGenerationResponse> {
    const { ImageTransformer } = await import('../transformers/image');
    const transformer = new ImageTransformer();

    const config = getConfig();
    const failover = config.failover;
    const failoverEnabled = failover?.enabled !== false;

    let candidates = await Router.resolveCandidates(request.model, 'images');
    if (candidates.length === 0) {
      const singleRoute = await Router.resolve(request.model, 'images');
      candidates = [singleRoute];
    }

    const targets = failoverEnabled ? candidates : [candidates[0]!];
    const attemptedProviders: string[] = [];
    let lastError: any = null;

    for (let i = 0; i < targets.length; i++) {
      const route = targets[i]!;
      attemptedProviders.push(`${route.provider}/${route.model}`);

      try {
        const baseUrl = this.resolveBaseUrl(route, 'images');
        const url = `${baseUrl}/images/generations`;

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "Accept": "application/json",
        };

        if (route.config.api_key) {
          headers["Authorization"] = `Bearer ${route.config.api_key}`;
        }

        if (route.config.headers) {
          Object.assign(headers, route.config.headers);
        }

        const payload = await transformer.transformGenerationRequest({
          ...request,
          model: route.model,
        });

        if (route.config.extraBody) {
          Object.assign(payload, route.config.extraBody);
        }

        logger.info(`Dispatching image generation ${request.model} to ${route.provider}:${route.model}`);
        logger.silly("Image Generation Request Payload", payload);

        if (request.requestId) {
          DebugManager.getInstance().addTransformedRequest(request.requestId, payload);
        }

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorText = await response.text();
          const canRetry =
            failoverEnabled &&
            i < targets.length - 1 &&
            this.isRetryableStatus(response.status, failover?.retryableStatusCodes || []);

          try {
            await this.handleProviderError(response, route, errorText, url, headers, 'images');
          } catch (e: any) {
            lastError = e;
            if (canRetry) {
              await this.recordAttemptMetric(route, request.requestId, false);
              logger.warn(
                `Failover: retrying image generation after HTTP ${response.status} from ${route.provider}/${route.model}`
              );
              continue;
            }
            throw e;
          }
        }

        const responseBody = await response.json();
        logger.silly("Image Generation Response", responseBody);

        if (request.requestId) {
          DebugManager.getInstance().addRawResponse(request.requestId, responseBody);
        }

        const unifiedResponse = await transformer.transformGenerationResponse(responseBody);

        unifiedResponse.plexus = {
          provider: route.provider,
          model: route.model,
          apiType: 'images',
          pricing: route.modelConfig?.pricing,
          providerDiscount: route.config.discount,
          canonicalModel: route.canonicalModel,
          config: route.config,
        };

        await this.recordAttemptMetric(route, request.requestId, true);
        this.attachAttemptMetadata(unifiedResponse, attemptedProviders, route);
        return unifiedResponse;
      } catch (error: any) {
        lastError = error;
        CooldownManager.getInstance().markProviderFailure(route.provider, route.model);
        await this.recordAttemptMetric(route, request.requestId, false);

        const canRetryNetwork =
          failoverEnabled &&
          i < targets.length - 1 &&
          this.isRetryableNetworkError(error, failover?.retryableErrors || []);

        if (canRetryNetwork) {
          logger.warn(
            `Failover: retrying image generation after network/transport error from ${route.provider}/${route.model}: ${error.message}`
          );
          continue;
        }

        throw this.buildAllTargetsFailedError(lastError, attemptedProviders);
      }
    }

    throw this.buildAllTargetsFailedError(lastError, attemptedProviders);
  }

  /**
   * Dispatches image editing requests
   * Handles multipart/form-data requests to OpenAI-compatible image editing endpoints
   * Supports single image upload with optional mask
   */
  async dispatchImageEdits(request: UnifiedImageEditRequest): Promise<UnifiedImageEditResponse> {
    const { ImageTransformer } = await import('../transformers/image');
    const transformer = new ImageTransformer();

    const config = getConfig();
    const failover = config.failover;
    const failoverEnabled = failover?.enabled !== false;

    let candidates = await Router.resolveCandidates(request.model, 'images');
    if (candidates.length === 0) {
      const singleRoute = await Router.resolve(request.model, 'images');
      candidates = [singleRoute];
    }

    const targets = failoverEnabled ? candidates : [candidates[0]!];
    const attemptedProviders: string[] = [];
    let lastError: any = null;

    for (let i = 0; i < targets.length; i++) {
      const route = targets[i]!;
      attemptedProviders.push(`${route.provider}/${route.model}`);

      try {
        const baseUrl = this.resolveBaseUrl(route, 'images');
        const url = `${baseUrl}/images/edits`;

        const headers: Record<string, string> = {};

        if (route.config.api_key) {
          headers["Authorization"] = `Bearer ${route.config.api_key}`;
        }

        if (route.config.headers) {
          Object.assign(headers, route.config.headers);
        }

        const formData = await transformer.transformEditRequest({
          ...request,
          model: route.model,
        });

        logger.info(`Dispatching image edit ${request.model} to ${route.provider}:${route.model}`);
        logger.silly("Image Edit Request", { model: request.model, filename: request.filename, hasMask: !!request.mask });

        if (request.requestId) {
          DebugManager.getInstance().addTransformedRequest(request.requestId, {
            model: request.model,
            filename: request.filename,
            hasMask: !!request.mask,
          });
        }

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: formData,
        });

        if (!response.ok) {
          const errorText = await response.text();
          const canRetry =
            failoverEnabled &&
            i < targets.length - 1 &&
            this.isRetryableStatus(response.status, failover?.retryableStatusCodes || []);

          try {
            await this.handleProviderError(response, route, errorText, url, headers, 'images');
          } catch (e: any) {
            lastError = e;
            if (canRetry) {
              await this.recordAttemptMetric(route, request.requestId, false);
              logger.warn(
                `Failover: retrying image edit after HTTP ${response.status} from ${route.provider}/${route.model}`
              );
              continue;
            }
            throw e;
          }
        }

        const responseBody = await response.json();
        logger.silly("Image Edit Response", responseBody);

        if (request.requestId) {
          DebugManager.getInstance().addRawResponse(request.requestId, responseBody);
        }

        const unifiedResponse = await transformer.transformEditResponse(responseBody);

        unifiedResponse.plexus = {
          provider: route.provider,
          model: route.model,
          apiType: 'images',
          pricing: route.modelConfig?.pricing,
          providerDiscount: route.config.discount,
          canonicalModel: route.canonicalModel,
          config: route.config,
        };

        await this.recordAttemptMetric(route, request.requestId, true);
        this.attachAttemptMetadata(unifiedResponse, attemptedProviders, route);
        return unifiedResponse;
      } catch (error: any) {
        lastError = error;
        CooldownManager.getInstance().markProviderFailure(route.provider, route.model);
        await this.recordAttemptMetric(route, request.requestId, false);

        const canRetryNetwork =
          failoverEnabled &&
          i < targets.length - 1 &&
          this.isRetryableNetworkError(error, failover?.retryableErrors || []);

        if (canRetryNetwork) {
          logger.warn(
            `Failover: retrying image edit after network/transport error from ${route.provider}/${route.model}: ${error.message}`
          );
          continue;
        }

        throw this.buildAllTargetsFailedError(lastError, attemptedProviders);
      }
    }

    throw this.buildAllTargetsFailedError(lastError, attemptedProviders);
  }
}
