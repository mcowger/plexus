import { Transformer, UnifiedChatRequest, UnifiedChatResponse, UnifiedUsage, ReconstructedChatResponse, ImageOutput } from "./types";
import { createParser, EventSourceMessage } from "eventsource-parser";
import { encode } from "eventsource-encoder";

/**
 * OpenAITransformer
 */
export class OpenAITransformer implements Transformer {
  name = "chat";
  defaultEndpoint = "/chat/completions";

  getEndpoint(_request: UnifiedChatRequest): string {
    return this.defaultEndpoint;
  }

  async parseRequest(input: any): Promise<UnifiedChatRequest> {
    return {
      messages: input.messages,
      model: input.model,
      max_tokens: input.max_tokens,
      temperature: input.temperature,
      top_p: input.top_p,
    presence_penalty: input.presence_penalty,
      frequency_penalty: input.frequency_penalty,
      stop: input.stop,
      stream: input.stream,
      tools: input.tools,
      tool_choice: input.tool_choice,
      reasoning: input.reasoning,
      response_format: input.response_format,
      modalities: input.modalities,
      image_config: input.image_config,
      n: input.n,
      logit_bias: input.logit_bias,
      logprobs: input.logprobs,
      top_logprobs: input.top_logprobs,
      user: input.user,
    };
  }

  async transformRequest(request: UnifiedChatRequest): Promise<any> {
    return {
      model: request.model,
      messages: request.messages,
      max_tokens: request.max_tokens,
      temperature: request.temperature,
      top_p: request.top_p,
      presence_penalty: request.presence_penalty,
      frequency_penalty: request.frequency_penalty,
      stop: request.stop,
      stream: request.stream,
      tools: request.tools,
      tool_choice: request.tool_choice,
    response_format: request.response_format,
  modalities: request.modalities,
      image_config: request.image_config,
      n: request.n,
      logit_bias: request.logit_bias,
      logprobs: request.logprobs,
      top_logprobs: request.top_logprobs,
      user: request.user,
    };
  }

  parseUsage(input: any): UnifiedUsage {
    if (!input) {
      return {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
      };
    }

    const reasoningTokens = input.completion_tokens_details?.reasoning_tokens || 0;
    const completionTokens = input.completion_tokens || 0;

    return {
      // UnifiedUsage.input_tokens - prompt_tokens is the input superset. It represents every token sent to the model.
      input_tokens: input.prompt_tokens || 0,
      // completion_tokens is the response superset. It represents everything the model generated, including reasoning.
      // So when calculating for conversion to UnifiedUsage, reasoning_tokens should be subtracted from this number.
      output_tokens: completionTokens - reasoningTokens,
      total_tokens: input.total_tokens || 0,
      reasoning_tokens: reasoningTokens,
      // UnifiedUsage.cache_read_tokens
      cache_read_tokens: input.prompt_tokens_details?.cached_tokens || 0,
      cache_creation_tokens: 0,
    };
  }

  formatUsage(usage: UnifiedUsage): any {
    return {
      prompt_tokens: usage.input_tokens,
      // Reconstruct completion_tokens superset
      completion_tokens: usage.output_tokens + (usage.reasoning_tokens || 0),
      total_tokens: usage.total_tokens,
      prompt_tokens_details: {
        cached_tokens: usage.cache_read_tokens || 0,
      },
      completion_tokens_details: {
        reasoning_tokens: usage.reasoning_tokens || 0,
      },
    };
  }

  async transformResponse(response: any): Promise<UnifiedChatResponse> {
    const choice = response.choices?.[0];
    const message = choice?.message;
    const usage = response.usage ? this.parseUsage(response.usage) : undefined;

    // Parse images if present (for future OpenAI image generation support)
    let images: ImageOutput[] | undefined;
    if (message?.images && Array.isArray(message.images)) {
      images = message.images.map((img: any) => ({
        data: img.data || img.b64_json || "",
        mimeType: img.mime_type || "image/png",
      }));
    }

    return {
      id: response.id,
      model: response.model,
      created: response.created,
      content: message?.content || null,
      reasoning_content: message?.reasoning_content || null,
      tool_calls: message?.tool_calls,
      images,
      usage,
    };
  }

  async formatResponse(response: UnifiedChatResponse): Promise<any> {
    const message: any = {
      role: "assistant",
      content: response.content,
      reasoning_content: response.reasoning_content,
      tool_calls: response.tool_calls,
    };

    // Include images if present
    if (response.images && response.images.length > 0) {
      message.images = response.images.map((img) => ({
        b64_json: img.data,
        mime_type: img.mimeType,
      }));
    }

    return {
      id: response.id,
      object: "chat.completion",
      created: response.created || Math.floor(Date.now() / 1000),
      model: response.model,
      choices: [
        {
          index: 0,
          message,
          finish_reason: response.tool_calls ? "tool_calls" : "stop",
        },
      ],
      usage: response.usage ? this.formatUsage(response.usage) : undefined,
    };
  }

  transformStream(stream: ReadableStream): ReadableStream {
    const decoder = new TextDecoder();
    const self = this;

    return new ReadableStream({
      async start(controller) {
        const parser = createParser({
          onEvent: (event: EventSourceMessage) => {
            if (event.data === "[DONE]") return;

            try {
              const data = JSON.parse(event.data);

              const choice = data.choices?.[0];

              const usage = data.usage ? self.parseUsage(data.usage) : undefined;

              const unifiedChunk = {
                id: data.id,
                model: data.model,
                created: data.created,
                delta: {
                  role: choice?.delta?.role,
                  content: choice?.delta?.content,
                  reasoning_content: choice?.delta?.reasoning_content,
                  tool_calls: choice?.delta?.tool_calls,
                },
                finish_reason:
                  choice?.finish_reason ||
                  data.finish_reason ||
                  (choice?.delta ? null : "stop"),
                usage,
              };

              controller.enqueue(unifiedChunk);
            } catch (e) {
              // ignore
            }
          },
        });

        const reader = stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunkText = decoder.decode(value, { stream: true });

            parser.feed(chunkText);
          }
        } finally {
          reader.releaseLock();
          controller.close();
        }
      },
    });
  }

  formatStream(stream: ReadableStream): ReadableStream {
    const encoder = new TextEncoder();
    const reader = stream.getReader();
    const self = this;

    return new ReadableStream({
      async start(controller) {
        try {
       while (true) {
         const { done, value: unifiedChunk } = await reader.read();
        if (done) {
              controller.enqueue(encoder.encode(encode({ data: "[DONE]" })));
              break;
            }

            const openAIChunk = {
              id: unifiedChunk.id || "chatcmpl-" + Date.now(),
              object: "chat.completion.chunk",
           created: unifiedChunk.created || Math.floor(Date.now() / 1000),
              model: unifiedChunk.model,
              choices: [
                {
                  index: 0,
                  delta: unifiedChunk.delta,
        finish_reason: unifiedChunk.finish_reason || null,
                },
              ],
              usage: unifiedChunk.usage ? self.formatUsage(unifiedChunk.usage) : undefined,
         };

            const sseMessage = encode({ data: JSON.stringify(openAIChunk) });

            controller.enqueue(encoder.encode(sseMessage));
          }
        } finally {
        reader.releaseLock();
          controller.close();
        }
       },
     });
   }

  /**
   * Reconstructs a full JSON response body from a raw SSE string.
   */
  reconstructResponseFromStream(rawSSE: string): ReconstructedChatResponse | null {
    const lines = rawSSE.split(/\r?\n/);

    let id = "";
    let model = "";
    let created = 0;
    let accumulatedContent = "";
    let accumulatedReasoning = "";
    let finishReason = "stop";
    let usageMetadata: any = null;

    // Track tool calls by index
    const toolCallsMap: Map<number, {
      id?: string;
      type?: string;
      function?: {
        name?: string;
        arguments: string;
      };
    }> = new Map();

    for (const line of lines) {
    // Skip comments (lines starting with ':') or empty lines
   if (!line.startsWith("data: ") || line === "data: [DONE]") {
      continue;
      }

      // Remove "data: " prefix and parse JSON
      const jsonString = line.replace(/^data: /, "").trim();
      try {
        const chunk: any = JSON.parse(jsonString);

        // Capture metadata from the first valid chunk
        if (!id) id = chunk.id;
        if (!model) model = chunk.model;
        if (!created) created = chunk.created;

        // Accumulate Content and Reasoning
        const delta = chunk.choices?.[0]?.delta;
        if (delta) {
        if (delta.content) accumulatedContent += delta.content;
          if (delta.reasoning) accumulatedReasoning += delta.reasoning;

          // Accumulate tool calls
          if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
            for (const toolCallDelta of delta.tool_calls) {
              const index = toolCallDelta.index ?? 0;

              if (!toolCallsMap.has(index)) {
                toolCallsMap.set(index, {
                  function: {
                    arguments: ""
                  }
                });
              }

              const toolCall = toolCallsMap.get(index)!;

              // Set id and type from the first chunk
              if (toolCallDelta.id) {
                toolCall.id = toolCallDelta.id;
              }
              if (toolCallDelta.type) {
                toolCall.type = toolCallDelta.type;
              }

              // Accumulate function name and arguments
              if (toolCallDelta.function) {
                if (!toolCall.function) {
                  toolCall.function = { arguments: "" };
                }
                if (toolCallDelta.function.name) {
                  toolCall.function.name = toolCallDelta.function.name;
                }
                if (toolCallDelta.function.arguments) {
                  toolCall.function.arguments += toolCallDelta.function.arguments;
                }
              }
            }
          }
        }

        // Capture Finish Reason
        if (chunk.choices?.[0]?.finish_reason) {
       finishReason = chunk.choices[0].finish_reason;
        }

        // Capture Usage (usually in the last chunk)
      if (chunk.usage) {
          usageMetadata = chunk.usage;
        }
      } catch (e) {
        // Ignore parse errors
      }
    }

    if (!id) return null;

    // Convert tool calls map to array if any tool calls exist
    const toolCalls = toolCallsMap.size > 0
      ? Array.from(toolCallsMap.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([_, toolCall]) => ({
            id: toolCall.id || "",
            type: "function" as const,
            function: {
              name: toolCall.function?.name || "",
              arguments: toolCall.function?.arguments || ""
            }
          }))
      : undefined;

    return {
      id,
      model,
      object: "chat.completion",
      created,
    choices: [
      {
          index: 0,
          message: {
            role: "assistant",
          content: accumulatedContent,
            ...(accumulatedReasoning ? { reasoning: accumulatedReasoning } : {}),
            ...(toolCalls ? { tool_calls: toolCalls } : {})
          },
          finish_reason: finishReason,
        },
      ],
      usage: usageMetadata,
    };
  }
}