import { createParser, EventSourceMessage } from "eventsource-parser";
import { logger } from "../../utils/logger";
import { countTokens } from "../utils";

/**
 * Transforms an Anthropic stream (Server-Sent Events) into unified stream format.
 *
 * Anthropic streams are SSE-formatted with a state machine of events:
 * - message_start: Initializes message
 * - content_block_start: Marks beginning of text/thinking/tool_use block
 * - content_block_delta: Progressive content updates (text_delta, thinking_delta, etc.)
 * - message_delta: Usage and stop reason updates
 * - message_stop: Stream end
 *
 * This transformer:
 * 1. Parses SSE messages
 * 2. Converts to unified chunk format
 * 3. Accumulates state (messageId, model, text, thinking flags)
 * 4. Handles token imputation for thinking content
 */
export function transformAnthropicStream(
  stream: ReadableStream
): ReadableStream {
  const decoder = new TextDecoder();
  let accumulatedText = "";
  let seenThinking = false;
  let parser: any;
  let messageId: string | undefined;
  let model: string | undefined;

  const transformer = new TransformStream({
    start(controller) {
      parser = createParser({
        onEvent: (event: EventSourceMessage) => {
          if (event.data === "[DONE]") return;

          try {
            const data = JSON.parse(event.data);
        let unifiedChunk: any = null;

          switch (data.type) {
            case "message_start":
            messageId = data.message.id;
             model = data.message.model;
              unifiedChunk = {
                  id: messageId,
         model: model,
                created: Math.floor(Date.now() / 1000),
               delta: { role: "assistant" },
                  usage: data.message.usage
                    ? {
                  input_tokens: data.message.usage.input_tokens || 0,
                 output_tokens: data.message.usage.output_tokens || 0,
                    total_tokens:
                       (data.message.usage.input_tokens || 0) +
                     (data.message.usage.output_tokens || 0),
                    reasoning_tokens: 0,
                     cached_tokens:
              data.message.usage.cache_read_input_tokens || 0,
                      cache_creation_tokens:
                       data.message.usage.cache_creation_input_tokens || 0,
                      }
           : undefined,
                };
              break;

              case "content_block_delta":
                if (data.delta.type === "text_delta") {
              accumulatedText += data.delta.text;
            unifiedChunk = {
              delta: { content: data.delta.text },
                  };
                } else if (data.delta.type === "thinking_delta") {
              seenThinking = true;
           unifiedChunk = {
               delta: {
                      reasoning_content: data.delta.thinking,
              thinking: { content: data.delta.thinking },
                    },
               };
              } else if (data.delta.type === "signature_delta") {
                  unifiedChunk = {
           delta: {
                   thinking: { signature: data.delta.signature },
                    },
           };
            } else if (data.delta.type === "input_json_delta") {
                  unifiedChunk = {
                 delta: {
                  tool_calls: [
              {
                      index: data.index,
                       function: {
                     arguments: data.delta.partial_json,
                  },
                     },
                      ],
             },
                  };
                }
                break;

              case "content_block_start":
                if (data.content_block.type === "tool_use") {
             unifiedChunk = {
               delta: {
                      tool_calls: [
                      {
                          index: data.index,
                 id: data.content_block.id,
               type: "function",
                          function: {
                       name: data.content_block.name,
                arguments: "",
                },
                     },
                      ],
                    },
                  };
              } else if (data.content_block.type === "thinking") {
                  seenThinking = true;
                unifiedChunk = {
                    delta: {
                   thinking: {
                 content: data.content_block.thinking || "",
                    },
             },
                  };
                }
       break;

              case "message_delta":
           // Handle usage update and finish reason
                const inputTokens = data.usage?.input_tokens || 0;
                const totalOutputTokens = data.usage?.output_tokens || 0;

                let realOutputTokens = totalOutputTokens;
                let imputedThinkingTokens = 0;

                if (seenThinking) {
                realOutputTokens = countTokens(accumulatedText);
                imputedThinkingTokens = Math.max(
                 0,
                 totalOutputTokens - realOutputTokens
             );
                }

                unifiedChunk = {
          finish_reason:
                    data.delta.stop_reason === "end_turn"
                      ? "stop"
                      : data.delta.stop_reason === "tool_use"
                  ? "tool_calls"
                  : data.delta.stop_reason,
              usage: data.usage
                    ? {
                    input_tokens: inputTokens,
               output_tokens: realOutputTokens,
                        total_tokens: inputTokens + totalOutputTokens,
                        reasoning_tokens: imputedThinkingTokens,
                   cached_tokens:
                      data.usage.cache_read_input_tokens || 0,
                        cache_creation_tokens:
                      data.usage.cache_creation_input_tokens || 0,
                  }
                    : undefined,
              };
                break;
          }

         if (unifiedChunk) {
              controller.enqueue(unifiedChunk);
        }
          } catch (e) {
          logger.error("Error parsing Anthropic stream chunk", e);
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
