import { UnifiedChatRequest, UnifiedChatResponse, UnifiedTranscriptionRequest, UnifiedTranscriptionResponse, UnifiedSpeechRequest, UnifiedSpeechResponse, UnifiedImageGenerationRequest, UnifiedImageGenerationResponse, UnifiedImageEditRequest, UnifiedImageEditResponse } from "../types/unified";
import { Router } from "./router";
import { TransformerFactory } from "./transformer-factory";
import { logger } from "../utils/logger";
import { CooldownManager } from "./cooldown-manager";
import { RouteResult } from "./router";
import { DebugManager } from "./debug-manager";
import { UsageStorageService } from "./usage-storage";
import { CooldownParserRegistry } from "./cooldown-parsers";
import { getProviderTypes } from "../config";

export class Dispatcher {
  private usageStorage?: UsageStorageService;

  setUsageStorage(storage: UsageStorageService) {
    this.usageStorage = storage;
  }
  async dispatch(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    // 1. Route
    const route = await Router.resolve(request.model, request.incomingApiType);

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
      return await this.dispatchOAuthRequest(
        providerPayload,
        request,
        route,
        targetApiType,
        transformer
      );
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
      await this.handleProviderError(response, route, errorText, url, headers, targetApiType);
    }

    // 5. Handle Response
    if (request.stream) {
      return this.handleStreamingResponse(
        response,
        request,
        route,
        targetApiType,
        bypassTransformation
      );
    } else {
      return await this.handleNonStreamingResponse(
        response,
        request,
        route,
        targetApiType,
        transformer,
        bypassTransformation
      );
    }
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
      const oauthContext = context?.context ? context.context : context;
      const oauthOptions = context?.options;

      logger.debug('OAuth: Dispatching request', {
        routeProvider: route.provider,
        oauthProvider,
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
    // 1. Route using existing Router with 'embeddings' as the API type
    const route = await Router.resolve(request.model, 'embeddings');

    // 2. Build URL (embeddings always use /embeddings endpoint)
    const baseUrl = this.resolveBaseUrl(route, 'embeddings');
    const url = `${baseUrl}/embeddings`;

    // 3. Setup headers (Bearer auth, no streaming)
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

    // 4. Transform request (just model substitution)
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

    // 5. Execute request
    const response = await this.executeProviderRequest(url, headers, payload);

    if (!response.ok) {
      const errorText = await response.text();
      await this.handleProviderError(response, route, errorText, url, headers, 'embeddings');
    }

    // 6. Parse and enrich response
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

    return enrichedResponse;
  }

  /**
   * Dispatches audio transcription requests
   * Handles multipart/form-data file uploads to OpenAI-compatible transcription endpoints
   */
  async dispatchTranscription(request: UnifiedTranscriptionRequest): Promise<UnifiedTranscriptionResponse> {
    // 1. Route using existing Router with 'transcriptions' as the API type
    const route = await Router.resolve(request.model, 'transcriptions');

    // 2. Build URL (transcriptions use /audio/transcriptions endpoint)
    const baseUrl = this.resolveBaseUrl(route, 'transcriptions');
    const url = `${baseUrl}/audio/transcriptions`;

    // 3. Setup headers (multipart/form-data will be set by fetch automatically)
    const headers: Record<string, string> = {};

    if (route.config.api_key) {
      headers["Authorization"] = `Bearer ${route.config.api_key}`;
    }

    if (route.config.headers) {
      Object.assign(headers, route.config.headers);
    }

    // 4. Transform request to FormData
    const { TranscriptionsTransformer } = await import('../transformers/transcriptions');
    const transformer = new TranscriptionsTransformer();
    const formData = await transformer.transformRequest(request);

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
        temperature: request.temperature
      });
    }

    // 5. Execute request with FormData
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      await this.handleProviderError(response, route, errorText, url, headers, 'transcriptions');
    }

    // 6. Parse response based on format
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

    // 7. Transform response to unified format
    const unifiedResponse = await transformer.transformResponse(responseBody, responseFormat);

    // 8. Add plexus metadata
    unifiedResponse.plexus = {
      provider: route.provider,
      model: route.model,
      apiType: 'transcriptions',
      pricing: route.modelConfig?.pricing,
      providerDiscount: route.config.discount,
      canonicalModel: route.canonicalModel,
      config: route.config,
    };

    return unifiedResponse;
  }

  /**
   * Dispatches text-to-speech requests
   * Handles JSON body requests to OpenAI-compatible speech endpoints
   * Supports both binary audio responses and SSE streaming
   */
  async dispatchSpeech(request: UnifiedSpeechRequest): Promise<UnifiedSpeechResponse> {
    // 1. Route using existing Router with 'speech' as the API type
    const route = await Router.resolve(request.model, 'speech');

    // 2. Build URL (speech uses /audio/speech endpoint)
    const baseUrl = this.resolveBaseUrl(route, 'speech');
    const url = `${baseUrl}/audio/speech`;

    // 3. Setup headers
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (route.config.api_key) {
      headers["Authorization"] = `Bearer ${route.config.api_key}`;
    }

    if (route.config.headers) {
      Object.assign(headers, route.config.headers);
    }

    // 4. Transform request (model substitution and optional params)
    const { SpeechTransformer } = await import('../transformers/speech');
    const transformer = new SpeechTransformer();
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

    // 5. Execute request
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
      await this.handleProviderError(response, route, errorText, url, headers, 'speech');
    }

    // 6. Handle response (binary or streaming)
    const responseBuffer = Buffer.from(await response.arrayBuffer());
    logger.silly("Speech Response", { size: responseBuffer.length, isStreamed });

    if (request.requestId) {
      DebugManager.getInstance().addRawResponse(request.requestId, { size: responseBuffer.length, isStreamed });
    }

    // 7. Transform response
    const unifiedResponse = await transformer.transformResponse(responseBuffer, {
      stream_format: request.stream_format,
      response_format: request.response_format,
    });

    // 8. Add plexus metadata
    unifiedResponse.plexus = {
      provider: route.provider,
      model: route.model,
      apiType: 'speech',
      pricing: route.modelConfig?.pricing,
      providerDiscount: route.config.discount,
      canonicalModel: route.canonicalModel,
      config: route.config,
    };

    return unifiedResponse;
  }

  /**
   * Dispatches image generation requests
   * Handles JSON body requests to OpenAI-compatible image generation endpoints
   */
  async dispatchImageGenerations(request: UnifiedImageGenerationRequest): Promise<UnifiedImageGenerationResponse> {
    // 1. Route using existing Router with 'images' as the API type
    const route = await Router.resolve(request.model, 'images');

    // 2. Build URL (image generations use /images/generations endpoint)
    const baseUrl = this.resolveBaseUrl(route, 'images');
    const url = `${baseUrl}/images/generations`;

    // 3. Setup headers
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

    // 4. Transform request (model substitution and optional params)
    const { ImageTransformer } = await import('../transformers/image');
    const transformer = new ImageTransformer();
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

    // 5. Execute request
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      await this.handleProviderError(response, route, errorText, url, headers, 'images');
    }

    // 6. Parse JSON response
    const responseBody = await response.json();
    logger.silly("Image Generation Response", responseBody);

    if (request.requestId) {
      DebugManager.getInstance().addRawResponse(request.requestId, responseBody);
    }

    // 7. Transform response
    const unifiedResponse = await transformer.transformGenerationResponse(responseBody);

    // 8. Add plexus metadata
    unifiedResponse.plexus = {
      provider: route.provider,
      model: route.model,
      apiType: 'images',
      pricing: route.modelConfig?.pricing,
      providerDiscount: route.config.discount,
      canonicalModel: route.canonicalModel,
      config: route.config,
    };

    return unifiedResponse;
  }

  /**
   * Dispatches image editing requests
   * Handles multipart/form-data requests to OpenAI-compatible image editing endpoints
   * Supports single image upload with optional mask
   */
  async dispatchImageEdits(request: UnifiedImageEditRequest): Promise<UnifiedImageEditResponse> {
    // 1. Route using existing Router with 'images' as the API type
    const route = await Router.resolve(request.model, 'images');

    // 2. Build URL (image edits use /images/edits endpoint)
    const baseUrl = this.resolveBaseUrl(route, 'images');
    const url = `${baseUrl}/images/edits`;

    // 3. Setup headers (no Content-Type - fetch will set it for FormData)
    const headers: Record<string, string> = {};

    if (route.config.api_key) {
      headers["Authorization"] = `Bearer ${route.config.api_key}`;
    }

    if (route.config.headers) {
      Object.assign(headers, route.config.headers);
    }

    // 4. Transform request to FormData
    const { ImageTransformer } = await import('../transformers/image');
    const transformer = new ImageTransformer();
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

    // 5. Execute request with FormData
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      await this.handleProviderError(response, route, errorText, url, headers, 'images');
    }

    // 6. Parse JSON response
    const responseBody = await response.json();
    logger.silly("Image Edit Response", responseBody);

    if (request.requestId) {
      DebugManager.getInstance().addRawResponse(request.requestId, responseBody);
    }

    // 7. Transform response
    const unifiedResponse = await transformer.transformEditResponse(responseBody);

    // 8. Add plexus metadata
    unifiedResponse.plexus = {
      provider: route.provider,
      model: route.model,
      apiType: 'images',
      pricing: route.modelConfig?.pricing,
      providerDiscount: route.config.discount,
      canonicalModel: route.canonicalModel,
      config: route.config,
    };

    return unifiedResponse;
  }
}
