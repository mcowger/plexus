import type { LanguageModelV2Usage } from '@ai-sdk/provider';
import { generateId } from '@ai-sdk/provider-utils';
import type { FinishReason } from 'ai';
import type { StreamTextResult, TextStreamPart, ToolSet } from 'ai';

// ============================================================================
// OpenAI Responses API Streaming Response Type Definitions
// ============================================================================

/** OpenAI Responses API streaming chunk structure */
type OpenAIResponsesStreamChunk =
  | {
      type: 'response.created';
      response: {
        id: string;
        created_at: number;
        model: string;
      };
    }
  | {
      type: 'response.output_item.added';
      output_index: number;
      item:
        | { type: 'message'; id: string; role: 'assistant' }
        | { type: 'reasoning'; id: string }
        | {
            type: 'function_call';
            id: string;
            call_id: string;
            name: string;
            arguments: string;
          };
    }
  | {
      type: 'response.output_text.delta';
      item_id: string;
      delta: string;
    }
  | {
      type: 'response.reasoning_summary_text.delta';
      item_id: string;
      summary_index: number;
      delta: string;
    }
  | {
      type: 'response.function_call_arguments.delta';
      item_id: string;
      output_index: number;
      delta: string;
    }
  | {
      type: 'response.output_item.done';
      output_index: number;
      item:
        | { type: 'message'; id: string; role: 'assistant' }
        | { type: 'reasoning'; id: string }
        | {
            type: 'function_call';
            id: string;
            call_id: string;
            name: string;
            arguments: string;
            status: 'completed';
          };
    }
  | {
      type: 'response.completed';
      response: {
        usage: {
          input_tokens: number;
          output_tokens: number;
          input_tokens_details?: {
            cached_tokens: number;
          } | null;
          output_tokens_details?: {
            reasoning_tokens: number;
          } | null;
        };
      };
    };

// ============================================================================
// State Management
// ============================================================================

interface OpenAIResponsesState {
  responseId: string;
  createdAt: number;
  model: string;
  outputIndex: number;
  itemIdMap: Map<string, string>;
  activeItems: Map<
    string,
    {
      type: 'message' | 'reasoning' | 'function_call';
      outputIndex: number;
      started: boolean;
      itemId: string;
      callId?: string;
      name?: string;
      arguments?: string;
    }
  >;
  reasoningSummaryIndex: number;
}

// ============================================================================
// Named SSE Transform Stream
// ============================================================================

class NamedSseTransformStream extends TransformStream<
  { event: string; data: unknown },
  string
> {
  constructor() {
    super({
      transform(chunk, controller) {
        controller.enqueue(`event: ${chunk.event}\n`);
        controller.enqueue(`data: ${JSON.stringify(chunk.data)}\n\n`);
      },
    });
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a named event object.
 */
function createNamedEvent(event: string, data: unknown): {
  event: string;
  data: unknown;
} {
  return { event, data };
}

// ============================================================================
// Main Conversion Function
// ============================================================================

/**
 * Converts a StreamTextResult to OpenAI Responses API streaming format.
 *
 * The output is a ReadableStream of Server-Sent Events (SSE) in the format
 * expected by OpenAI's Responses API streaming response.
 *
 * @param result - The StreamTextResult from AI SDK's streamText function
 * @param options - Optional configuration (e.g., model name)
 * @returns A ReadableStream<Uint8Array> that can be returned as an HTTP response
 *
 * @example
 * ```typescript
 * const result = streamText({ model, messages });
 * const stream = convertToOpenAIResponsesStream(result, { model: 'gpt-4' });
 * return new Response(stream, {
 *   headers: { 'Content-Type': 'text/event-stream' }
 * });
 * ```
 */
export function convertToOpenAIResponsesStream<TOOLS extends ToolSet, OUTPUT>(
  result: StreamTextResult<TOOLS, OUTPUT>,
  options?: { model?: string }
): ReadableStream<Uint8Array> {
  const transformStream = new TransformStream<
    TextStreamPart<TOOLS>,
    { event: string; data: unknown }
  >({
    start(controller) {
      const state: OpenAIResponsesState = {
        responseId: generateId(),
        createdAt: Math.floor(Date.now() / 1000),
        model: options?.model ?? 'gpt-4',
        outputIndex: 0,
        itemIdMap: new Map(),
        activeItems: new Map(),
        reasoningSummaryIndex: 0,
      };

      // Store state on controller
      (controller as any).state = state;

      // Emit response.created
      controller.enqueue(
        createNamedEvent('response.created', {
          type: 'response.created',
          response: {
            id: state.responseId,
            created_at: state.createdAt,
            model: state.model,
          },
        })
      );
    },

    transform(part, controller) {
      const state: OpenAIResponsesState = (controller as any).state;

      switch (part.type) {
        case 'text-start': {
          const itemId = generateId();
          const outputIndex = state.outputIndex++;

          state.itemIdMap.set(part.id, itemId);
          state.activeItems.set(part.id, {
            type: 'message',
            outputIndex,
            started: true,
            itemId,
          });

          // Emit output_item.added
          controller.enqueue(
            createNamedEvent('response.output_item.added', {
              type: 'response.output_item.added',
              output_index: outputIndex,
              item: {
                type: 'message',
                id: itemId,
                role: 'assistant',
              },
            })
          );
          break;
        }

        case 'text-delta': {
          const item = state.activeItems.get(part.id);
          if (item) {
            // Emit output_text.delta
            controller.enqueue(
              createNamedEvent('response.output_text.delta', {
                type: 'response.output_text.delta',
                item_id: item.itemId,
                delta: part.text,
              })
            );
          }
          break;
        }

        case 'text-end': {
          const item = state.activeItems.get(part.id);
          if (item) {
            // Emit output_item.done
            controller.enqueue(
              createNamedEvent('response.output_item.done', {
                type: 'response.output_item.done',
                output_index: item.outputIndex,
                item: {
                  type: 'message',
                  id: item.itemId,
                  role: 'assistant',
                },
              })
            );
            state.activeItems.delete(part.id);
          }
          break;
        }

        case 'reasoning-start': {
          const itemId = generateId();
          const outputIndex = state.outputIndex++;

          state.itemIdMap.set(part.id, itemId);
          state.activeItems.set(part.id, {
            type: 'reasoning',
            outputIndex,
            started: true,
            itemId,
          });

          // Emit output_item.added for reasoning
          controller.enqueue(
            createNamedEvent('response.output_item.added', {
              type: 'response.output_item.added',
              output_index: outputIndex,
              item: {
                type: 'reasoning',
                id: itemId,
              },
            })
          );
          break;
        }

        case 'reasoning-delta': {
          const item = state.activeItems.get(part.id);
          if (item) {
            // Emit reasoning_summary_text.delta
            controller.enqueue(
              createNamedEvent('response.reasoning_summary_text.delta', {
                type: 'response.reasoning_summary_text.delta',
                item_id: item.itemId,
                summary_index: state.reasoningSummaryIndex,
                delta: part.text,
              })
            );
          }
          break;
        }

        case 'reasoning-end': {
          const item = state.activeItems.get(part.id);
          if (item) {
            // Emit output_item.done
            controller.enqueue(
              createNamedEvent('response.output_item.done', {
                type: 'response.output_item.done',
                output_index: item.outputIndex,
                item: {
                  type: 'reasoning',
                  id: item.itemId,
                },
              })
            );
            state.activeItems.delete(part.id);
          }
          break;
        }

        case 'tool-input-start': {
          const itemId = generateId();
          const outputIndex = state.outputIndex++;

          state.itemIdMap.set(part.id, itemId);
          state.activeItems.set(part.id, {
            type: 'function_call',
            outputIndex,
            started: true,
            itemId,
            callId: part.id,
            name: part.toolName,
            arguments: '',
          });

          // Emit output_item.added for function_call
          controller.enqueue(
            createNamedEvent('response.output_item.added', {
              type: 'response.output_item.added',
              output_index: outputIndex,
              item: {
                type: 'function_call',
                id: itemId,
                call_id: part.id,
                name: part.toolName,
                arguments: '',
              },
            })
          );
          break;
        }

        case 'tool-input-delta': {
          const item = state.activeItems.get(part.id);
          if (item && item.type === 'function_call') {
            // Accumulate arguments
            item.arguments = (item.arguments || '') + part.delta;

            // Emit function_call_arguments.delta
            controller.enqueue(
              createNamedEvent('response.function_call_arguments.delta', {
                type: 'response.function_call_arguments.delta',
                item_id: item.itemId,
                output_index: item.outputIndex,
                delta: part.delta,
              })
            );
          }
          break;
        }

        case 'tool-input-end': {
          const item = state.activeItems.get(part.id);
          if (item && item.type === 'function_call') {
            // Emit output_item.done with complete function call
            controller.enqueue(
              createNamedEvent('response.output_item.done', {
                type: 'response.output_item.done',
                output_index: item.outputIndex,
                item: {
                  type: 'function_call',
                  id: item.itemId,
                  call_id: item.callId || '',
                  name: item.name || '',
                  arguments: item.arguments || '',
                  status: 'completed',
                },
              })
            );
            state.activeItems.delete(part.id);
          }
          break;
        }

        case 'finish': {
          // Emit response.completed with usage
          const usage = part.totalUsage as LanguageModelV2Usage | undefined;
          const usageData: any = {
            input_tokens: usage?.inputTokens || 0,
            output_tokens: usage?.outputTokens || 0,
          };

          // Add cached tokens if available
          if (usage?.cachedInputTokens != null) {
            usageData.input_tokens_details = {
              cached_tokens: usage.cachedInputTokens,
            };
          }

          // Add reasoning tokens if available
          if (usage?.reasoningTokens != null) {
            usageData.output_tokens_details = {
              reasoning_tokens: usage.reasoningTokens,
            };
          }

          controller.enqueue(
            createNamedEvent('response.completed', {
              type: 'response.completed',
              response: {
                usage: usageData,
              },
            })
          );
          break;
        }

        // Ignore other event types
        default:
          break;
      }
    },

    flush(controller) {
      // Cleanup
      delete (controller as any).state;
    },
  });

  // Pipe through transformations: fullStream → chunks → Named SSE → bytes
  return result.fullStream
    .pipeThrough(transformStream)
    .pipeThrough(new NamedSseTransformStream())
    .pipeThrough(new TextEncoderStream());
}
