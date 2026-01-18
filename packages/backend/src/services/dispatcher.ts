import { UnifiedChatRequest, UnifiedChatResponse } from "../types/unified";
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
    const route = Router.resolve(request.model, request.incomingApiType);

    // Determine Target API Type
    const { targetApiType, selectionReason } = this.selectTargetApiType(
      route,
      request.incomingApiType
    );

    logger.info(
      `Dispatcher: Selected API type '${targetApiType}' for model '${route.model}'. Reason: ${selectionReason}`
    );

    // 2. Get Transformer
    const transformerType = this.resolveTransformerType(route, targetApiType);
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
   * Determines which transformer to use, respecting force_transformer override
   */
  private resolveTransformerType(route: RouteResult, targetApiType: string): string {
    const transformerType = route.config.force_transformer || targetApiType;
    if (route.config.force_transformer) {
      logger.info(
        `Dispatcher: Using forced transformer '${transformerType}' instead of '${targetApiType}' for provider '${route.provider}'`
      );
    }
    return transformerType;
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

    return isCompatible && !!request.originalBody && !route.config.force_transformer;
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
      if (route.config.force_transformer) {
        logger.info(
          `Pass-through optimization bypassed due to force_transformer: ${route.config.force_transformer}`
        );
      }
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

      // Mark provider as failed with optional duration
      // For non-429 errors, cooldownDuration will be undefined and default (10 minutes) will be used
      cooldownManager.markProviderFailure(route.provider, undefined, cooldownDuration);
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
}
