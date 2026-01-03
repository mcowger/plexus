import { Transformer } from "../types/transformer";
import {
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedMessage,
  UnifiedTool,
  MessageContent,
} from "../types/unified";
import { logger } from "../utils/logger";
import { countTokens } from "./utils";
import { extractAnthropicUsage } from "./usage-extractors";

export class AnthropicTransformer implements Transformer {
  name = "messages";
  defaultEndpoint = "/messages";

  // --- 1. Client (Anthropic) -> Unified ---
  async parseRequest(input: any): Promise<UnifiedChatRequest> {
    const messages: UnifiedMessage[] = [];

    // System
    if (input.system) {
      messages.push({ role: "system", content: input.system });
    }

    // Messages
    if (input.messages) {
      for (const msg of input.messages) {
        if (msg.role === "user" || msg.role === "assistant") {
          if (typeof msg.content === "string") {
            messages.push({ role: msg.role, content: msg.content });
          } else if (Array.isArray(msg.content)) {
            const unifiedMsg: UnifiedMessage = { role: msg.role, content: "" };

            // Check for tool results
            const toolResults = msg.content.filter(
              (c: any) => c.type === "tool_result"
            );
            if (toolResults.length > 0 && msg.role === "user") {
              for (const tool of toolResults) {
                messages.push({
                  role: "tool",
                  content:
                    typeof tool.content === "string"
                      ? tool.content
                      : JSON.stringify(tool.content),
                  tool_call_id: tool.tool_use_id,
                });
              }
              const otherParts = msg.content.filter(
                (c: any) => c.type !== "tool_result"
              );
              if (otherParts.length > 0) {
                messages.push({
                  role: "user",
                  content: this.convertAnthropicContent(otherParts),
                });
              }
              continue;
            }

            // Handle tool calls
            const toolUses = msg.content.filter(
              (c: any) => c.type === "tool_use"
            );
            if (toolUses.length > 0 && msg.role === "assistant") {
              unifiedMsg.tool_calls = toolUses.map((t: any) => ({
                id: t.id,
                type: "function",
                function: {
                  name: t.name,
                  arguments: JSON.stringify(t.input),
                },
              }));
            }

            // Handle Thinking/Reasoning
            const thinkingPart = msg.content.find(
              (c: any) => c.type === "thinking"
            );
            if (thinkingPart && msg.role === "assistant") {
              unifiedMsg.thinking = {
                content: thinkingPart.thinking,
                signature: thinkingPart.signature,
              };
            }

            // Text/Image content
            const contentParts = msg.content.filter(
              (c: any) =>
                c.type !== "tool_use" &&
                c.type !== "tool_result" &&
                c.type !== "thinking"
            );
            if (contentParts.length > 0) {
              unifiedMsg.content = this.convertAnthropicContent(contentParts);
            } else if (unifiedMsg.tool_calls || unifiedMsg.thinking) {
              unifiedMsg.content = null;
            }

            messages.push(unifiedMsg);
          }
        }
      }
    }

    return {
      messages,
      model: input.model,
      max_tokens: input.max_tokens,
      temperature: input.temperature,
      stream: input.stream,
      tools: input.tools
        ? this.convertAnthropicToolsToUnified(input.tools)
        : undefined,
      tool_choice: input.tool_choice,
    };
  }

  // --- 4. Unified -> Client (Anthropic) ---
  async formatResponse(response: UnifiedChatResponse): Promise<any> {
    const content: any[] = [];

    // Reasoning/Thinking content
    if (response.reasoning_content) {
      content.push({
        type: "thinking",
        thinking: response.reasoning_content,
      });
    }

    // Text content
    if (response.content) {
      content.push({ type: "text", text: response.content });
    }

    // Tool Calls
    if (response.tool_calls) {
      for (const toolCall of response.tool_calls) {
        content.push({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.function.name,
          input: JSON.parse(toolCall.function.arguments),
        });
      }
    }

    return {
      id: response.id,
      type: "message",
      role: "assistant",
      model: response.model,
      content,
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: response.usage?.input_tokens || 0,
        output_tokens: response.usage?.output_tokens || 0,
        thinkingTokens: response.usage?.reasoning_tokens || 0,
        cache_read_input_tokens: response.usage?.cached_tokens || 0,
        cache_creation_input_tokens: response.usage?.cache_creation_tokens || 0,
      },
    };
  }

  // --- 2. Unified -> Provider (Anthropic) ---
  async transformRequest(request: UnifiedChatRequest): Promise<any> {
    let system: string | undefined;
    const messages: any[] = [];

    for (const msg of request.messages) {
      if (msg.role === "system") {
        system =
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content);
      } else if (msg.role === "user" || msg.role === "assistant") {
        const content: any[] = [];

        if (msg.thinking) {
          content.push({
            type: "thinking",
            thinking: msg.thinking.content,
            signature: msg.thinking.signature,
          });
        }

        if (msg.content) {
          if (typeof msg.content === "string") {
            content.push({ type: "text", text: msg.content });
          } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
              if (part.type === "text") {
                content.push({ type: "text", text: part.text });
              } else if (part.type === "image_url") {
                content.push({
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: part.media_type || "image/jpeg",
                    data: "",
                  },
                });
              }
            }
          }
        }

        if (msg.role === "assistant" && msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            content.push({
              type: "tool_use",
              id: tc.id,
              name: tc.function.name,
              input: JSON.parse(tc.function.arguments),
            });
          }
        }

        messages.push({ role: msg.role, content });
      } else if (msg.role === "tool") {
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: msg.tool_call_id,
              content:
                typeof msg.content === "string"
                  ? msg.content
                  : JSON.stringify(msg.content),
            },
          ],
        });
      }
    }

    const mergedMessages: any[] = [];
    for (const msg of messages) {
      if (mergedMessages.length > 0) {
        const last = mergedMessages[mergedMessages.length - 1];
        if (last.role === msg.role && msg.role === "user") {
          last.content.push(...msg.content);
          continue;
        }
      }
      mergedMessages.push(msg);
    }

    return {
      model: request.model,
      messages: mergedMessages,
      system,
      max_tokens: request.max_tokens || 4096,
      temperature: request.temperature,
      stream: request.stream,
      tools: request.tools
        ? this.convertUnifiedToolsToAnthropic(request.tools)
        : undefined,
    };
  }

  // --- 3. Provider (Anthropic) -> Unified ---
  async transformResponse(response: any): Promise<UnifiedChatResponse> {
    const contentBlocks = response.content || [];
    let text = "";
    let reasoning = "";
    const toolCalls: any[] = [];

    for (const block of contentBlocks) {
      if (block.type === "text") {
        text += block.text;
      } else if (block.type === "thinking") {
        reasoning += block.thinking;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          type: "function",
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        });
      }
    }

    const inputTokens = response.usage?.input_tokens || 0;
    const totalOutputTokens = response.usage?.output_tokens || 0;
    const cacheReadTokens = response.usage?.cache_read_input_tokens || 0;
    const cacheCreationTokens =
      response.usage?.cache_creation_input_tokens || 0;

    let realOutputTokens = totalOutputTokens;
    let imputedThinkingTokens = 0;

    // Only impute if there is thinking content
    if (reasoning.length > 0) {
      realOutputTokens = countTokens(text);
      imputedThinkingTokens = Math.max(0, totalOutputTokens - realOutputTokens);
    }

    return {
      id: response.id,
      model: response.model,
      content: text || null,
      reasoning_content: reasoning || null,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        input_tokens: inputTokens,
        output_tokens: realOutputTokens,
        total_tokens: inputTokens + totalOutputTokens,
        reasoning_tokens: imputedThinkingTokens,
        cached_tokens: cacheReadTokens,
        cache_creation_tokens: cacheCreationTokens,
      },
    };
  }

  // --- 5. Provider Stream (Anthropic) -> Unified Stream ---
  transformStream(stream: ReadableStream): ReadableStream {
    const decoder = new TextDecoder();
    let buffer = "";
    let accumulatedText = "";
    let seenThinking = false;

    // Use TransformStream for proper backpressure handling
    const transformer = new TransformStream({
      transform(chunk, controller) {
        const text =
          typeof chunk === "string"
            ? chunk
            : decoder.decode(chunk, { stream: true });
        buffer += text;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine || !trimmedLine.startsWith("data:")) continue;

          const dataStr = trimmedLine.slice(5).trim();
          if (dataStr === "[DONE]") continue;

          try {
            const data = JSON.parse(dataStr);
            let unifiedChunk: any = null;

            switch (data.type) {
              case "message_start":
                unifiedChunk = {
                  id: data.message.id,
                  model: data.message.model,
                  created: Math.floor(Date.now() / 1000),
                  delta: { role: "assistant" },
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
                    delta: { reasoning_content: data.delta.thinking },
                  };
                } else if (data.delta.type === "input_json_delta") {
                  unifiedChunk = {
                    delta: {
                      tool_calls: [
                        {
                          index: data.index,
                          function: { arguments: data.delta.partial_json },
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
                }
                break;
              case "message_delta":
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
                        cached_tokens: 0,
                        cache_creation_tokens: 0,
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
        }
      },
    });

    return stream.pipeThrough(transformer);
  }

  // --- 6. Unified Stream -> Client Stream (Anthropic) ---
  formatStream(stream: ReadableStream): ReadableStream {
    const encoder = new TextEncoder();
    let hasSentStart = false;

    // Use TransformStream for proper backpressure handling
    const transformer = new TransformStream({
      transform(chunk: any, controller) {
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
              usage: { input_tokens: 0, output_tokens: 0 },
            },
          };
          controller.enqueue(
            encoder.encode(
              `event: message_start\ndata: ${JSON.stringify(messageStart)}\n\n`
            )
          );
          hasSentStart = true;
        }

        if (chunk.delta) {
          if (chunk.delta.content) {
            const textDelta = {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: chunk.delta.content },
            };
            controller.enqueue(
              encoder.encode(
                `event: content_block_delta\ndata: ${JSON.stringify(
                  textDelta
                )}\n\n`
              )
            );
          }

          if (chunk.delta.reasoning_content) {
            const thinkingDelta = {
              type: "content_block_delta",
              index: 0,
              delta: {
                type: "thinking_delta",
                thinking: chunk.delta.reasoning_content,
              },
            };
            controller.enqueue(
              encoder.encode(
                `event: content_block_delta\ndata: ${JSON.stringify(
                  thinkingDelta
                )}\n\n`
              )
            );
          }

          if (chunk.delta.tool_calls) {
            for (const tc of chunk.delta.tool_calls) {
              const toolDelta = {
                type: "content_block_delta",
                index: tc.index || 0,
                delta: {
                  type: "input_json_delta",
                  partial_json: tc.function?.arguments || "",
                },
              };
              controller.enqueue(
                encoder.encode(
                  `event: content_block_delta\ndata: ${JSON.stringify(
                    toolDelta
                  )}\n\n`
                )
              );
            }
          }
        }

        if (chunk.finish_reason) {
          const messageDelta = {
            type: "message_delta",
            delta: {
              stop_reason:
                chunk.finish_reason === "stop"
                  ? "end_turn"
                  : chunk.finish_reason === "tool_calls"
                  ? "tool_use"
                  : chunk.finish_reason,
              stop_sequence: null,
            },
            usage: chunk.usage
              ? {
                  output_tokens: chunk.usage.output_tokens,
                  thinkingTokens: chunk.usage.reasoning_tokens,
                }
              : undefined,
          };
          controller.enqueue(
            encoder.encode(
              `event: message_delta\ndata: ${JSON.stringify(messageDelta)}\n\n`
            )
          );

          const messageStop = { type: "message_stop" };
          controller.enqueue(
            encoder.encode(
              `event: message_stop\ndata: ${JSON.stringify(messageStop)}\n\n`
            )
          );
        }
      },
    });

    return stream.pipeThrough(transformer);
  }

  // Helpers

  private convertAnthropicContent(content: any[]): string | MessageContent[] {
    const parts: MessageContent[] = [];
    for (const c of content) {
      if (c.type === "text") parts.push({ type: "text", text: c.text });
    }
    if (!parts.length) return "";
    if (!parts[0]) return "";
    if (parts.length === 1 && parts[0].type === "text") return parts[0].text;
    return parts;
  }

  private convertAnthropicToolsToUnified(tools: any[]): UnifiedTool[] {
    return tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }

  private convertUnifiedToolsToAnthropic(tools: UnifiedTool[]): any[] {
    return tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
  }

  // --- 7. Extract usage from raw SSE chunk ---
  extractUsage(input: string) {
    return extractAnthropicUsage(input);
  }
}
