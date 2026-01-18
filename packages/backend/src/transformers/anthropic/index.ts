import { Transformer } from "../../types/transformer";
import { UnifiedChatRequest, UnifiedChatResponse } from "../../types/unified";
import { parseAnthropicRequest } from "./request-parser";
import { buildAnthropicRequest } from "./request-builder";
import { transformAnthropicResponse } from "./response-transformer";
import { formatAnthropicResponse } from "./response-formatter";
import { transformAnthropicStream } from "./stream-transformer";
import { formatAnthropicStream } from "./stream-formatter";

/**
 * AnthropicTransformer
 *
 * Composition layer that delegates to specialized modules for each transformation:
 * - Request parsing: Client Anthropic → Unified
 * - Request building: Unified → Provider Anthropic
 * - Response transformation: Provider → Unified
 * - Response formatting: Unified → Client Anthropic
 * - Stream transformation: Provider Stream → Unified Stream
 * - Stream formatting: Unified Stream → Client Anthropic Stream
 *
 * This class maintains the original Transformer interface while delegating
 * all implementation details to focused, testable modules.
 */
export class AnthropicTransformer implements Transformer {
  readonly name = "messages";
  readonly defaultEndpoint = "/messages";

  async parseRequest(input: any): Promise<UnifiedChatRequest> {
    return parseAnthropicRequest(input);
  }

  async transformRequest(request: UnifiedChatRequest): Promise<any> {
    return buildAnthropicRequest(request);
  }

  async transformResponse(response: any): Promise<UnifiedChatResponse> {
    return transformAnthropicResponse(response);
  }

  async formatResponse(response: UnifiedChatResponse): Promise<any> {
    return formatAnthropicResponse(response);
  }

  transformStream(stream: ReadableStream): ReadableStream {
    return transformAnthropicStream(stream);
  }

  formatStream(stream: ReadableStream): ReadableStream {
    return formatAnthropicStream(stream);
  }

  /**
   * Extract usage from Anthropic-style event data (already parsed JSON string)
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

      // Anthropic sends usage in message_start and message_delta events
      if (data.type === "message_start" && data.message?.usage) {
        return {
          input_tokens: data.message.usage.input_tokens || 0,
          output_tokens: data.message.usage.output_tokens || 0,
          cached_tokens:
            data.message.usage.cache_read_input_tokens ||
            data.message.usage.cache_creation_input_tokens ||
            0,
          reasoning_tokens: data.message.usage.thinkingTokens || 0,
        };
      }

      if (data.type === "message_delta" && data.usage) {
        return {
     input_tokens: data.usage.input_tokens || 0,
          output_tokens: data.usage.output_tokens || 0,
          cached_tokens: data.usage.cache_read_input_tokens || 0,
          reasoning_tokens: data.usage.thinkingTokens || 0,
        };
      }
    } catch (e) {
      // Ignore parse errors
    }

    return undefined;
  }
}
