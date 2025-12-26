import type { LanguageModelV2Usage } from '@ai-sdk/provider';
import { generateId } from '@ai-sdk/provider-utils';
import type { FinishReason } from 'ai';
import type { StreamTextResult, TextStreamPart, ToolSet } from 'ai';

// ============================================================================
// Anthropic Messages API Streaming Response Type Definitions
// ============================================================================

/** Anthropic Messages API streaming chunk structure */
type AnthropicMessagesStreamChunk =
  | {
      type: 'message_start';
      message: {
        id: string;
        model: string;
        role: 'assistant';
        usage: {
          input_tokens: number;
          cache_creation_input_tokens?: number | null;
          cache_read_input_tokens?: number | null;
        };
      };
    }
  | {
      type: 'content_block_start';
      index: number;
      content_block:
        | { type: 'text'; text: string }
        | { type: 'thinking'; thinking: string }
        | { type: 'tool_use'; id: string; name: string; input: object };
    }
  | {
      type: 'content_block_delta';
      index: number;
      delta:
        | { type: 'text_delta'; text: string }
        | { type: 'thinking_delta'; thinking: string }
        | { type: 'input_json_delta'; partial_json: string };
    }
  | {
      type: 'content_block_stop';
      index: number;
    }
  | {
      type: 'message_delta';
      delta: {
        stop_reason: string | null;
      };
      usage: {
        output_tokens: number;
      };
    }
  | {
      type: 'message_stop';
    };

// ============================================================================
// State Management
// ============================================================================

interface AnthropicMessagesState {
  messageId: string;
  model: string;
  contentBlockIndex: number;
  activeBlocks: Map<
    string,
    {
      index: number;
      type: 'text' | 'thinking' | 'tool_use';
      toolId?: string;
    }
  >;
  inputTokens: number;
  outputTokens: number;
  sentMessageStart: boolean;
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
 * Map unified finish reason to Anthropic stop reason.
 */
function mapFinishReason(finishReason: FinishReason): string {
  switch (finishReason) {
    case 'stop':
      return 'end_turn';
    case 'length':
      return 'max_tokens';
    case 'tool-calls':
      return 'tool_use';
    case 'content-filter':
      return 'safety';
    case 'error':
      return 'error';
    case 'other':
    case 'unknown':
      return 'end_turn';
    default:
      return 'end_turn';
  }
}

/**
 * Create a content block start object.
 */
function createContentBlockStart(
  index: number,
  type: 'text' | 'thinking' | 'tool_use',
  extras: { toolId?: string; toolName?: string } = {}
): AnthropicMessagesStreamChunk {
  if (type === 'text') {
    return {
      type: 'content_block_start',
      index,
      content_block: {
        type: 'text',
        text: '',
      },
    };
  } else if (type === 'thinking') {
    return {
      type: 'content_block_start',
      index,
      content_block: {
        type: 'thinking',
        thinking: '',
      },
    };
  } else {
    return {
      type: 'content_block_start',
      index,
      content_block: {
        type: 'tool_use',
        id: extras.toolId || '',
        name: extras.toolName || '',
        input: {},
      },
    };
  }
}

// ============================================================================
// Main Conversion Function
// ============================================================================

/**
 * Converts a StreamTextResult to Anthropic Messages API streaming format.
 *
 * The output is a ReadableStream of Server-Sent Events (SSE) in the format
 * expected by Anthropic's Messages API streaming response.
 *
 * @param result - The StreamTextResult from AI SDK's streamText function
 * @param options - Optional configuration (e.g., model name)
 * @returns A ReadableStream<Uint8Array> that can be returned as an HTTP response
 *
 * @example
 * ```typescript
 * const result = streamText({ model, messages });
 * const stream = convertToAnthropicMessagesStream(result, { model: 'claude-3-5-sonnet-20241022' });
 * return new Response(stream, {
 *   headers: { 'Content-Type': 'text/event-stream' }
 * });
 * ```
 */
export function convertToAnthropicMessagesStream<TOOLS extends ToolSet, OUTPUT>(
  result: StreamTextResult<TOOLS, OUTPUT>,
  options?: { model?: string }
): ReadableStream<Uint8Array> {
  const transformStream = new TransformStream<
    TextStreamPart<TOOLS>,
    { event: string; data: unknown }
  >({
    start(controller) {
      const state: AnthropicMessagesState = {
        messageId: generateId(),
        model: options?.model ?? 'claude-3-5-sonnet-20241022',
        contentBlockIndex: 0,
        activeBlocks: new Map(),
        inputTokens: 0,
        outputTokens: 0,
        sentMessageStart: false,
      };

      // Store state on controller
      (controller as any).state = state;
    },

    transform(part, controller) {
      const state: AnthropicMessagesState = (controller as any).state;

      // Send message_start on first event with usage info
      if (!state.sentMessageStart && part.type !== 'start') {
        // We'll send message_start when we get usage info from finish-step or have content
        if (part.type === 'finish-step' && part.usage) {
          const usage = part.usage as LanguageModelV2Usage;
          state.inputTokens = usage.inputTokens || 0;
        }

        // Send message_start
        const usage =
          part.type === 'finish-step'
            ? (part.usage as LanguageModelV2Usage | undefined)
            : undefined;
        controller.enqueue({
          event: 'message_start',
          data: {
            type: 'message_start',
            message: {
              id: state.messageId,
              model: state.model,
              role: 'assistant',
              usage: {
                input_tokens: state.inputTokens,
                cache_creation_input_tokens: null,
                cache_read_input_tokens: usage?.cachedInputTokens ?? null,
              },
            },
          },
        });
        state.sentMessageStart = true;
      }

      switch (part.type) {
        case 'text-start': {
          const index = state.contentBlockIndex++;
          state.activeBlocks.set(part.id, {
            index,
            type: 'text',
          });

          controller.enqueue({
            event: 'content_block_start',
            data: createContentBlockStart(index, 'text'),
          });
          break;
        }

        case 'text-delta': {
          const block = state.activeBlocks.get(part.id);
          if (block) {
            controller.enqueue({
              event: 'content_block_delta',
              data: {
                type: 'content_block_delta',
                index: block.index,
                delta: {
                  type: 'text_delta',
                  text: part.text,
                },
              },
            });
          }
          break;
        }

        case 'text-end': {
          const block = state.activeBlocks.get(part.id);
          if (block) {
            controller.enqueue({
              event: 'content_block_stop',
              data: {
                type: 'content_block_stop',
                index: block.index,
              },
            });
            state.activeBlocks.delete(part.id);
          }
          break;
        }

        case 'reasoning-start': {
          const index = state.contentBlockIndex++;
          state.activeBlocks.set(part.id, {
            index,
            type: 'thinking',
          });

          controller.enqueue({
            event: 'content_block_start',
            data: createContentBlockStart(index, 'thinking'),
          });
          break;
        }

        case 'reasoning-delta': {
          const block = state.activeBlocks.get(part.id);
          if (block) {
            controller.enqueue({
              event: 'content_block_delta',
              data: {
                type: 'content_block_delta',
                index: block.index,
                delta: {
                  type: 'thinking_delta',
                  thinking: part.text,
                },
              },
            });
          }
          break;
        }

        case 'reasoning-end': {
          const block = state.activeBlocks.get(part.id);
          if (block) {
            controller.enqueue({
              event: 'content_block_stop',
              data: {
                type: 'content_block_stop',
                index: block.index,
              },
            });
            state.activeBlocks.delete(part.id);
          }
          break;
        }

        case 'tool-input-start': {
          const index = state.contentBlockIndex++;
          state.activeBlocks.set(part.id, {
            index,
            type: 'tool_use',
            toolId: part.id,
          });

          controller.enqueue({
            event: 'content_block_start',
            data: createContentBlockStart(index, 'tool_use', {
              toolId: part.id,
              toolName: part.toolName,
            }),
          });
          break;
        }

        case 'tool-input-delta': {
          const block = state.activeBlocks.get(part.id);
          if (block) {
            controller.enqueue({
              event: 'content_block_delta',
              data: {
                type: 'content_block_delta',
                index: block.index,
                delta: {
                  type: 'input_json_delta',
                  partial_json: part.delta,
                },
              },
            });
          }
          break;
        }

        case 'tool-input-end': {
          const block = state.activeBlocks.get(part.id);
          if (block) {
            controller.enqueue({
              event: 'content_block_stop',
              data: {
                type: 'content_block_stop',
                index: block.index,
              },
            });
            state.activeBlocks.delete(part.id);
          }
          break;
        }

        case 'finish': {
          // Update output tokens
          if (part.totalUsage) {
            const usage = part.totalUsage as LanguageModelV2Usage;
            state.outputTokens = usage.outputTokens || 0;
          }

          // Send message_delta with stop_reason and output tokens
          controller.enqueue({
            event: 'message_delta',
            data: {
              type: 'message_delta',
              delta: {
                stop_reason: mapFinishReason(part.finishReason ?? 'stop'),
              },
              usage: {
                output_tokens: state.outputTokens,
              },
            },
          });

          // Send message_stop
          controller.enqueue({
            event: 'message_stop',
            data: {
              type: 'message_stop',
            },
          });
          break;
        }

        case 'error': {
          // Emit error as stop
          controller.enqueue({
            event: 'message_delta',
            data: {
              type: 'message_delta',
              delta: {
                stop_reason: 'error',
              },
              usage: {
                output_tokens: state.outputTokens,
              },
            },
          });

          controller.enqueue({
            event: 'message_stop',
            data: {
              type: 'message_stop',
            },
          });
          break;
        }

        case 'abort': {
          // Emit abort as end_turn
          controller.enqueue({
            event: 'message_delta',
            data: {
              type: 'message_delta',
              delta: {
                stop_reason: 'end_turn',
              },
              usage: {
                output_tokens: state.outputTokens,
              },
            },
          });

          controller.enqueue({
            event: 'message_stop',
            data: {
              type: 'message_stop',
            },
          });
          break;
        }

        // Capture usage from finish-step for message_start
        case 'finish-step': {
          if (!state.sentMessageStart && part.usage) {
            const usage = part.usage as LanguageModelV2Usage;
            state.inputTokens = usage.inputTokens || 0;
          }
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
