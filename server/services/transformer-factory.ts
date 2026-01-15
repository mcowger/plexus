/**
 * Transformer Factory Service
 * Creates and manages transformers for cross-provider request/response transformation
 */

import { AnthropicTransformer } from "../transformers/anthropic";
import { OpenAITransformer } from "../transformers/openai";
import { GeminiTransformer } from "../transformers/gemini";
import type {
  Transformer,
  UnifiedChatRequest,
  StreamTransformOptions,
} from "../transformers/types";
import { logger } from "../utils/logger";
import { streamSanitizer } from "./stream-sanitizer";

/**
 * Supported API types
 */
export type ApiType = "chat" | "messages" | "gemini";

/**
 * Get API type for a provider based on its configured apiTypes
 * Prefers the client's requested API type if supported by the provider.
 * Falls back to 'chat' as the primary default.
 */
export function getProviderApiType(
  providerApiTypes: string[],
  preferredApiType?: ApiType
): ApiType {
  // 1. If we have a preference and it's supported, use it
  if (
    preferredApiType &&
    (providerApiTypes as string[]).includes(preferredApiType)
  ) {
    return preferredApiType;
  }

  // 2. Otherwise, prefer 'chat' (OpenAI) as the most common/universal format
  if (providerApiTypes.includes("chat")) {
    return "chat";
  }

  // 3. Then 'messages' (Anthropic)
  if (providerApiTypes.includes("messages")) {
    return "messages";
  }

  // 4. Then 'gemini'
  if (providerApiTypes.includes("gemini")) {
    return "gemini";
  }

  // Default fallback
  return "chat";
}

/**
 * TransformerFactory creates and caches transformer instances
 */
export class TransformerFactory {
  private transformers: Map<ApiType, Transformer> = new Map();

  constructor() {
    this.transformers.set("chat", new OpenAITransformer());
    this.transformers.set("messages", new AnthropicTransformer());
    this.transformers.set("gemini", new GeminiTransformer());
  }

  /**
   * Get transformer for a specific API type
   */
  getTransformer(apiType: ApiType): Transformer {
    const transformer = this.transformers.get(apiType);
    if (!transformer) {
      throw new Error(`No transformer found for API type: ${apiType}`);
    }
    return transformer;
  }

  /**
   * Detect API type from endpoint path
   */
  static detectApiType(path: string): ApiType | null {
    if (path.includes("/chat/completions")) {
      return "chat";
    }
    if (path.includes("/messages")) {
      return "messages";
    }
    if (path.includes("generateContent")) {
      return "gemini";
    }
    return null;
  }

  /**
   * Transform incoming request to unified format
   * @param request - The incoming request body
   * @param sourceApiType - The API type of the incoming request
   * @returns Unified request format
   */
  async transformToUnified(
    request: any,
    sourceApiType: ApiType
  ): Promise<UnifiedChatRequest> {
    const transformer = this.getTransformer(sourceApiType);
    return transformer.parseRequest(request);
  }

  /**
   * Transform unified request to target provider format
   * @param unifiedRequest - Request in unified format
   * @param targetApiType - The API type of the target provider
   * @returns Provider-specific request format
   */
  async transformFromUnified(
    unifiedRequest: UnifiedChatRequest,
    targetApiType: ApiType
  ): Promise<any> {
    const transformer = this.getTransformer(targetApiType);
    return transformer.transformRequest(unifiedRequest);
  }

  /**
   * Transform provider response to client expected format
   * @param response - Response from provider
   * @param sourceApiType - API type of the provider that sent the response
   * @param targetApiType - API type expected by the client
   * @param debugOptions - Optional debug options for tracing
   * @returns Transformed response
   */
  async transformResponse(
    response: Response,
    sourceApiType: ApiType,
    targetApiType: ApiType,
    debugOptions?: StreamTransformOptions,
    needsSanitizer?: boolean
  ): Promise<Response> {
    // If source and target are the same, no transformation needed (optimization)
    // But strictly speaking we might want to normalize through Unified anyway?
    // For now, let's assume pass-through is fine if types match.
    if (sourceApiType === targetApiType) {
      // Return a Bun Response wrapper around the fetch Response
      const contentType = response.headers.get("Content-Type") || "";
      const isStream = contentType.includes("text/event-stream");

      if (isStream) {
        // Sanitize the stream to fix malformed SSE (e.g., "data: null" -> "data: [DONE]")
        // Only applied if the target is marked with needs_sanitizer: true
        const sanitizedBody = (response.body && needsSanitizer)
          ? streamSanitizer.sanitize(response.body)
      : response.body;
        
        return new Response(sanitizedBody, {
          status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        });
      } else {
        // For non-streaming, we need to parse and recreate to avoid body consumption issues
        const data = await response.json();
        return new Response(JSON.stringify(data), {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
        });
      }
    }

    const sourceTransformer = this.getTransformer(sourceApiType);
    const targetTransformer = this.getTransformer(targetApiType);

    const isStream = response.headers
      .get("Content-Type")
      ?.includes("text/event-stream");

    if (isStream) {
      if (!response.body) {
        throw new Error("Stream response body is null");
      }

      if (
        !sourceTransformer.transformStream ||
        !targetTransformer.formatStream
      ) {
        throw new Error(
          `Streaming transformation not supported between ${sourceApiType} and ${targetApiType}`
        );
      }

      // Pipeline: Source Stream -> Unified Stream -> Target Stream
      const unifiedStream = sourceTransformer.transformStream(
        response.body,
        debugOptions
      );
      const targetStream = targetTransformer.formatStream(
        unifiedStream,
        debugOptions
      );

      return new Response(targetStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } else {
      const data = await response.json();

      // Pipeline: Source Body -> Unified Response -> Target Body
      const unifiedResponse = await sourceTransformer.transformResponse(data);
      const targetResponse = await targetTransformer.formatResponse(
        unifiedResponse
      );

      return new Response(JSON.stringify(targetResponse), {
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  /**
   * Check if transformation is needed between two API types
   */
  static needsTransformation(
    sourceApiType: ApiType,
    targetApiType: ApiType
  ): boolean {
    return sourceApiType !== targetApiType;
  }
}

// Export singleton instance
export const transformerFactory = new TransformerFactory();
