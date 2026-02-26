import { Part } from '@google/genai';
import { encode } from 'eventsource-encoder';

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

  const transformer = new TransformStream({
    transform(chunk: any, controller) {
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
                prompt_tokens: chunk.usage.input_tokens,
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

      if (chunk.delta?.content) parts.push({ text: chunk.delta.content });
      if (chunk.delta?.reasoning_content)
        parts.push({
          text: chunk.delta.reasoning_content,
          thought: true,
        } as any);
      if (chunk.delta?.tool_calls) {
        chunk.delta.tool_calls.forEach((tc: any) => {
          let parsedArgs: Record<string, unknown> = {};
          const rawArgs = tc.function?.arguments;

          if (typeof rawArgs === 'string' && rawArgs.trim().length > 0) {
            try {
              parsedArgs = JSON.parse(rawArgs);
            } catch {
              // Tool arguments can arrive as partial JSON during streaming.
              parsedArgs = {};
            }
          } else if (rawArgs && typeof rawArgs === 'object') {
            parsedArgs = rawArgs;
          }

          parts.push({
            functionCall: {
              name: tc.function.name,
              args: parsedArgs,
            },
          });
        });
      }

      if (parts.length > 0 || chunk.finish_reason || chunk.usage) {
        const geminiChunk: any = {
          candidates: [
            {
              content: { role: 'model', parts },
              finishReason: chunk.finish_reason?.toUpperCase() || null,
              index: 0,
            },
          ],
          usageMetadata: chunk.usage
            ? {
                promptTokenCount: chunk.usage.input_tokens,
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
      }
    },
  });

  return stream.pipeThrough(transformer);
}
