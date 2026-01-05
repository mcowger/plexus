import { UnifiedChatRequest, UnifiedChatResponse } from "../types/unified";
import { Router } from "./router";
import { TransformerFactory } from "./transformer-factory";
import { logger } from "../utils/logger";
import { CooldownManager } from "./cooldown-manager";
import { RouteResult } from "./router";
import { DebugManager } from "./debug-manager";

export class Dispatcher {
  async dispatch(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    // 1. Route
    const route = Router.resolve(request.model);

    // 2. Get Transformer
    const transformer = TransformerFactory.getTransformer(route.config.type);

    // 3. Transform Request
    // Override model in request to the target model
    const requestWithTargetModel = { ...request, model: route.model };

    let providerPayload;

    // Pass-through Optimization
    // request.incomingApiType is now 'chat', 'messages', or 'gemini'
    // route.config.type is 'OpenAI', 'Anthropic', or 'Gemini'/'Google'

    const isCompatible =
      !!request.incomingApiType?.toLowerCase() &&
      request.incomingApiType?.toLowerCase() ===
        route.config.type?.toLowerCase();

    let bypassTransformation = false;

    if (isCompatible && request.originalBody) {
      logger.info(
        `Pass-through optimization active: ${request.incomingApiType} -> ${route.config.type}`
      );
      providerPayload = JSON.parse(JSON.stringify(request.originalBody));
      providerPayload.model = route.model;
      bypassTransformation = true;
    } else {
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
    // Ensure api_base_url doesn't end with slash if endpoint starts with slash, or handle cleanly
    const baseUrl = route.config.api_base_url.replace(/\/$/, "");
    const endpoint = transformer.getEndpoint
      ? transformer.getEndpoint(requestWithTargetModel)
      : transformer.defaultEndpoint;
    const url = `${baseUrl}${endpoint}`;

    const headers = this.setupHeaders(route);

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
          apiType: route.config.type,
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
        apiType: route.config.type,
        pricing: route.modelConfig?.pricing,
        providerDiscount: route.config.discount,
        canonicalModel: route.canonicalModel,
      };

      return unifiedResponse;
    }
  }
  setupHeaders(route: RouteResult): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (route.config.api_key) {
      const type = route.config.type.toLowerCase();
      if (type === "messages") {
        headers["x-api-key"] = route.config.api_key;
        headers["anthropic-version"] = "2023-06-01";
      } else if (type === "gemini") {
        headers["x-goog-api-key"] = route.config.api_key;
      } else {
        // Default to Bearer for Chat (OpenAI) and others
        headers["Authorization"] = `Bearer ${route.config.api_key}`;
      }
    }
    if (route.config.headers) {
      Object.assign(headers, route.config.headers);
    }
    return headers;
  }
}
