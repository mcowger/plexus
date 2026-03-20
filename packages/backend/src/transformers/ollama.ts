import { Transformer } from '../types/transformer';
import { UnifiedChatRequest, UnifiedChatResponse, UnifiedChatStreamChunk } from '../types/unified';

/**
 * OllamaTransformer
 *
 * Handles native Ollama API requests to /api/chat endpoint.
 * This is the docs-aligned native Ollama format, NOT the OpenAI compatibility layer.
 *
 * Key differences from OpenAI:
 * - Endpoint: /api/chat (not /v1/chat/completions)
 * - Streaming: NDJSON (newline-delimited JSON) instead of SSE
 * - Usage: prompt_eval_count / eval_count instead of prompt_tokens / completion_tokens
 */
export class OllamaTransformer implements Transformer {
  name = 'ollama';
  defaultEndpoint = '/api/chat';

  async parseRequest(input: any): Promise<UnifiedChatRequest> {
    // Convert incoming Ollama format to unified
    // Note: This would be used if we add a native /api/chat ingress route
    const messages: UnifiedChatRequest['messages'] = [];

    if (input.messages && Array.isArray(input.messages)) {
      for (const msg of input.messages) {
        messages.push({
          role: msg.role,
          content: typeof msg.content === 'string' ? msg.content : msg.content,
        });
      }
    }

    return {
      messages,
      model: input.model,
      max_tokens: input.options?.num_predict,
      temperature: input.options?.temperature,
      stream: input.stream,
      tools: input.tools,
    };
  }

  async transformRequest(request: UnifiedChatRequest): Promise<any> {
    // Build the Ollama native /api/chat request
    const messages: Array<{ role: string; content: string | Array<any> }> = [];

    // Prepend systemInstruction if present
    for (const msg of request.messages) {
      // Convert content to string for Ollama (it doesn't support image_url format the same way)
      let content: string;
      if (typeof msg.content === 'string') {
        content = msg.content;
      } else if (msg.content === null) {
        content = '';
      } else if (Array.isArray(msg.content)) {
        // Extract text content, handle images if present
        const textParts: string[] = [];
        for (const part of msg.content) {
          if (part.type === 'text') {
            textParts.push(part.text);
          }
          // Note: Ollama native API supports images differently - via 'images' field with base64
          // For now, we just pass through text content
        }
        content = textParts.join('\n');
      } else {
        content = String(msg.content);
      }

      messages.push({
        role: msg.role,
        content,
      });
    }

    const ollamaRequest: any = {
      model: request.model,
      messages,
      stream: request.stream ?? false,
    };

    // Build options object for Ollama-specific parameters
    const options: any = {};

    if (request.max_tokens !== undefined) {
      options.num_predict = request.max_tokens;
    }

    if (request.temperature !== undefined) {
      options.temperature = request.temperature;
    }

    if (Object.keys(options).length > 0) {
      ollamaRequest.options = options;
    }

    // Handle tools - Ollama uses same format for tools
    if (request.tools && request.tools.length > 0) {
      ollamaRequest.tools = request.tools.map((t: any) => {
        if (t.type === 'function' && t.function) {
          return {
            type: 'function',
            function: {
              name: t.function.name,
              description: t.function.description,
              parameters: t.function.parameters || t.function.parametersJsonSchema,
            },
          };
        }
        return t;
      });
    }

    return ollamaRequest;
  }

  async transformResponse(response: any): Promise<UnifiedChatResponse> {
    // Ollama native response format:
    // {
    //   model: "model-name",
    //   created_at: "2023-08-04T08:52:19.385406455Z",
    //   message: { role: "assistant", content: "...", tool_calls: [...] },
    //   done_reason: "stop",
    //   done: true,
    //   prompt_eval_count: 26,
    //   eval_count: 290
    // }

    const message = response.message || {};
    const usage = this.extractUsageFromResponse(response);

    return {
      id: response.id || `ollama-${Date.now()}`,
      model: response.model,
      created: response.created_at
        ? Math.floor(new Date(response.created_at).getTime() / 1000)
        : Math.floor(Date.now() / 1000),
      content: message.content || null,
      tool_calls: message.tool_calls,
      usage,
      finishReason: response.done_reason || (response.done ? 'stop' : null),
    };
  }

  async formatResponse(response: UnifiedChatResponse): Promise<any> {
    // Format for OpenAI-compatible output (since ingress is /v1/chat/completions)
    return {
      id: response.id,
      object: 'chat.completion',
      created: response.created || Math.floor(Date.now() / 1000),
      model: response.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: response.content,
            tool_calls: response.tool_calls,
          },
          finish_reason: response.tool_calls ? 'tool_calls' : response.finishReason || 'stop',
        },
      ],
      usage: response.usage
        ? {
            prompt_tokens: response.usage.input_tokens + (response.usage.cached_tokens || 0),
            completion_tokens: response.usage.output_tokens,
            total_tokens: response.usage.total_tokens,
            reasoning_tokens: response.usage.reasoning_tokens,
          }
        : undefined,
    };
  }

  /**
   * Transform Ollama NDJSON stream to unified stream chunks
   * Ollama sends newline-delimited JSON, not SSE
   */
  transformStream(stream: ReadableStream): ReadableStream {
    const decoder = new TextDecoder();
    const reader = stream.getReader();

    return new ReadableStream({
      async start(controller) {
        let buffer = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Split on newlines - NDJSON format
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            for (const line of lines) {
              if (!line.trim()) continue;

              try {
                const data = JSON.parse(line);
                const unifiedChunk = parseOllamaChunk(data);
                if (unifiedChunk) {
                  controller.enqueue(unifiedChunk);
                }
              } catch (e) {
                // Skip unparseable lines
              }
            }
          }

          // Process remaining buffer
          if (buffer.trim()) {
            try {
              const data = JSON.parse(buffer);
              const unifiedChunk = parseOllamaChunk(data);
              if (unifiedChunk) {
                controller.enqueue(unifiedChunk);
              }
            } catch (e) {
              // Ignore parse errors on final fragment
            }
          }

          controller.close();
        } catch (error) {
          controller.error(error);
        } finally {
          reader.releaseLock();
        }
      },
    });
  }

  /**
   * Format unified stream chunks to OpenAI-compatible SSE format
   */
  formatStream(stream: ReadableStream): ReadableStream {
    const encoder = new TextEncoder();
    const reader = stream.getReader();

    return new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value: unifiedChunk } = await reader.read();
            if (done) {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              break;
            }

            const chunk: any = {
              id: unifiedChunk.id,
              object: 'chat.completion.chunk',
              created: unifiedChunk.created || Math.floor(Date.now() / 1000),
              model: unifiedChunk.model,
              choices: [
                {
                  index: 0,
                  delta: unifiedChunk.delta,
                  finish_reason: unifiedChunk.finish_reason,
                },
              ],
            };

            if (unifiedChunk.usage) {
              chunk.usage = {
                prompt_tokens:
                  unifiedChunk.usage.input_tokens + (unifiedChunk.usage.cached_tokens || 0),
                completion_tokens: unifiedChunk.usage.output_tokens,
                total_tokens: unifiedChunk.usage.total_tokens,
                reasoning_tokens: unifiedChunk.usage.reasoning_tokens,
              };
            }

            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          }
        } finally {
          reader.releaseLock();
          controller.close();
        }
      },
    });
  }

  /**
   * Extract usage from Ollama chunk data (JSON string for SSE compatibility)
   */
  extractUsage(dataStr: string):
    | {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
        cached_tokens?: number;
        cache_creation_tokens?: number;
        reasoning_tokens?: number;
      }
    | undefined {
    try {
      const data = JSON.parse(dataStr);
      return this.extractUsageFromResponse(data);
    } catch (e) {
      return undefined;
    }
  }

  private extractUsageFromResponse(data: any): UnifiedChatResponse['usage'] {
    // Ollama native format uses prompt_eval_count and eval_count
    const promptEvalCount = data?.prompt_eval_count ?? data?.prompt_eval_duration;
    const evalCount = data?.eval_count ?? data?.eval_duration;

    if (promptEvalCount === undefined && evalCount === undefined) {
      return undefined;
    }

    return {
      input_tokens: promptEvalCount ?? 0,
      output_tokens: evalCount ?? 0,
      total_tokens: (promptEvalCount ?? 0) + (evalCount ?? 0),
      reasoning_tokens: 0,
      cached_tokens: 0,
      cache_creation_tokens: 0,
    };
  }
}

/**
 * Parse an Ollama NDJSON chunk into a UnifiedChatStreamChunk
 */
function parseOllamaChunk(data: any): UnifiedChatStreamChunk | null {
  // Ollama streaming format:
  // Each line is a JSON object with incremental content
  // {
  //   model: "llama3",
  //   created_at: "2023-08-04T08:52:19.385406455Z",
  //   message: { role: "assistant", content: "..." },
  //   done: false
  // }
  // Final chunk has done: true with eval_count / prompt_eval_count

  const message = data.message || {};

  // For streaming, content comes incrementally in message.content
  const content = message.content || '';

  // If done is true, this is the final chunk
  const isDone = data.done === true;
  const doneReason = data.done_reason || (isDone ? 'stop' : undefined);

  // Extract usage from final chunk
  let usage: UnifiedChatStreamChunk['usage'] = undefined;
  if (isDone) {
    const promptEvalCount = data.prompt_eval_count ?? 0;
    const evalCount = data.eval_count ?? 0;
    usage = {
      input_tokens: promptEvalCount,
      output_tokens: evalCount,
      total_tokens: promptEvalCount + evalCount,
      reasoning_tokens: 0,
      cached_tokens: 0,
      cache_creation_tokens: 0,
    };
  }

  return {
    id: data.id || `ollama-${Date.now()}`,
    model: data.model,
    created: data.created_at
      ? Math.floor(new Date(data.created_at).getTime() / 1000)
      : Math.floor(Date.now() / 1000),
    delta: {
      role: message.role || 'assistant',
      content: content || undefined,
      tool_calls: message.tool_calls,
    },
    finish_reason: doneReason || null,
    usage,
  };
}
