import { UnifiedChatRequest, UnifiedChatResponse } from "../types/unified";
import { Router } from "./router";
import { TransformerFactory } from "./transformer-factory";
import { logger } from "../utils/logger";
import { CooldownManager } from "./cooldown-manager";
import { RouteResult } from "./router";
import { DebugManager } from "./debug-manager";
import { UsageStorageService } from "./usage-storage";

export class Dispatcher {
  private usageStorage?: UsageStorageService;

  setUsageStorage(storage: UsageStorageService) {
    this.usageStorage = storage;
  }
  async dispatch(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    // 1. Route
    const route = Router.resolve(request.model, request.incomingApiType);

    // Determine Target API Type
    const providerTypes = Array.isArray(route.config.type)
      ? route.config.type
      : [route.config.type];

    // Check if model specific access_via is defined
    const modelSpecificTypes = route.modelConfig?.access_via;
    
    // The available types for this specific routing
    // If model specific types are defined and not empty, use them. Otherwise fallback to provider types.
    const availableTypes = (modelSpecificTypes && modelSpecificTypes.length > 0) 
      ? modelSpecificTypes 
      : providerTypes;

    let targetApiType = availableTypes[0]; // Default to first one

    if (!targetApiType) {
        throw new Error(`No available API type found for provider '${route.provider}' and model '${route.model}'. Check configuration.`);
    }
    let selectionReason = "default (first available)";

    // Try to match incoming
    if (request.incomingApiType) {
        const incoming = request.incomingApiType.toLowerCase();
        // Case-insensitive match
        const match = availableTypes.find((t: string) => t.toLowerCase() === incoming);
        if (match) {
            targetApiType = match;
            selectionReason = `matched incoming request type '${incoming}'`;
        } else {
            selectionReason = `incoming type '${incoming}' not supported, defaulted to '${targetApiType}'`;
        }
    }
    
    logger.info(`Dispatcher: Selected API type '${targetApiType}' for model '${route.model}'. Reason: ${selectionReason}`);

    // 2. Get Transformer
    // Check if provider has force_transformer override
    const transformerType = route.config.force_transformer || targetApiType;
    if (route.config.force_transformer) {
        logger.info(`Dispatcher: Using forced transformer '${transformerType}' instead of '${targetApiType}' for provider '${route.provider}'`);
    }
    const transformer = TransformerFactory.getTransformer(transformerType);

    // 3. Transform Request
    // Override model in request to the target model
    const requestWithTargetModel = this.populateOAuthMetadata(
      { ...request, model: route.model },
      route
    );

    let providerPayload;

    // Pass-through Optimization
    // Only use pass-through if incoming API matches target API AND no force_transformer is set
    const isCompatible =
      !!request.incomingApiType?.toLowerCase() &&
      request.incomingApiType?.toLowerCase() ===
        targetApiType.toLowerCase();

    let bypassTransformation = false;

    if (isCompatible && request.originalBody && !route.config.force_transformer) {
      logger.info(
        `Pass-through optimization active: ${request.incomingApiType} -> ${targetApiType}`
      );
      providerPayload = JSON.parse(JSON.stringify(request.originalBody));
      providerPayload.model = route.model;
      bypassTransformation = true;
    } else {
      if (route.config.force_transformer) {
        logger.info(`Pass-through optimization bypassed due to force_transformer: ${route.config.force_transformer}`);
      }
      providerPayload = await transformer.transformRequest(
        requestWithTargetModel
      );
    }

    if (route.config.extraBody) {
      providerPayload = { ...providerPayload, ...route.config.extraBody };
    }

    // Capture transformed request
    if (request.requestId) {
      DebugManager.getInstance().addTransformedRequest(request.requestId, providerPayload);
    }

    // 4. Execute Request
    // Resolve base URL based on target API type
    let rawBaseUrl: string;
    
    if (typeof route.config.api_base_url === 'string') {
        rawBaseUrl = route.config.api_base_url;
    } else {
        // It's a record/map
        const typeKey = targetApiType.toLowerCase();
        // Check exact match first, then fallback to just looking for keys that might match?
        // Actually the config keys should probably match the api types (chat, messages, etc)
        const specificUrl = route.config.api_base_url[typeKey];
        const defaultUrl = route.config.api_base_url['default'];
        
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
                    logger.warn(`No specific base URL found for api type '${targetApiType}'. using '${firstKey}' as fallback.`);
                 } else {
                    throw new Error(`No base URL configured for api type '${targetApiType}' and no default found.`);
                 }
             } else {
                 throw new Error(`No base URL configured for api type '${targetApiType}' and no default found.`);
             }
        }
    }

    // Ensure api_base_url doesn't end with slash if endpoint starts with slash, or handle cleanly
    const baseUrl = rawBaseUrl.replace(/\/$/, "");
    const endpoint = transformer.getEndpoint
      ? transformer.getEndpoint(requestWithTargetModel)
      : transformer.defaultEndpoint;
    const url = `${baseUrl}${endpoint}`;

    const headers = this.setupHeaders(route, targetApiType, request);

    const incomingApi = request.incomingApiType || "unknown";

    logger.info(
      `Dispatching ${request.model} to ${route.provider}:${route.model} ${incomingApi} <-> ${transformer.name}`
    );
    logger.silly("Upstream Request Payload", providerPayload);

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(providerPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Provider error: ${response.status} ${errorText}`);

      if (response.status >= 500 || [401, 408, 429].includes(response.status)) {
        CooldownManager.getInstance().markProviderFailure(route.provider);
      }

      throw new Error(`Provider failed: ${response.status} ${errorText}`);
    }

    // 5. Handle Streaming Response
    if (request.stream) {
      logger.info("Streaming response detected");

      let rawStream = response.body!;

      // Dispatcher just returns the raw stream - no transformation here
      return {
        id: "stream-" + Date.now(),
        model: request.model,
        content: null,
        stream: rawStream,
        bypassTransformation: bypassTransformation,
        plexus: {
          provider: route.provider,
          model: route.model,
          apiType: targetApiType,
          pricing: route.modelConfig?.pricing,
          providerDiscount: route.config.discount,
          canonicalModel: route.canonicalModel,
        },
      };
    } 
    // Non-streaming response
    else {
      const responseBody = JSON.parse(await response.text());
      logger.silly("Upstream Response Payload", responseBody);

      if (request.requestId) {
        DebugManager.getInstance().addRawResponse(request.requestId, responseBody);
      }

      let unifiedResponse: UnifiedChatResponse;

      if (bypassTransformation) {
        // We still need unified response for usage stats, so we transform purely for that
        // But we set the bypass flag and attach raw response
        const syntheticResponse = await transformer.transformResponse(
          responseBody
        );
        unifiedResponse = {
          ...syntheticResponse,
          bypassTransformation: true,
          rawResponse: responseBody,
        };
      } else {
        unifiedResponse = await transformer.transformResponse(responseBody);
      }

      unifiedResponse.plexus = {
        provider: route.provider,
        model: route.model,
        apiType: targetApiType,
        pricing: route.modelConfig?.pricing,
        providerDiscount: route.config.discount,
        canonicalModel: route.canonicalModel,
      };

      return unifiedResponse;
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

    // Check if this provider uses OAuth
    if (route.config.oauth_provider && this.usageStorage) {
      const credential = this.usageStorage.getOAuthCredential(route.config.oauth_provider);

      if (credential) {
        // Check if token is expired or expiring soon (within 5 minutes)
        const isExpired = Date.now() >= credential.expires_at;
        const isExpiringSoon = Date.now() >= (credential.expires_at - 5 * 60 * 1000);

        if (isExpired) {
          throw new Error(`OAuth token for provider '${route.config.oauth_provider}' has expired. Please re-authenticate.`);
        }

        if (isExpiringSoon) {
          logger.warn(`OAuth token for provider '${route.config.oauth_provider}' is expiring soon. Refresh process should handle this.`);
        }

        // Use the OAuth access token
        headers["Authorization"] = `Bearer ${credential.access_token}`;
        logger.debug(`Using OAuth token for provider: ${route.config.oauth_provider}`);
      } else {
        throw new Error(`OAuth provider '${route.config.oauth_provider}' is configured but no credentials found. Please authenticate.`);
      }
    } else if (route.config.api_key) {
      // Use static API key
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
      throw new Error(`No authentication configured for provider '${route.provider}'. Either api_key or oauth_provider must be set.`);
    }

    if (route.config.headers) {
      Object.assign(headers, route.config.headers);
    }
    return headers;
  }

  /**
   * Populates OAuth metadata into the request if OAuth provider is configured
   * @private
   */
  private populateOAuthMetadata(
    request: UnifiedChatRequest,
    route: RouteResult
  ): UnifiedChatRequest {
    // If OAuth is used, add OAuth metadata to request for transformer access
    if (route.config.oauth_provider && this.usageStorage) {
      const credential = this.usageStorage.getOAuthCredential(route.config.oauth_provider);
      if (credential && credential.project_id) {
        return {
          ...request,
          metadata: {
            ...request.metadata,
            oauth_project_id: credential.project_id
          }
        };
      }
    }
    return request;
  }
}
