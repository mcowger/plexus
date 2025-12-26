import type { LanguageModelV2Usage } from '@ai-sdk/provider';
import type { FinishReason } from 'ai';
import type { StreamTextResult, TextStreamPart, ToolSet } from 'ai';
import { JsonToSseTransformStream } from 'ai';

// ============================================================================
// Google Generative AI Streaming Response Type Definitions
// ============================================================================

/** Google Generative AI streaming chunk structure */
interface GoogleGenerativeAIStreamChunk {
  candidates: Array<{
    content: {
      parts: Array<
        | { text: string }
        | { text: string; thought: true; thoughtSignature?: string }
        | { functionCall: { name: string; args: unknown } }
      >;
      role: 'model';
    };
    finishReason?: string;
    index: number;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
    cachedContentTokenCount?: number;
    thoughtsTokenCount?: number;
  };
}

// ============================================================================
// State Management
// ============================================================================

interface GoogleGenerativeAIState {
  activeToolCalls: Map<
    string,
    {
      name: string;
      arguments: string;
    }
  >;
  bufferedReasoning: string | null;
  currentReasoningId: string | null;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Map unified finish reason to Google finish reason.
 */
function mapFinishReason(finishReason: FinishReason): string {
  switch (finishReason) {
    case 'stop':
      return 'STOP';
    case 'length':
      return 'MAX_TOKENS';
    case 'tool-calls':
      return 'FUNCTION_CALL';
    case 'content-filter':
      return 'SAFETY';
    case 'error':
    case 'other':
    case 'unknown':
      return 'OTHER';
    default:
      return 'OTHER';
  }
}

/**
 * Parse tool arguments JSON string.
 */
function parseToolArguments(argsJson: string): unknown {
  try {
    return JSON.parse(argsJson);
  } catch {
    // If parsing fails, return empty object
    return {};
  }
}

/**
 * Create a chunk with the given parts array.
 */
function createChunk(
  parts: Array<
    | { text: string }
    | { text: string; thought: true; thoughtSignature?: string }
    | { functionCall: { name: string; args: unknown } }
  >
): GoogleGenerativeAIStreamChunk {
  return {
    candidates: [
      {
        content: {
          parts,
          role: 'model',
        },
        index: 0,
      },
    ],
  };
}

// ============================================================================
// Main Conversion Function
// ============================================================================

/**
 * Converts a StreamTextResult to Google Generative AI streaming format.
 *
 * The output is a ReadableStream of Server-Sent Events (SSE) in the format
 * expected by Google's Generative AI API streaming response.
 *
 * @param result - The StreamTextResult from AI SDK's streamText function
 * @param options - Optional configuration
 * @returns A ReadableStream<Uint8Array> that can be returned as an HTTP response
 *
 * @example
 * ```typescript
 * const result = streamText({ model, messages });
 * const stream = convertToGoogleGenerativeAIStream(result);
 * return new Response(stream, {
 *   headers: { 'Content-Type': 'text/event-stream' }
 * });
 * ```
 */
export function convertToGoogleGenerativeAIStream<TOOLS extends ToolSet, OUTPUT>(
  result: StreamTextResult<TOOLS, OUTPUT>,
  options?: Record<string, never>
): ReadableStream<Uint8Array> {
  const transformStream = new TransformStream<
    TextStreamPart<TOOLS>,
    GoogleGenerativeAIStreamChunk
  >({
    start(controller) {
      const state: GoogleGenerativeAIState = {
        activeToolCalls: new Map(),
        bufferedReasoning: null,
        currentReasoningId: null,
      };

      // Store state on controller
      (controller as any).state = state;
    },

    transform(part, controller) {
      const state: GoogleGenerativeAIState = (controller as any).state;

      switch (part.type) {
        case 'text-delta': {
          // Emit text chunk immediately
          controller.enqueue(createChunk([{ text: part.text }]));
          break;
        }

        case 'reasoning-start': {
          // Start buffering reasoning
          state.bufferedReasoning = '';
          state.currentReasoningId = part.id;
          break;
        }

        case 'reasoning-delta': {
          // Accumulate reasoning text
          if (state.bufferedReasoning !== null) {
            state.bufferedReasoning += part.text;
          }
          break;
        }

        case 'reasoning-end': {
          // Emit buffered reasoning as thought
          if (
            state.bufferedReasoning !== null &&
            state.bufferedReasoning.length > 0
          ) {
            const thoughtPart: {
              text: string;
              thought: true;
              thoughtSignature?: string;
            } = {
              text: state.bufferedReasoning,
              thought: true,
            };

            // Add thought signature if available from provider metadata
            const signature = part.providerMetadata?.google?.thoughtSignature;
            if (signature && typeof signature === 'string') {
              thoughtPart.thoughtSignature = signature;
            }

            controller.enqueue(createChunk([thoughtPart]));
          }

          // Clear buffer
          state.bufferedReasoning = null;
          state.currentReasoningId = null;
          break;
        }

        case 'tool-input-start': {
          // Start accumulating tool call
          state.activeToolCalls.set(part.id, {
            name: part.toolName,
            arguments: '',
          });
          break;
        }

        case 'tool-input-delta': {
          // Accumulate arguments
          const toolCall = state.activeToolCalls.get(part.id);
          if (toolCall) {
            toolCall.arguments += part.delta;
          }
          break;
        }

        case 'tool-input-end': {
          // Emit complete function call
          const toolCall = state.activeToolCalls.get(part.id);
          if (toolCall) {
            controller.enqueue(
              createChunk([
                {
                  functionCall: {
                    name: toolCall.name,
                    args: parseToolArguments(toolCall.arguments),
                  },
                },
              ])
            );
            state.activeToolCalls.delete(part.id);
          }
          break;
        }

        case 'finish': {
          // Emit final chunk with finish reason and usage
          const chunk: GoogleGenerativeAIStreamChunk = {
            candidates: [
              {
                content: {
                  parts: [],
                  role: 'model',
                },
                finishReason: mapFinishReason(part.finishReason ?? 'stop'),
                index: 0,
              },
            ],
          };

          // Add usage metadata if available
          if (part.totalUsage) {
            const usage = part.totalUsage as LanguageModelV2Usage;
            chunk.usageMetadata = {
              promptTokenCount: usage.inputTokens || 0,
              candidatesTokenCount: usage.outputTokens || 0,
              totalTokenCount: usage.totalTokens || 0,
            };

            // Add cached content token count if available
            if (usage.cachedInputTokens != null) {
              chunk.usageMetadata.cachedContentTokenCount =
                usage.cachedInputTokens;
            }

            // Add thoughts token count if available (reasoning tokens)
            if (usage.reasoningTokens != null) {
              chunk.usageMetadata.thoughtsTokenCount = usage.reasoningTokens;
            }
          }

          controller.enqueue(chunk);
          break;
        }

        case 'error': {
          // Emit error as finish with ERROR reason
          controller.enqueue({
            candidates: [
              {
                content: {
                  parts: [],
                  role: 'model',
                },
                finishReason: 'OTHER',
                index: 0,
              },
            ],
          });
          break;
        }

        case 'abort': {
          // Emit abort as STOP
          controller.enqueue({
            candidates: [
              {
                content: {
                  parts: [],
                  role: 'model',
                },
                finishReason: 'STOP',
                index: 0,
              },
            ],
          });
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

  // Pipe through transformations: fullStream → chunks → SSE → bytes
  return result.fullStream
    .pipeThrough(transformStream)
    .pipeThrough(new JsonToSseTransformStream())
    .pipeThrough(new TextEncoderStream());
}
