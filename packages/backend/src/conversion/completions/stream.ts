import type { LanguageModelV2Usage } from '@ai-sdk/provider';
import type { FinishReason } from 'ai';
import type { StreamTextResult, TextStreamPart, ToolSet } from 'ai';
import { JsonToSseTransformStream } from 'ai';

// ============================================================================
// OpenAI Chat Completions Streaming Response Type Definitions
// ============================================================================

/** OpenAI Chat Completions streaming chunk structure */
interface OpenAIChatStreamChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: 'assistant';
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: {
      cached_tokens: number;
    };
    completion_tokens_details?: {
      reasoning_tokens: number;
    };
  };
}

// ============================================================================
// State Management
// ============================================================================

interface OpenAIChatState {
  streamId: string;
  created: number;
  model: string;
  toolCallIndex: number;
  toolCalls: Map<
    string,
    {
      index: number;
      name: string;
      arguments: string;
    }
  >;
  sentRole: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique ID with a prefix.
 */
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Map unified finish reason to OpenAI Chat finish reason.
 */
function mapFinishReason(finishReason: FinishReason): string {
  switch (finishReason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'tool-calls':
      return 'tool_calls';
    case 'content-filter':
      return 'content_filter';
    case 'error':
    case 'other':
    case 'unknown':
      return 'stop';
    default:
      return 'stop';
  }
}

/**
 * Create a basic chunk with state information.
 */
function createBaseChunk(state: OpenAIChatState): OpenAIChatStreamChunk {
  return {
    id: state.streamId,
    object: 'chat.completion.chunk',
    created: state.created,
    model: state.model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: null,
      },
    ],
  };
}

/**
 * Get or create a tool call tracking entry.
 */
function getOrCreateToolCall(
  state: OpenAIChatState,
  toolId: string,
  toolName: string
): number {
  const existing = state.toolCalls.get(toolId);
  if (existing) {
    return existing.index;
  }

  const index = state.toolCallIndex++;
  state.toolCalls.set(toolId, {
    index,
    name: toolName,
    arguments: '',
  });
  return index;
}

// ============================================================================
// Main Conversion Function
// ============================================================================

/**
 * Converts a StreamTextResult to OpenAI Chat Completions streaming format.
 *
 * The output is a ReadableStream of Server-Sent Events (SSE) in the format
 * expected by OpenAI's Chat Completions API streaming response.
 *
 * @param result - The StreamTextResult from AI SDK's streamText function
 * @param options - Optional configuration (e.g., model name)
 * @returns A ReadableStream<Uint8Array> that can be returned as an HTTP response
 *
 * @example
 * ```typescript
 * const result = streamText({ model, messages });
 * const stream = convertToOpenAIChatStream(result, { model: 'gpt-4' });
 * return new Response(stream, {
 *   headers: { 'Content-Type': 'text/event-stream' }
 * });
 * ```
 */
export function convertToOpenAIChatStream<TOOLS extends ToolSet, OUTPUT>(
  result: StreamTextResult<TOOLS, OUTPUT>,
  options?: { model?: string }
): ReadableStream<Uint8Array> {
  const transformStream = new TransformStream<
    TextStreamPart<TOOLS>,
    OpenAIChatStreamChunk
  >({
    start(controller) {
      const state: OpenAIChatState = {
        streamId: generateId('chatcmpl'),
        created: Math.floor(Date.now() / 1000),
        model: options?.model ?? 'gpt-4',
        toolCallIndex: 0,
        toolCalls: new Map(),
        sentRole: false,
      };

      // Store state on controller for access in transform
      (controller as any).state = state;
    },

    transform(part, controller) {
      const state: OpenAIChatState = (controller as any).state;

      switch (part.type) {
        case 'text-delta': {
          // Send role delta on first text chunk
          if (!state.sentRole) {
            const roleChunk = createBaseChunk(state);
            roleChunk.choices[0].delta.role = 'assistant';
            controller.enqueue(roleChunk);
            state.sentRole = true;
          }

          // Send text delta
          const chunk = createBaseChunk(state);
          chunk.choices[0].delta.content = part.text;
          controller.enqueue(chunk);
          break;
        }

        case 'reasoning-delta': {
          // OpenAI Chat doesn't have separate reasoning - combine with content
          if (!state.sentRole) {
            const roleChunk = createBaseChunk(state);
            roleChunk.choices[0].delta.role = 'assistant';
            controller.enqueue(roleChunk);
            state.sentRole = true;
          }

          const chunk = createBaseChunk(state);
          chunk.choices[0].delta.content = part.text;
          controller.enqueue(chunk);
          break;
        }

        case 'tool-input-start': {
          const toolIndex = getOrCreateToolCall(state, part.id, part.toolName);

          // Emit tool call start with id, type, and name
          const chunk = createBaseChunk(state);
          chunk.choices[0].delta.tool_calls = [
            {
              index: toolIndex,
              id: part.id,
              type: 'function',
              function: {
                name: part.toolName,
                arguments: '',
              },
            },
          ];
          controller.enqueue(chunk);
          break;
        }

        case 'tool-input-delta': {
          const toolCall = state.toolCalls.get(part.id);
          if (toolCall) {
            // Accumulate arguments
            toolCall.arguments += part.delta;

            // Emit delta with incremental arguments
            const chunk = createBaseChunk(state);
            chunk.choices[0].delta.tool_calls = [
              {
                index: toolCall.index,
                function: {
                  arguments: part.delta,
                },
              },
            ];
            controller.enqueue(chunk);
          }
          break;
        }

        case 'finish': {
          // Emit final chunk with finish_reason and usage
          const chunk = createBaseChunk(state);
          chunk.choices[0].finish_reason = mapFinishReason(
            part.finishReason ?? 'stop'
          );

          // Add usage if available
          if (part.totalUsage) {
            const usage = part.totalUsage as LanguageModelV2Usage;
            chunk.usage = {
              prompt_tokens: usage.inputTokens || 0,
              completion_tokens: usage.outputTokens || 0,
              total_tokens: usage.totalTokens || 0,
            };

            // Add cached tokens if available
            if (usage.cachedInputTokens != null) {
              chunk.usage.prompt_tokens_details = {
                cached_tokens: usage.cachedInputTokens,
              };
            }

            // Add reasoning tokens if available
            if (usage.reasoningTokens != null) {
              chunk.usage.completion_tokens_details = {
                reasoning_tokens: usage.reasoningTokens,
              };
            }
          }

          controller.enqueue(chunk);
          break;
        }

        case 'error': {
          // Emit error as finish with error reason
          const chunk = createBaseChunk(state);
          chunk.choices[0].finish_reason = 'stop';
          controller.enqueue(chunk);
          break;
        }

        case 'abort': {
          // Emit abort as finish with stop reason
          const chunk = createBaseChunk(state);
          chunk.choices[0].finish_reason = 'stop';
          controller.enqueue(chunk);
          break;
        }

        // Ignore other event types (tool-result, start, etc.)
        default:
          break;
      }
    },

    flush(controller) {
      // Cleanup: remove state reference
      delete (controller as any).state;
    },
  });

  // Pipe through transformations: fullStream → chunks → SSE → bytes
  return result.fullStream
    .pipeThrough(transformStream)
    .pipeThrough(new JsonToSseTransformStream())
    .pipeThrough(new TextEncoderStream());
}
