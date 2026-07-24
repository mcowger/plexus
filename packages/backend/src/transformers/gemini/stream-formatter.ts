import { Part } from '@google/genai';
import { encode } from 'eventsource-encoder';

type PendingGeminiToolCall = {
  index?: number;
  id?: string;
  name?: string;
  argumentsText: string;
  structuredArguments?: unknown;
  thoughtSignature?: string;
  emitted: boolean;
};

function getToolCallKeys(toolCall: any, fallbackKey: string): string[] {
  const keys: string[] = [];

  if (typeof toolCall.index === 'number') {
    keys.push(`index:${toolCall.index}`);
  }

  if (typeof toolCall.id === 'string' && toolCall.id.trim().length > 0) {
    keys.push(`id:${toolCall.id}`);
  }

  if (keys.length === 0) {
    keys.push(fallbackKey);
  }

  return keys;
}

function resolveToolCallArguments(
  state: PendingGeminiToolCall,
  allowEmptyObject = false
): unknown | undefined {
  if (state.structuredArguments !== undefined) {
    return state.structuredArguments;
  }

  const rawArguments = state.argumentsText.trim();
  if (rawArguments.length === 0) {
    return allowEmptyObject ? {} : undefined;
  }

  try {
    return JSON.parse(rawArguments);
  } catch {
    return undefined;
  }
}

function buildGeminiFunctionCallPart(
  state: PendingGeminiToolCall,
  allowEmptyObject = false
): Part | null {
  if (!state.name) return null;

  const args = resolveToolCallArguments(state, allowEmptyObject);
  if (args === undefined) return null;

  const functionCallPart: any = {
    functionCall: {
      name: state.name,
      args,
    },
  };

  if (state.id) {
    functionCallPart.functionCall.id = state.id;
  }

  if (state.thoughtSignature) {
    functionCallPart.thoughtSignature = state.thoughtSignature;
  }

  return functionCallPart;
}

/**
 * Formats unified chunks back into Gemini's SSE format.
 *
 * Handles block lifecycle events by emitting proper SSE event types:
 * - message_start, message_delta, message_end
 * - text_start, text_delta, text_end
 * - thinking_start, thinking_delta, thinking_end
 * - toolcall_start, toolcall_delta, toolcall_end
 * - usage, done
 */
export function formatGeminiStream(stream: ReadableStream): ReadableStream {
  const encoder = new TextEncoder();
  const toolCallStates = new Map<string, PendingGeminiToolCall>();
  let hasSentError = false;

  const transformer = new TransformStream({
    transform(chunk: any, controller) {
      if (hasSentError) return;

      // Handle block lifecycle events
      if (chunk.event) {
        const eventName = chunk.event;
        const eventData: Record<string, any> = {};

        // Build event-specific data
        if (eventName === 'message_start') {
          eventData.type = 'message_start';
          eventData.message = {
            id: chunk.id || 'msg_' + Date.now(),
            type: 'message',
            role: chunk.delta?.role || 'assistant',
            model: chunk.model,
            content: [],
            usage: chunk.usage
              ? {
                  input_tokens: chunk.usage.input_tokens || 0,
                  output_tokens: chunk.usage.output_tokens || 0,
                }
              : { input_tokens: 0, output_tokens: 0 },
          };
        } else if (eventName === 'text_start') {
          eventData.type = 'text_start';
          eventData.index = 0;
        } else if (eventName === 'text_delta') {
          eventData.type = 'text_delta';
          eventData.delta = chunk.delta?.content || '';
          eventData.index = 0;
        } else if (eventName === 'text_end') {
          eventData.type = 'text_end';
          eventData.index = 0;
        } else if (eventName === 'thinking_start') {
          eventData.type = 'thinking_start';
          eventData.index = 0;
        } else if (eventName === 'thinking_delta') {
          eventData.type = 'thinking_delta';
          eventData.delta = chunk.delta?.reasoning_content || '';
          eventData.index = 0;
        } else if (eventName === 'thinking_end') {
          eventData.type = 'thinking_end';
          eventData.index = 0;
        } else if (eventName === 'toolcall_start') {
          eventData.type = 'toolcall_start';
          eventData.index = 0;
        } else if (eventName === 'toolcall_delta') {
          eventData.type = 'toolcall_delta';
          const tc = chunk.delta?.tool_calls?.[0];
          eventData.delta = tc
            ? {
                name: tc.function?.name || '',
                args: tc.function?.arguments || '',
                id: tc.id || '',
              }
            : '';
          eventData.index = 0;
        } else if (eventName === 'toolcall_end') {
          eventData.type = 'toolcall_end';
          eventData.index = 0;
        } else if (eventName === 'message_end') {
          eventData.type = 'message_end';
        } else if (eventName === 'usage') {
          eventData.type = 'usage';
          eventData.usage = chunk.usage
            ? {
                prompt_tokens: chunk.usage.input_tokens + (chunk.usage.cached_tokens || 0),
                completion_tokens: chunk.usage.output_tokens,
                total_tokens: chunk.usage.total_tokens,
                prompt_tokens_details: {
                  cached_tokens: chunk.usage.cached_tokens || 0,
                  cache_write_tokens: 0,
                  audio_tokens: 0,
                  video_tokens: 0,
                },
                cost_details: {
                  upstream_inference_cost: chunk.usage.upstream_inference_cost || 0,
                  upstream_inference_prompt_cost: chunk.usage.upstream_inference_prompt_cost || 0,
                  upstream_inference_completions_cost:
                    chunk.usage.upstream_inference_completions_cost || 0,
                },
                completion_tokens_details: {
                  reasoning_tokens: chunk.usage.reasoning_tokens || 0,
                  image_tokens: 0,
                },
              }
            : undefined;
        } else if (eventName === 'error') {
          hasSentError = true;
          eventData.error = {
            code: chunk.error?.statusCode || 503,
            status: 'UNAVAILABLE',
            message: chunk.error?.message,
          };
        } else if (eventName === 'done') {
          eventData.type = 'done';
        }

        // Emit SSE event with event name
        const sseMessage = encode({
          event: eventName,
          data: JSON.stringify(eventData),
        });
        controller.enqueue(encoder.encode(sseMessage));
        return;
      }

      // Handle regular content chunks (non-event)
      const parts: Part[] = [];
      const completedToolCallParts: Part[] = [];

      if (chunk.delta?.content) parts.push({ text: chunk.delta.content });
      if (chunk.delta?.reasoning_content)
        parts.push({
          text: chunk.delta.reasoning_content,
          thought: true,
        } as any);

      if (chunk.delta?.tool_calls) {
        chunk.delta.tool_calls.forEach((tc: any, callPosition: number) => {
          const fallbackKey = `anon:${callPosition}`;
          const keys = getToolCallKeys(tc, fallbackKey);

          let state: PendingGeminiToolCall | undefined;
          for (const key of keys) {
            const existing = toolCallStates.get(key);
            if (existing) {
              state = existing;
              break;
            }
          }

          if (!state) {
            state = {
              argumentsText: '',
              emitted: false,
            };
          }

          for (const key of keys) {
            toolCallStates.set(key, state);
          }

          if (typeof tc.index === 'number') {
            state.index = tc.index;
          }
          if (typeof tc.id === 'string' && tc.id.trim().length > 0) {
            state.id = tc.id;
          }
          if (typeof tc.function?.name === 'string' && tc.function.name.trim().length > 0) {
            state.name = tc.function.name;
          }

          const rawArgs = tc.function?.arguments;
          if (typeof rawArgs === 'string') {
            state.argumentsText += rawArgs;
          } else if (rawArgs !== undefined) {
            state.structuredArguments = rawArgs;
          }

          const sig =
            tc.thinking?.signature ||
            tc.thought_signature ||
            tc.extra_content?.google?.thought_signature ||
            chunk.delta?.thinking?.signature ||
            chunk.delta?.thought_signature;
          if (sig) {
            state.thoughtSignature = sig;
          }

          const functionCallPart = buildGeminiFunctionCallPart(state);
          if (functionCallPart && !state.emitted) {
            state.emitted = true;
            completedToolCallParts.push(functionCallPart);
          }
        });
      }

      if (chunk.finish_reason) {
        for (const state of new Set(toolCallStates.values())) {
          if (state.emitted) continue;

          const functionCallPart = buildGeminiFunctionCallPart(state, true);
          if (functionCallPart) {
            state.emitted = true;
            completedToolCallParts.push(functionCallPart);
          }
        }
      }

      if (completedToolCallParts.length > 0) {
        parts.push(...completedToolCallParts);
      }

      // Map OpenAI-style finish_reason to valid Gemini values
      // TOOL_CALLS is not valid in Gemini - use STOP instead
      let geminiFinishReason = chunk.finish_reason?.toUpperCase();
      if (geminiFinishReason === 'TOOL_CALLS') {
        geminiFinishReason = 'STOP';
      }

      if (parts.length === 0 && !geminiFinishReason) {
        return;
      }

      const geminiChunk: any = {
        candidates: [
          {
            content: { role: 'model', parts: parts.length > 0 ? parts : [{ text: '' }] },
            finishReason: geminiFinishReason || null,
            index: 0,
          },
        ],
        usageMetadata: chunk.usage
          ? {
              promptTokenCount: chunk.usage.input_tokens + (chunk.usage.cached_tokens || 0),
              candidatesTokenCount: chunk.usage.output_tokens,
              totalTokenCount: chunk.usage.total_tokens,
              ...(chunk.usage.reasoning_tokens
                ? { thoughtsTokenCount: chunk.usage.reasoning_tokens }
                : {}),
              ...(chunk.usage.cached_tokens
                ? { cachedContentTokenCount: chunk.usage.cached_tokens }
                : {}),
            }
          : undefined,
      };
      if (chunk.model) geminiChunk.modelVersion = chunk.model;
      if (chunk.id) geminiChunk.responseId = chunk.id;
      const sseMessage = encode({ data: JSON.stringify(geminiChunk) });
      controller.enqueue(encoder.encode(sseMessage));
    },
  });

  return stream.pipeThrough(transformer);
}
