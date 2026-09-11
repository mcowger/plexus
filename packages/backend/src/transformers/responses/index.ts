import { Transformer } from '../../types/transformer';
import { UnifiedChatRequest, UnifiedChatResponse } from '../../types/unified';
import { normalizeOpenAIResponsesUsage } from '../../utils/usage-normalizer';
import { buildResponsesRequest } from './request-builder';
import { parseResponsesRequest } from './request-parser';
import { formatResponsesResponse } from './response-formatter';
import { transformResponsesResponse } from './response-transformer';
import { formatResponsesStream } from './stream-formatter';
import { transformResponsesStream } from './stream-transformer';
import { ResponsesToolState, createResponsesToolState } from './tool-mapper';
import { generateItemId, generateResponseId } from './utils';

export * from './normalization';
export * from './utils';
export * from './tool-mapper';
export * from './request-parser';
export * from './request-builder';
export * from './response-transformer';
export * from './response-formatter';
export * from './stream-transformer';
export * from './stream-formatter';

/**
 * ResponsesTransformer
 *
 * Implements the OpenAI Responses API format transformer.
 * Composition layer that delegates to specialized modules for each transformation:
 * - Request parsing: Client Responses API → Unified
 * - Request building: Unified → Provider Responses API
 * - Response transformation: Provider → Unified
 * - Response formatting: Unified → Client Responses API
 * - Stream transformation: Provider Stream → Unified Stream
 * - Stream formatting: Unified Stream → Client Responses API Stream
 *
 * Maintains the original Transformer interface while delegating
 * all implementation details to focused, testable modules.
 */
export class ResponsesTransformer implements Transformer {
  readonly name = 'responses';
  readonly defaultEndpoint = '/responses';

  // Codex CLI extensions (namespace tools, custom/freeform tools) are
  // per-request state: providers only understand flat function tools, so we
  // flatten on the way in and split/re-wrap on the way out. Populated during
  // parseRequest/convertToolsForUnified and consulted by
  // convertChatResponseToOutputItems/formatStream on the same instance.
  private toolState: ResponsesToolState = createResponsesToolState();

  get namespaceMap(): Map<string, { namespace: string; name: string }> {
    return this.toolState.namespaceMap;
  }

  get customToolNames(): Set<string> {
    return this.toolState.customToolNames;
  }

  /**
   * Parses incoming Responses API request into unified format
   */
  async parseRequest(input: any): Promise<UnifiedChatRequest> {
    return parseResponsesRequest(input, this.toolState);
  }

  /**
   * Transforms Chat Completions request to Responses API format (not typically needed)
   */
  async transformRequest(request: UnifiedChatRequest): Promise<any> {
    return buildResponsesRequest(request);
  }

  /**
   * Transforms provider response to unified chat format
   */
  async transformResponse(response: any): Promise<UnifiedChatResponse> {
    return transformResponsesResponse(response);
  }

  /**
   * Formats unified response into Responses API format for the client
   */
  async formatResponse(response: UnifiedChatResponse): Promise<any> {
    return formatResponsesResponse(response, this.toolState);
  }

  /**
   * Converts Responses API SSE stream to Unified chunks
   */
  transformStream(stream: ReadableStream): ReadableStream {
    return transformResponsesStream(stream);
  }

  /**
   * Formats unified stream into Responses API SSE format
   */
  formatStream(stream: ReadableStream): ReadableStream {
    return formatResponsesStream(stream, this.toolState);
  }

  /**
   * Extract usage information from SSE event data
   */
  extractUsage(eventData: string):
    | {
        input_tokens?: number;
        output_tokens?: number;
        cached_tokens?: number;
        cache_creation_tokens?: number;
        reasoning_tokens?: number;
      }
    | undefined {
    try {
      const event = JSON.parse(eventData);

      // For response.completed events
      if (event.type === 'response.completed' && event.response?.usage) {
        const usage = normalizeOpenAIResponsesUsage(event.response.usage);
        return {
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          cached_tokens: usage.cached_tokens,
          cache_creation_tokens: usage.cache_creation_tokens,
          reasoning_tokens: usage.reasoning_tokens,
        };
      }

      return undefined;
    } catch (e) {
      return undefined;
    }
  }

  /**
   * Generates unique response ID
   */
  private generateResponseId(): string {
    return generateResponseId();
  }

  /**
   * Generates unique item ID with prefix
   */
  private generateItemId(prefix: string): string {
    return generateItemId(prefix);
  }
}
