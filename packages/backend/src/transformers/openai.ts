import { Transformer } from '../types/transformer';
import { UnifiedChatRequest, UnifiedChatResponse } from '../types/unified';
import { createParser, EventSourceMessage } from 'eventsource-parser';
import { encode } from 'eventsource-encoder';
import { normalizeOpenAIChatUsage } from '../utils/usage-normalizer';

/**
 * OpenAITransformer
 */
export class OpenAITransformer implements Transformer {
  name = 'chat';
  defaultEndpoint = '/chat/completions';

  async parseRequest(input: any): Promise<UnifiedChatRequest> {
    return {
      messages: input.messages,
      model: input.model,
      max_tokens: input.max_tokens,
      temperature: input.temperature,
      stream: input.stream,
      tools: input.tools,
      tool_choice: input.tool_choice,
      reasoning: input.reasoning,
    };
  }

  async transformRequest(request: UnifiedChatRequest): Promise<any> {
    // Prepend systemInstruction as a system message if present
    const messages =
      request.systemInstruction && request.systemInstruction.content
        ? [{ role: 'system', content: request.systemInstruction.content }, ...request.messages]
        : request.messages;

    // Normalize tools: map parametersJsonSchema -> parameters for OpenAI format.
    const normalizedTools =
      request.tools && request.tools.length > 0
        ? request.tools.map((t: any) => {
            if (t.type !== 'function' || !t.function) return t;
            const fn = t.function;
            // If parametersJsonSchema is present, prefer it over parameters
            const parameters = fn.parametersJsonSchema ?? fn.parameters;
            return {
              type: 'function',
              function: {
                name: fn.name,
                description: fn.description,
                parameters,
              },
            };
          })
        : undefined;

    const out: any = {
      model: request.model,
      messages,
      max_tokens: request.max_tokens,
      temperature: request.temperature,
      stream: request.stream,
      tools: normalizedTools && normalizedTools.length > 0 ? normalizedTools : undefined,
      tool_choice: request.tool_choice,
    };

    if (request.response_format) {
      if (request.response_format.type === 'json_schema' && request.response_format.json_schema) {
        // OpenAI json_schema mode requires {name, schema, strict} wrapping
        out.response_format = {
          type: 'json_schema',
          json_schema: {
            name: 'response_schema',
            schema: request.response_format.json_schema,
            strict: true,
          },
        };
      } else {
        out.response_format = request.response_format;
      }
    }

    if (request.reasoning) {
      out.reasoning = request.reasoning;
    }

    if (request.parallel_tool_calls !== undefined) {
      out.parallel_tool_calls = request.parallel_tool_calls;
    }

    return out;
  }

  async transformResponse(response: any): Promise<UnifiedChatResponse> {
    const choice = response.choices?.[0];
    const message = choice?.message;

    const usage = response.usage ? normalizeOpenAIChatUsage(response.usage) : undefined;

    return {
      id: response.id,
      model: response.model,
      created: response.created,
      content: message?.content || null,
      reasoning_content: message?.reasoning_content || null,
      tool_calls: message?.tool_calls,
      usage,
      finishReason: choice?.finish_reason || null,
    };
  }

  async formatResponse(response: UnifiedChatResponse): Promise<any> {
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
            reasoning_content: response.reasoning_content,
            tool_calls: response.tool_calls,
          },
          finish_reason: response.tool_calls ? 'tool_calls' : 'stop',
        },
      ],
      usage: response.usage
        ? {
            prompt_tokens: response.usage.input_tokens + (response.usage.cached_tokens || 0),
            completion_tokens: response.usage.output_tokens,
            total_tokens: response.usage.total_tokens,
            prompt_tokens_details: response.usage.cached_tokens
              ? { cached_tokens: response.usage.cached_tokens }
              : null,
            reasoning_tokens: response.usage.reasoning_tokens,
          }
        : undefined,
    };
  }

  transformStream(stream: ReadableStream): ReadableStream {
    const decoder = new TextDecoder();

    return new ReadableStream({
      async start(controller) {
        const parser = createParser({
          onEvent: (event: EventSourceMessage) => {
            if (event.data === '[DONE]') return;

            try {
              const data = JSON.parse(event.data);

              const choice = data.choices?.[0];

              const usage = data.usage ? normalizeOpenAIChatUsage(data.usage) : undefined;

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
                  choice?.finish_reason || data.finish_reason || (choice?.delta ? null : 'stop'),
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
            parser.feed(decoder.decode(value, { stream: true }));
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

    return new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value: unifiedChunk } = await reader.read();
            if (done) {
              controller.enqueue(encoder.encode(encode({ data: '[DONE]' })));
              break;
            }

            const choice: any = {
              index: 0,
              delta: unifiedChunk.delta,
              finish_reason: unifiedChunk.finish_reason,
            };

            const chunk: any = {
              id: unifiedChunk.id,
              object: 'chat.completion.chunk',
              created: unifiedChunk.created || Math.floor(Date.now() / 1000),
              model: unifiedChunk.model,
              choices: [choice],
            };

            if (unifiedChunk.usage) {
              chunk.usage = {
                prompt_tokens:
                  unifiedChunk.usage.input_tokens + (unifiedChunk.usage.cached_tokens || 0),
                completion_tokens: unifiedChunk.usage.output_tokens,
                total_tokens: unifiedChunk.usage.total_tokens,
                prompt_tokens_details: unifiedChunk.usage.cached_tokens
                  ? { cached_tokens: unifiedChunk.usage.cached_tokens }
                  : null,
                reasoning_tokens: unifiedChunk.usage.reasoning_tokens,
              };
            }

            controller.enqueue(encoder.encode(encode({ data: JSON.stringify(chunk) })));
          }
        } finally {
          reader.releaseLock();
          controller.close();
        }
      },
    });
  }
  /**
   * Extract usage from OpenAI-style event data (already parsed JSON string)
   */
  extractUsage(dataStr: string):
    | {
        input_tokens?: number;
        output_tokens?: number;
        cached_tokens?: number;
        cache_creation_tokens?: number;
        reasoning_tokens?: number;
      }
    | undefined {
    try {
      const data = JSON.parse(dataStr);
      if (data.usage) {
        const usage = normalizeOpenAIChatUsage(data.usage);
        return {
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          cached_tokens: usage.cached_tokens,
          cache_creation_tokens: usage.cache_creation_tokens,
          reasoning_tokens: usage.reasoning_tokens,
        };
      }
    } catch (e) {
      // Ignore parse errors
    }

    return undefined;
  }
}
