import { createParser, EventSourceMessage } from 'eventsource-parser';
import { logger } from '../../utils/logger';
import type { StreamBlockEventType } from '../../types/unified';
import { normalizeGeminiUsage } from '../../utils/usage-normalizer';

/**
 * Transforms a Gemini stream (Server-Sent Events) into unified stream format.
 *
 * Gemini streams are SSE-formatted with candidate chunks containing:
 * - parts array (text, thought, functionCall)
 * - finishReason
 * - usageMetadata
 *
 * This transformer:
 * 1. Parses SSE messages
 * 2. Converts to unified chunk format
 * 3. Handles text, reasoning, and tool call deltas
 * 4. Emits block lifecycle events (start, delta, end)
 */
export function transformGeminiStream(stream: ReadableStream): ReadableStream {
  const decoder = new TextDecoder();
  let parser: any;

  // Track active block state for lifecycle events
  let activeBlockType: 'text' | 'thinking' | 'toolcall' | null = null;
  let hasSentMessageStart = false;
  let messageHasFunctionCalls = false;
  let streamedToolCallCount = 0;

  const transformer = new TransformStream({
    start(controller) {
      parser = createParser({
        onEvent: (event: EventSourceMessage) => {
          if (event.data === '[DONE]') {
            // Emit message_end when stream is done
            if (activeBlockType) {
              const endEvent = {
                id: '',
                model: '',
                created: Date.now(),
                event: `${activeBlockType}_end` as StreamBlockEventType,
                delta: {},
              };
              logger.silly(
                `Gemini Transformer: Enqueueing unified chunk (${activeBlockType}_end)`,
                endEvent
              );
              controller.enqueue(endEvent);
              activeBlockType = null;
            }
            const doneEvent = {
              id: '',
              model: '',
              created: Date.now(),
              event: 'done' as StreamBlockEventType,
              delta: {},
            };
            logger.silly(`Gemini Transformer: Enqueueing unified chunk (done)`, doneEvent);
            controller.enqueue(doneEvent);
            messageHasFunctionCalls = false;
            streamedToolCallCount = 0;
            return;
          }

          try {
            const data = JSON.parse(event.data);
            const candidate = data.candidates?.[0];

            // If we have usage but no candidate, it's a usage-only chunk (common in Gemini 1.5+)
            if (!candidate && data.usageMetadata) {
              const usage = normalizeGeminiUsage(data.usageMetadata);
              const chunk = {
                id: data.responseId,
                model: data.modelVersion,
                created: Date.now(),
                event: 'usage' as StreamBlockEventType,
                delta: {},
                usage: {
                  input_tokens: usage.input_tokens,
                  output_tokens: usage.output_tokens,
                  total_tokens: usage.total_tokens,
                  reasoning_tokens: usage.reasoning_tokens,
                  cached_tokens: usage.cached_tokens,
                },
              };
              logger.silly(`Gemini Transformer: Enqueueing unified chunk (usage)`, chunk);
              controller.enqueue(chunk);
              return;
            }

            if (!candidate) return;

            const parts = candidate.content?.parts || [];

            // Emit message_start on first valid candidate (even if parts is empty)
            if (!hasSentMessageStart) {
              const msgStartEvent = {
                id: data.responseId,
                model: data.modelVersion,
                created: Date.now(),
                event: 'message_start' as StreamBlockEventType,
                delta: { role: 'assistant' },
              };
              logger.silly(
                `Gemini Transformer: Enqueueing unified chunk (message_start)`,
                msgStartEvent
              );
              controller.enqueue(msgStartEvent);
              hasSentMessageStart = true;
              messageHasFunctionCalls = false;
              streamedToolCallCount = 0;
            }

            for (const part of parts) {
              // Handle text content (including thought/ reasoning)
              if (part.text) {
                const isThinking = part.thought === true;
                const newBlockType = isThinking ? 'thinking' : 'text';

                // Emit block start event if transitioning to a new block type
                if (activeBlockType !== newBlockType) {
                  // Close previous block if any
                  if (activeBlockType) {
                    const endEvent = {
                      id: data.responseId,
                      model: data.modelVersion,
                      created: Date.now(),
                      event: `${activeBlockType}_end` as StreamBlockEventType,
                      delta: {},
                    };
                    logger.silly(
                      `Gemini Transformer: Enqueueing unified chunk (${activeBlockType}_end)`,
                      endEvent
                    );
                    controller.enqueue(endEvent);
                  }
                  // Start new block
                  const startEvent = {
                    id: data.responseId,
                    model: data.modelVersion,
                    created: Date.now(),
                    event: `${newBlockType}_start` as StreamBlockEventType,
                    delta: { role: 'assistant' },
                  };
                  logger.silly(
                    `Gemini Transformer: Enqueueing unified chunk (${newBlockType}_start)`,
                    startEvent
                  );
                  controller.enqueue(startEvent);
                  activeBlockType = newBlockType;
                }

                const chunk = {
                  id: data.responseId,
                  model: data.modelVersion,
                  created: Date.now(),
                  event: `${newBlockType}_delta` as StreamBlockEventType,
                  delta: {
                    role: 'assistant',
                    reasoning_content: isThinking ? part.text : undefined,
                    content: isThinking ? undefined : part.text,
                  },
                };
                logger.silly(
                  `Gemini Transformer: Enqueueing unified chunk (${newBlockType}_delta)`,
                  chunk
                );
                controller.enqueue(chunk);
              }

              // Handle tool/function calls
              if (part.functionCall) {
                messageHasFunctionCalls = true;
                const toolCallIndex = streamedToolCallCount++;
                // Close previous block if any
                if (activeBlockType) {
                  const endEvent = {
                    id: data.responseId,
                    model: data.modelVersion,
                    created: Date.now(),
                    event: `${activeBlockType}_end` as StreamBlockEventType,
                    delta: {},
                  };
                  logger.silly(
                    `Gemini Transformer: Enqueueing unified chunk (${activeBlockType}_end)`,
                    endEvent
                  );
                  controller.enqueue(endEvent);
                }

                // Start toolcall block if not already active
                if (activeBlockType !== 'toolcall') {
                  const startEvent = {
                    id: data.responseId,
                    model: data.modelVersion,
                    created: Date.now(),
                    event: 'toolcall_start' as StreamBlockEventType,
                    delta: { role: 'assistant' },
                  };
                  logger.silly(
                    `Gemini Transformer: Enqueueing unified chunk (toolcall_start)`,
                    startEvent
                  );
                  controller.enqueue(startEvent);
                  activeBlockType = 'toolcall';
                }

                const chunk = {
                  id: data.responseId,
                  model: data.modelVersion,
                  created: Date.now(),
                  event: 'toolcall_delta' as StreamBlockEventType,
                  delta: {
                    role: 'assistant',
                    tool_calls: [
                      {
                        index: toolCallIndex,
                        id: part.functionCall.id || `call_${toolCallIndex + 1}`,
                        type: 'function',
                        function: {
                          name: part.functionCall.name,
                          arguments: JSON.stringify(part.functionCall.args),
                        },
                      },
                    ],
                  },
                };
                logger.silly(
                  `Gemini Transformer: Enqueueing unified chunk (toolcall_delta)`,
                  chunk
                );
                controller.enqueue(chunk);
              }
            }

            // Handle finish reason
            if (candidate.finishReason) {
              // Close any active block
              if (activeBlockType) {
                const endEvent = {
                  id: data.responseId,
                  model: data.modelVersion,
                  created: Date.now(),
                  event: `${activeBlockType}_end` as StreamBlockEventType,
                  delta: {},
                };
                logger.silly(
                  `Gemini Transformer: Enqueueing unified chunk (${activeBlockType}_end)`,
                  endEvent
                );
                controller.enqueue(endEvent);
                activeBlockType = null;
              }

              // Determine finish reason: if there are function calls, use the OpenAI-compatible
              // unified finish reason so downstream OpenAI formatting emits `tool_calls`.
              let finishReason = candidate.finishReason.toLowerCase();
              const hasFunctionCalls = messageHasFunctionCalls;
              if (hasFunctionCalls && finishReason === 'stop') {
                finishReason = 'tool_calls';
              }

              const chunk = {
                id: data.responseId,
                model: data.modelVersion,
                created: Date.now(),
                finish_reason: finishReason,
                usage: data.usageMetadata
                  ? (() => {
                      const usage = normalizeGeminiUsage(data.usageMetadata);
                      return {
                        input_tokens: usage.input_tokens,
                        output_tokens: usage.output_tokens,
                        total_tokens: usage.total_tokens,
                        reasoning_tokens: usage.reasoning_tokens,
                        cached_tokens: usage.cached_tokens,
                      };
                    })()
                  : undefined,
              };
              logger.silly(`Gemini Transformer: Enqueueing unified chunk (finish)`, chunk);
              controller.enqueue(chunk);
              messageHasFunctionCalls = false;
              streamedToolCallCount = 0;
            }
          } catch (e) {
            logger.error('Error parsing Gemini stream chunk', e);
          }
        },
      });
    },
    transform(chunk, controller) {
      const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
      parser.feed(text);
    },
  });

  return stream.pipeThrough(transformer);
}
