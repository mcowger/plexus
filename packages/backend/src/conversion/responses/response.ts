import { generateId } from '@ai-sdk/provider-utils';
import { logger } from '../../utils/logger.js';

// ============================================================================
// OpenAI Responses API Response Type Definitions
// ============================================================================

/** OpenAI Responses API response structure */
export interface OpenAIResponsesAPIResponse {
  id?: string;
  created_at?: number;
  error?: {
    message: string;
    type: string;
    param: string | null;
    code: string;
  } | null;
  model?: string;
  output?: Array<OpenAIResponsesOutputItem>;
  service_tier?: string | null;
  incomplete_details?: { reason: string } | null;
  usage?: {
    input_tokens: number;
    input_tokens_details?: {
      cached_tokens: number | null;
    } | null;
    output_tokens: number;
    output_tokens_details?: {
      reasoning_tokens: number | null;
    } | null;
  };
}

/** Union type for all output items in Responses API */
type OpenAIResponsesOutputItem =
  | OpenAIResponsesMessageOutput
  | OpenAIResponsesFunctionCallOutput
  | OpenAIResponsesReasoningOutput;

interface OpenAIResponsesMessageOutput {
  type: 'message';
  role: 'assistant';
  id: string;
  content: Array<{
    type: 'output_text';
    text: string;
    logprobs?: Array<{
      token: string;
      logprob: number;
      top_logprobs: Array<{
        token: string;
        logprob: number;
      }>;
    }> | null;
    annotations: Array<{
      type: 'url_citation' | 'file_citation';
      start_index: number;
      end_index: number;
      url?: string;
      title?: string;
      file_citation?: {
        file_id: string;
        quote: string;
      };
    }>;
  }>;
}

interface OpenAIResponsesFunctionCallOutput {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
  id: string;
}

interface OpenAIResponsesReasoningOutput {
  type: 'reasoning';
  id: string;
  encrypted_content: string | null;
  summary: Array<{
    type: 'summary_text';
    text: string;
  }>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build annotations array from sources.
 */
function buildAnnotationsForText(
  sources: Array<any>
): Array<{
  type: 'url_citation';
  start_index: number;
  end_index: number;
  url: string;
  title: string;
}> {
  logger.debug(`Building annotations for text from ${sources?.length || 0} source(s)`);

  if (!sources || sources.length === 0) {
    logger.debug('No sources provided, returning empty annotations array');
    return [];
  }

  const annotations: Array<{
    type: 'url_citation';
    start_index: number;
    end_index: number;
    url: string;
    title: string;
  }> = [];

  for (const source of sources) {
    if (source.sourceType === 'url') {
      annotations.push({
        type: 'url_citation',
        start_index: 0,
        end_index: 0,
        url: source.url,
        title: source.title || '',
      });
      logger.debug(`Added annotation for URL: ${source.url}`);
    }
  }

  logger.debug(`Built ${annotations.length} annotation(s)`);
  return annotations;
}

// ============================================================================
// Main Conversion Function
// ============================================================================

/**
 * Convert a GenerateTextResult to OpenAI Responses API response format.
 *
 * @param result - GenerateTextResult from AI SDK's generateText()
 * @returns OpenAI Responses API response object
 *
 * @example
 * ```typescript
 * const result = await generateText({
 *   model: openai('gpt-4'),
 *   prompt: 'Hello',
 * });
 *
 * const openaiResponse = convertToOpenAIResponsesResponse(result);
 * console.log(openaiResponse.output);
 * ```
 */
export function convertToOpenAIResponsesResponse(
  result: any
): OpenAIResponsesAPIResponse {
  logger.info('Starting conversion from GenerateTextResult to OpenAI Responses API response format');
  logger.debug(`Result has ${result.content?.length || 0} content part(s), finishReason: ${result.finishReason || 'none'}`);

  const output: Array<OpenAIResponsesOutputItem> = [];
  let currentTextContent: string[] = [];
  const annotations = buildAnnotationsForText(result.sources || []);
  
  if (annotations.length > 0) {
    logger.debug(`Built ${annotations.length} annotation(s) from sources`);
  }

  // Helper to flush accumulated text content
  const flushTextContent = () => {
    if (currentTextContent.length > 0) {
      const textContent = currentTextContent.join('');
      output.push({
        type: 'message',
        role: 'assistant',
        id: generateId(),
        content: [
          {
            type: 'output_text',
            text: textContent,
            logprobs: null,
            annotations: annotations,
          },
        ],
      });
      logger.debug(`Flushed text content with ${textContent.length} characters and ${annotations.length} annotation(s)`);
      currentTextContent = [];
    }
  };

  // Process content array
  if (result.content && Array.isArray(result.content)) {
    logger.debug(`Processing ${result.content.length} content part(s)`);

    for (let i = 0; i < result.content.length; i++) {
      const part = result.content[i];
      logger.debug(`Processing content part ${i + 1} of type: ${part.type}`);

      if (part.type === 'text') {
        currentTextContent.push(part.text);
        logger.debug(`Added text content, current total: ${currentTextContent.join('').length} characters`);
      } else if (part.type === 'reasoning') {
        // Flush any accumulated text first
        flushTextContent();

        // Add reasoning as separate output item
        output.push({
          type: 'reasoning',
          id: generateId(),
          encrypted_content: null,
          summary: [
            {
              type: 'summary_text',
              text: part.text,
            },
          ],
        });
        logger.debug(`Added reasoning output item with ${part.text.length} characters`);
      } else if (part.type === 'tool-call') {
        // Flush any accumulated text first
        flushTextContent();

        // Add function call as separate output item
        const callId = part.toolCallId || generateId();
        output.push({
          type: 'function_call',
          call_id: callId,
          name: part.toolName,
          arguments: JSON.stringify(part.input || {}),
          id: generateId(),
        });
        logger.debug(`Added function call output item for '${part.toolName}' with call ID '${callId}'`);
      }
      // Ignore: tool-result, file, source (sources handled in annotations)
    }
  } else {
    logger.debug('No content array found in result');
  }

  // Flush any remaining text content
  flushTextContent();

  // If no output items were created, add an empty message
  if (output.length === 0) {
    logger.debug('No output items created, adding empty message');
    output.push({
      type: 'message',
      role: 'assistant',
      id: generateId(),
      content: [
        {
          type: 'output_text',
          text: '',
          logprobs: null,
          annotations: [],
        },
      ],
    });
  }

  // Build usage object
  const usage = result.usage
    ? {
        input_tokens: result.usage.inputTokens || 0,
        input_tokens_details:
          result.usage.inputTokenDetails?.cacheReadTokens != null
            ? {
                cached_tokens: result.usage.inputTokenDetails.cacheReadTokens,
              }
            : null,
        output_tokens: result.usage.outputTokens || 0,
        output_tokens_details:
          result.usage.outputTokenDetails?.reasoningTokens != null
            ? {
                reasoning_tokens:
                  result.usage.outputTokenDetails.reasoningTokens,
              }
            : null,
      }
    : undefined;

  if (usage) {
    logger.debug(`Built usage object: input=${usage.input_tokens}, output=${usage.output_tokens}`);
  }

  // Determine if response is incomplete
  const incompleteDetails =
    result.finishReason && result.finishReason !== 'stop'
      ? { reason: result.finishReason }
      : null;

  if (incompleteDetails) {
    logger.debug(`Response is incomplete, reason: ${incompleteDetails.reason}`);
  }

  // Build response
  const response: OpenAIResponsesAPIResponse = {
    id: result.response?.id || generateId(),
    created_at: Math.floor(Date.now() / 1000),
    error: null,
    model: result.response?.model || result.request?.model,
    output,
    service_tier: null,
    incomplete_details: incompleteDetails,
    usage,
  };

  logger.info(`Conversion completed successfully. Generated ${output.length} output item(s), model: ${response.model || 'unknown'}`);
  return response;
}
