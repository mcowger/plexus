import { Transformer } from "../../types/transformer";
import { UnifiedChatRequest, UnifiedChatResponse } from "../../types/unified";
import { parseGeminiRequest } from "./request-parser";
import { buildGeminiRequest } from "./request-builder";
import { transformGeminiResponse } from "./response-transformer";
import { formatGeminiResponse } from "./response-formatter";
import { transformGeminiStream } from "./stream-transformer";
import { formatGeminiStream } from "./stream-formatter";

/**
 * GeminiTransformer
 *
 * Composition layer that delegates to specialized modules for each transformation:
 * - Request parsing: Client Gemini → Unified
 * - Request building: Unified → Provider Gemini
 * - Response transformation: Provider → Unified
 * - Response formatting: Unified → Client Gemini
 * - Stream transformation: Provider Stream → Unified Stream
 * - Stream formatting: Unified Stream → Client Gemini Stream
 *
 * This class maintains the original Transformer interface while delegating
 * all implementation details to focused, testable modules.
 */
export class GeminiTransformer implements Transformer {
  readonly name = "gemini";
  readonly defaultEndpoint = "/v1beta/models/:modelAndAction";

  /**
   * getEndpoint
   * Dynamically constructs the Gemini API URL based on whether streaming is requested.
   *
   * Note: This method is tightly coupled to Gemini's API structure and stays in the main class.
   */
  getEndpoint(request: UnifiedChatRequest): string {
    const action = request.stream
      ? "streamGenerateContent?alt=sse"
      : "generateContent";
    let model = request.model;
    if (!model.startsWith("models/") && !model.startsWith("tunedModels/")) {
      model = `models/${model}`;
    }
    return `/v1beta/${model}:${action}`;
  }

  async parseRequest(input: any): Promise<UnifiedChatRequest> {
    return parseGeminiRequest(input);
  }

  async transformRequest(request: UnifiedChatRequest): Promise<any> {
    return buildGeminiRequest(request);
  }

  async transformResponse(response: any): Promise<UnifiedChatResponse> {
    return transformGeminiResponse(response);
  }

  async formatResponse(response: UnifiedChatResponse): Promise<any> {
    return formatGeminiResponse(response);
  }

  transformStream(stream: ReadableStream): ReadableStream {
    return transformGeminiStream(stream);
  }

  formatStream(stream: ReadableStream): ReadableStream {
    return formatGeminiStream(stream);
  }

  /**
   * Extract usage from Gemini-style event data (already parsed JSON string)
   */
  extractUsage(
    dataStr: string
  ):
    | {
        input_tokens?: number;
        output_tokens?: number;
        cached_tokens?: number;
        reasoning_tokens?: number;
      }
    | undefined {
    try {
      const data = JSON.parse(dataStr);

      // Gemini sends usage in usageMetadata
      if (data.usageMetadata) {
        return {
          input_tokens: data.usageMetadata.promptTokenCount || 0,
          output_tokens: data.usageMetadata.candidatesTokenCount || 0,
          cached_tokens: data.usageMetadata.cachedContentTokenCount || 0,
          reasoning_tokens: data.usageMetadata.thoughtsTokenCount || 0,
        };
      }
    } catch (e) {
      // Ignore parse errors
    }

    return undefined;
  }
}
