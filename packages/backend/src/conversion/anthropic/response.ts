import { generateId } from '@ai-sdk/provider-utils';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Anthropic Messages API Response Type Definitions
// ============================================================================

/** Anthropic Messages API response structure */
export interface AnthropicMessagesResponse {
  type: 'message';
  id: string | null;
  model: string | null;
  content: Array<AnthropicContentBlock>;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number | null;
    cache_read_input_tokens: number | null;
  };
  container?: {
    expires_at: string;
    id: string;
    skills?: Array<{
      type: 'anthropic' | 'custom';
      skill_id: string;
      version: string;
    }> | null;
  } | null;
  context_management?: {
    applied_edits: Array<{
      type: 'clear_tool_uses_20250919' | 'clear_thinking_20251015';
      cleared_tool_uses?: number;
      cleared_input_tokens?: number;
      cleared_thinking_turns?: number;
    }>;
  } | null;
}

/** Union type for all Anthropic content blocks */
type AnthropicContentBlock =
  | {
      type: 'text';
      text: string;
      citations?: Array<{
        type: 'web_search_result_location' | 'page_location' | 'char_location';
        start?: number;
        end?: number;
        url?: string;
        title?: string;
        page_number?: number;
        quote?: string;
      }>;
    }
  | {
      type: 'thinking';
      thinking: string;
      signature: string;
    }
  | {
      type: 'redacted_thinking';
      data: string;
    }
  | {
      type: 'tool_use';
      id: string;
      name: string;
      input: unknown;
      caller?: {
        type: 'code_execution_20250825' | 'direct';
        tool_id?: string;
      };
    };

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Map unified finish reason to Anthropic stop reason.
 */
function mapFinishReason(finishReason: string): string {
  logger.debug(`Mapping finish reason: ${finishReason}`);
  let mappedReason: string;

  switch (finishReason) {
    case 'stop':
      mappedReason = 'end_turn';
      break;
    case 'length':
      mappedReason = 'max_tokens';
      break;
    case 'tool-calls':
      mappedReason = 'tool_use';
      break;
    case 'content-filter':
      mappedReason = 'safety';
      break;
    case 'error':
      mappedReason = 'error';
      break;
    case 'other':
      mappedReason = 'end_turn';
      break;
    default:
      mappedReason = 'end_turn';
      break;
  }

  logger.debug(`Mapped finish reason: ${finishReason} -> ${mappedReason}`);
  return mappedReason;
}

/**
 * Build citations array from sources.
 */
function buildCitations(
  sources: Array<any>
): Array<{
  type: 'web_search_result_location';
  start: number;
  end: number;
  url: string;
  title: string;
}> | null {
  logger.debug(`Building citations from ${sources?.length || 0} source(s)`);

  if (!sources || sources.length === 0) {
    logger.debug('No sources provided, returning null citations');
    return null;
  }

  const citations: Array<{
    type: 'web_search_result_location';
    start: number;
    end: number;
    url: string;
    title: string;
  }> = [];

  for (const source of sources) {
    if (source.sourceType === 'url') {
      citations.push({
        type: 'web_search_result_location',
        start: 0,
        end: 0,
        url: source.url,
        title: source.title || '',
      });
      logger.debug(`Added citation for URL: ${source.url}`);
    }
  }

  const result = citations.length > 0 ? citations : null;
  logger.debug(`Built ${citations.length} citation(s), returning ${result ? 'citations' : 'null'}`);
  return result;
}

// ============================================================================
// Main Conversion Function
// ============================================================================

/**
 * Convert a GenerateTextResult to Anthropic Messages API response format.
 *
 * @param result - GenerateTextResult from AI SDK's generateText()
 * @returns Anthropic Messages API response object
 *
 * @example
 * ```typescript
 * const result = await generateText({
 *   model: anthropic('claude-3-5-sonnet-20241022'),
 *   prompt: 'Hello',
 * });
 *
 * const anthropicResponse = convertToAnthropicMessagesResponse(result);
 * console.log(anthropicResponse.content);
 * ```
 */
export function convertToAnthropicMessagesResponse(
  result: any
): AnthropicMessagesResponse {
  logger.info('Starting conversion from GenerateTextResult to Anthropic Messages API response format');
  logger.debug(`Result has ${result.content?.length || 0} content part(s), finishReason: ${result.finishReason || 'none'}`);

  const content: Array<AnthropicContentBlock> = [];
  const citations = buildCitations(result.sources || []);
  
  if (citations) {
    logger.debug(`Built ${citations.length} citation(s) from sources`);
  }

  // Process content array
  if (result.content && Array.isArray(result.content)) {
    logger.debug(`Processing ${result.content.length} content part(s)`);

    for (let i = 0; i < result.content.length; i++) {
      const part = result.content[i];
      logger.debug(`Processing content part ${i + 1} of type: ${part.type}`);

      if (part.type === 'text') {
        const textBlock: any = {
          type: 'text',
          text: part.text,
        };

        // Add citations to first text block if available
        if (citations && content.length === 0) {
          textBlock.citations = citations;
          logger.debug(`Added ${citations.length} citation(s) to first text block`);
        }

        content.push(textBlock);
        logger.debug(`Added text block with ${part.text.length} characters`);
      } else if (part.type === 'reasoning') {
        // Check for signature in provider metadata
        const signature =
          part.providerMetadata?.anthropic?.signature ||
          part.providerMetadata?.anthropic?.thoughtSignature ||
          '';

        if (signature) {
          content.push({
            type: 'thinking',
            thinking: part.text,
            signature,
          });
          logger.debug(`Added thinking block with signature, length: ${part.text.length} characters`);
        } else {
          // If no signature, use redacted thinking format
          const encodedData = Buffer.from(part.text).toString('base64');
          content.push({
            type: 'redacted_thinking',
            data: encodedData,
          });
          logger.debug(`Added redacted thinking block, encoded length: ${encodedData.length} characters`);
        }
      } else if (part.type === 'tool-call') {
        const toolCallId = part.toolCallId || generateId();
        content.push({
          type: 'tool_use',
          id: toolCallId,
          name: part.toolName,
          input: part.input || {},
          caller: part.providerExecuted
            ? {
                type: 'code_execution_20250825',
                tool_id: part.toolCallId,
              }
            : undefined,
        });
        logger.debug(`Added tool use block for tool '${part.toolName}' with ID '${toolCallId}'`);
      }
      // Ignore: tool-result, file, source (handled via citations)
    }
  } else {
    logger.debug('No content array found in result');
  }

  // If no content blocks were created, add an empty text block
  if (content.length === 0) {
    logger.debug('No content blocks created, adding empty text block');
    content.push({
      type: 'text',
      text: '',
    });
  }

  // Build usage object
  const usage = {
    input_tokens: result.usage?.inputTokens || 0,
    output_tokens: result.usage?.outputTokens || 0,
    cache_creation_input_tokens:
      result.usage?.inputTokenDetails?.cacheWriteTokens || null,
    cache_read_input_tokens:
      result.usage?.inputTokenDetails?.cacheReadTokens || null,
  };

  logger.debug(`Built usage object: input=${usage.input_tokens}, output=${usage.output_tokens}`);

  // Build response
  const response: AnthropicMessagesResponse = {
    type: 'message',
    id: result.response?.id || generateId(),
    model: result.response?.model || result.request?.model || null,
    content,
    stop_reason: mapFinishReason(result.finishReason || 'stop'),
    stop_sequence: result.rawFinishReason || null,
    usage,
    container: null,
    context_management: null,
  };

  logger.info(`Conversion completed successfully. Generated ${content.length} content block(s), model: ${response.model || 'unknown'}`);
  return response;
}
