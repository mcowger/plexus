import { createParser, EventSourceMessage } from "eventsource-parser";
import { logger } from "../../utils/logger";

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
 */
export function transformGeminiStream(stream: ReadableStream): ReadableStream {
  const decoder = new TextDecoder();
  let parser: any;

  const transformer = new TransformStream({
    start(controller) {
      parser = createParser({
        onEvent: (event: EventSourceMessage) => {
          if (event.data === "[DONE]") return;
          try {
            const data = JSON.parse(event.data);
            const candidate = data.candidates?.[0];
            if (!candidate) return;

            const parts = candidate.content?.parts || [];

            for (const part of parts) {
              if (part.text) {
                const chunk = {
                  id: data.responseId,
                  model: data.modelVersion,
                  delta: {
                    role: "assistant",
                    reasoning_content: part.thought ? part.text : undefined,
                    content: part.thought ? undefined : part.text,
                  },
                };
                logger.silly(
                  `Gemini Transformer: Enqueueing unified chunk (text)`,
                  chunk
                );
                controller.enqueue(chunk);
              }
              if (part.functionCall) {
                const chunk = {
                  id: data.responseId,
                  model: data.modelVersion,
                  delta: {
                    role: "assistant",
                    tool_calls: [
                      {
                        id: part.functionCall.name,
                        type: "function",
                        function: {
                          name: part.functionCall.name,
                          arguments: JSON.stringify(part.functionCall.args),
                        },
                      },
                    ],
                  },
                };
                logger.silly(
                  `Gemini Transformer: Enqueueing unified chunk (tool)`,
                  chunk
                );
                controller.enqueue(chunk);
              }
            }

            if (candidate.finishReason) {
              const chunk = {
                id: data.responseId,
                model: data.modelVersion,
                finish_reason: candidate.finishReason.toLowerCase(),
                usage: data.usageMetadata
                  ? {
                      input_tokens: data.usageMetadata.promptTokenCount,
                      output_tokens: data.usageMetadata.candidatesTokenCount,
                      total_tokens: data.usageMetadata.totalTokenCount,
                      reasoning_tokens: data.usageMetadata.thoughtsTokenCount,
                      cached_tokens:
                        data.usageMetadata.cachedContentTokenCount,
                    }
                  : undefined,
              };
              logger.silly(
                `Gemini Transformer: Enqueueing unified chunk (finish)`,
                chunk
              );
              controller.enqueue(chunk);
            }
          } catch (e) {
            logger.error("Error parsing Gemini stream chunk", e);
          }
        },
      });
    },
    transform(chunk, controller) {
      const text =
        typeof chunk === "string"
          ? chunk
          : decoder.decode(chunk, { stream: true });
      parser.feed(text);
    },
  });

  return stream.pipeThrough(transformer);
}
