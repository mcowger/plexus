import { generateId } from '@ai-sdk/provider-utils';
import { logger } from '../../utils/logger.js';

// ============================================================================
// OpenAI Chat Completions API Response Type Definitions
// ============================================================================

/** OpenAI Chat Completions API response structure */
export interface OpenAIChatCompletionResponse {
  id: string | null;
  created: number | null;
  model: string | null;
  choices: Array<{
    message: {
      role: 'assistant' | null;
      content: string | null;
      tool_calls?: Array<{
        id: string | null;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }> | null;
      annotations?: Array<{
        type: 'url_citation';
        url_citation: {
          start_index: number;
          end_index: number;
          url: string;
          title: string;
        };
      }> | null;
    };
    index: number;
    finish_reason: string | null;
    logprobs?: {
      content?: Array<{
        token: string;
        logprob: number;
        top_logprobs: Array<{
          token: string;
          logprob: number;
        }>;
      }> | null;
    } | null;
  }>;
  usage?: {
    prompt_tokens: number | null;
    completion_tokens: number | null;
    total_tokens: number | null;
    prompt_tokens_details?: {
      cached_tokens: number | null;
    } | null;
    completion_tokens_details?: {
      reasoning_tokens: number | null;
      accepted_prediction_tokens: number | null;
      rejected_prediction_tokens: number | null;
    } | null;
  } | null;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Map unified finish reason to OpenAI Chat Completions finish reason.
 */
function mapFinishReason(finishReason: string): string {
  logger.debug(`Mapping finish reason: ${finishReason}`);
  let mappedReason: string;

  switch (finishReason) {
    case 'stop':
      mappedReason = 'stop';
      break;
    case 'length':
      mappedReason = 'length';
      break;
    case 'tool-calls':
      mappedReason = 'tool_calls';
      break;
    case 'content-filter':
      mappedReason = 'content_filter';
      break;
    case 'error':
    case 'other':
      mappedReason = 'stop';
      break;
    default:
      mappedReason = 'stop';
      break;
  }

  logger.debug(`Mapped finish reason: ${finishReason} -> ${mappedReason}`);
  return mappedReason;
}

/**
 * Build annotations array from sources.
 */
function buildAnnotations(sources: Array<any>): Array<{
  type: 'url_citation';
  url_citation: {
    start_index: number;
    end_index: number;
    url: string;
    title: string;
  };
}> | null {
  logger.debug(`Building annotations from ${sources?.length || 0} source(s)`);

  if (!sources || sources.length === 0) {
    logger.debug('No sources provided, returning null annotations');
    return null;
  }

  const annotations: Array<{
    type: 'url_citation';
    url_citation: {
      start_index: number;
      end_index: number;
      url: string;
      title: string;
    };
  }> = [];

  for (const source of sources) {
    if (source.sourceType === 'url') {
      annotations.push({
        type: 'url_citation',
        url_citation: {
          start_index: 0, // We don't have position info, use 0
          end_index: 0,
          url: source.url,
          title: source.title || '',
        },
      });
      logger.debug(`Added annotation for URL: ${source.url}`);
    }
  }

  const result = annotations.length > 0 ? annotations : null;
  logger.debug(`Built ${annotations.length} annotation(s), returning ${result ? 'annotations' : 'null'}`);
  return result;
}

// ============================================================================
// Main Conversion Function
// ============================================================================

/**
 * Convert a GenerateTextResult to OpenAI Chat Completions API response format.
 *
 * @param result - GenerateTextResult from AI SDK's generateText()
 * @returns OpenAI Chat Completions API response object
 *
 * @example
 * ```typescript
 * const result = await generateText({
 *   model: openai('gpt-4'),
 *   prompt: 'Hello',
 * });
 *
 * const openaiResponse = convertToOpenAIChatResponse(result);
 * console.log(openaiResponse.choices[0].message.content);
 * ```
 */
export function convertToOpenAIChatResponse(
  result: any
): OpenAIChatCompletionResponse {
  logger.info('Starting conversion from GenerateTextResult to OpenAI Chat Completions API response format');
  logger.debug(`Result has ${result.content?.length || 0} content part(s), finishReason: ${result.finishReason || 'none'}`);

  // Extract text content from content parts
  let textContent = '';
  const toolCalls: Array<{
    id: string | null;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }> = [];

  // Process content array
  if (result.content && Array.isArray(result.content)) {
    logger.debug(`Processing ${result.content.length} content part(s)`);

    for (let i = 0; i < result.content.length; i++) {
      const part = result.content[i];
      logger.debug(`Processing content part ${i + 1} of type: ${part.type}`);

      if (part.type === 'text') {
        textContent += part.text;
        logger.debug(`Added text content, total length: ${textContent.length} characters`);
      } else if (part.type === 'reasoning') {
        // Include reasoning as text (OpenAI Chat API doesn't have separate reasoning field)
        textContent += part.text;
        logger.debug(`Added reasoning as text, total length: ${textContent.length} characters`);
      } else if (part.type === 'tool-call') {
        const toolCallId = part.toolCallId || null;
        toolCalls.push({
          id: toolCallId,
          type: 'function',
          function: {
            name: part.toolName,
            arguments: JSON.stringify(part.input || {}),
          },
        });
        logger.debug(`Added tool call for '${part.toolName}' with ID '${toolCallId}'`);
      }
      // Ignore: tool-result, file, source (sources handled separately)
    }
  } else {
    logger.debug('No content array found in result');
  }

  // Build annotations from sources
  const annotations = buildAnnotations(result.sources || []);
  if (annotations) {
    logger.debug(`Built ${annotations.length} annotation(s) from sources`);
  }

  // Build message object
  const message: any = {
    role: 'assistant',
    content: textContent || null,
  };

  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
    logger.debug(`Added ${toolCalls.length} tool call(s) to message`);
  }

  if (annotations) {
    message.annotations = annotations;
    logger.debug(`Added ${annotations.length} annotation(s) to message`);
  }

  logger.debug(`Built message with ${textContent.length} character(s) of text content`);

  // Build usage object
  const usage = result.usage
    ? {
        prompt_tokens: result.usage.inputTokens || null,
        completion_tokens: result.usage.outputTokens || null,
        total_tokens: result.usage.totalTokens || null,
        prompt_tokens_details:
          result.usage.inputTokenDetails?.cacheReadTokens != null
            ? {
                cached_tokens: result.usage.inputTokenDetails.cacheReadTokens,
              }
            : null,
        completion_tokens_details:
          result.usage.outputTokenDetails?.reasoningTokens != null
            ? {
                reasoning_tokens:
                  result.usage.outputTokenDetails.reasoningTokens,
                accepted_prediction_tokens: null,
                rejected_prediction_tokens: null,
              }
            : null,
      }
    : null;

  if (usage) {
    logger.debug(`Built usage object: prompt=${usage.prompt_tokens}, completion=${usage.completion_tokens}, total=${usage.total_tokens}`);
  }

  // Build response
  const response: OpenAIChatCompletionResponse = {
    id: result.response?.id || generateId(),
    created: Math.floor(Date.now() / 1000),
    model: result.response?.model || result.request?.model || null,
    choices: [
      {
        message,
        index: 0,
        finish_reason: mapFinishReason(result.finishReason || 'stop'),
        logprobs: null, // Not available in GenerateTextResult
      },
    ],
    usage,
  };

  logger.info(`Conversion completed successfully. Model: ${response.model || 'unknown'}, tool calls: ${toolCalls.length}`);
  return response;
}
