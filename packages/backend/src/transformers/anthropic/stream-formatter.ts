import { encode } from "eventsource-encoder";

/**
 * Formats unified chunks back into Anthropic's SSE format.
 *
 * This is the most complex component: it maintains a state machine for block lifecycle:
 * 1. message_start - Send initial message metadata
 * 2. content_block_start - Begin a text/thinking/tool_use block
 * 3. content_block_delta - Send progressive deltas
 * 4. content_block_stop - End current block (on type change)
 * 5. message_delta - Send final usage and stop reason
 * 6. message_stop - Complete the stream
 *
 * Key state management:
 * - Tracks active block type and index
 * - Defers finish reason until flush (to gather final usage)
 * - Ensures proper block lifecycle transitions
 */
export function formatAnthropicStream(stream: ReadableStream): ReadableStream {
  const encoder = new TextEncoder();
  let hasSentStart = false;
  let hasSentFinish = false;

  // State machine
  let nextBlockIndex = 0;
  let activeBlockType: "text" | "thinking" | "tool_use" | null = null;
  let activeBlockIndex: number | null = null;

  // Track usage and finish reason across chunks
  let lastUsage: any = null;
  let pendingFinishReason: string | null = null;

  const transformer = new TransformStream({
    transform(chunk: any, controller) {
      const safeEnqueue = (str: string) => {
        controller.enqueue(encoder.encode(str));
      };

      const sendEvent = (event: string, data: any) => {
        safeEnqueue(encode({ event, data: JSON.stringify(data) }));
    };

      // Accumulate Usage
      if (chunk.usage) {
        lastUsage = chunk.usage;
      }

      // 1. Message Start
      if (!hasSentStart) {
        const messageStart = {
     type: "message_start",
          message: {
            id: chunk.id || "msg_" + Date.now(),
            type: "message",
            role: "assistant",
            model: chunk.model,
         content: [],
          stop_reason: null,
         stop_sequence: null,
            usage: {
              input_tokens: chunk.usage?.input_tokens || 0,
              output_tokens: chunk.usage?.output_tokens || 0,
              cache_read_input_tokens: chunk.usage?.cached_tokens || 0,
              cache_creation_input_tokens: chunk.usage?.cache_creation_tokens || 0,
            },
          },
        };
        sendEvent("message_start", messageStart);
        hasSentStart = true;
      }

      const closeCurrentBlock = () => {
        if (activeBlockType !== null && activeBlockIndex !== null) {
          sendEvent("content_block_stop", {
            type: "content_block_stop",
            index: activeBlockIndex,
          });
        activeBlockType = null;
          activeBlockIndex = null;
        }
      };

      const startBlock = (
       type: "text" | "thinking" | "tool_use",
        info?: any
      ) => {
        closeCurrentBlock();

    activeBlockIndex = nextBlockIndex++;
        activeBlockType = type;

        let content_block: any;
        if (type === "text") {
          content_block = { type: "text", text: "" };
    } else if (type === "thinking") {
          content_block = { type: "thinking", thinking: "" };
      } else if (type === "tool_use") {
          content_block = {
            type: "tool_use",
         id: info.id,
            name: info.name,
            input: {},
          };
        }

       sendEvent("content_block_start", {
          type: "content_block_start",
          index: activeBlockIndex,
          content_block,
        });
      };

      if (chunk.delta) {
        // Thinking
        if (chunk.delta.thinking?.content || chunk.delta.reasoning_content) {
          if (activeBlockType !== "thinking") {
            startBlock("thinking");
          }
          sendEvent("content_block_delta", {
            type: "content_block_delta",
            index: activeBlockIndex,
         delta: {
              type: "thinking_delta",
      thinking:
                chunk.delta.thinking?.content || chunk.delta.reasoning_content,
            },
       });
        }

        if (chunk.delta.thinking?.signature) {
       if (activeBlockType !== "thinking") {
            startBlock("thinking");
          }
          sendEvent("content_block_delta", {
            type: "content_block_delta",
          index: activeBlockIndex,
            delta: {
              type: "signature_delta",
          signature: chunk.delta.thinking.signature,
            },
          });
        }

        // Text
        if (chunk.delta.content) {
          if (activeBlockType !== "text") {
           startBlock("text");
          }
          sendEvent("content_block_delta", {
            type: "content_block_delta",
            index: activeBlockIndex,
            delta: { type: "text_delta", text: chunk.delta.content },
          });
        }

        // Tool Calls
        if (chunk.delta.tool_calls) {
         for (const tc of chunk.delta.tool_calls) {
            if (tc.id) {
              startBlock("tool_use", {
       id: tc.id,
             name: tc.function?.name,
             });
            }

          if (tc.function?.arguments) {
              if (
                activeBlockType === "tool_use" &&
            activeBlockIndex !== null
              ) {
             sendEvent("content_block_delta", {
           type: "content_block_delta",
         index: activeBlockIndex,
                delta: {
                type: "input_json_delta",
          partial_json: tc.function.arguments,
             },
                });
              }
            }
       }
        }
      }

      // Capture Finish Reason
      if (chunk.finish_reason) {
        closeCurrentBlock();

        // Store finish reason but defer sending completion events
      // to allow subsequent chunks (like usage) to be processed.
        const mapping: Record<string, string> = {
          stop: "end_turn",
          length: "max_tokens",
        tool_calls: "tool_use",
          content_filter: "stop_sequence",
        };

        pendingFinishReason = mapping[chunk.finish_reason] || chunk.finish_reason;
      }
    },

    flush(controller) {
      // Robust Termination: ensure message_delta and message_stop are sent
      if (hasSentStart && !hasSentFinish) {
        const safeEnqueue = (str: string) => {
          controller.enqueue(encoder.encode(str));
        };
        const sendEvent = (event: string, data: any) => {
          safeEnqueue(encode({ event, data: JSON.stringify(data) }));
        };

        if (activeBlockType !== null && activeBlockIndex !== null) {
        sendEvent("content_block_stop", {
            type: "content_block_stop",
      index: activeBlockIndex,
          });
        }
        // Send message_delta with collected usage and stop reason
        sendEvent("message_delta", {
          type: "message_delta",
          delta: {
            stop_reason: pendingFinishReason || "end_turn",
            stop_sequence: null,
          },
          usage: {
            output_tokens: lastUsage?.output_tokens ?? 0,
          },
        });

        sendEvent("message_stop", { type: "message_stop" });
        hasSentFinish = true;
      }
    },
  });

  return stream.pipeThrough(transformer);
}
