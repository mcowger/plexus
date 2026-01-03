import { Transformer } from '../types/transformer';
import { UnifiedChatRequest, UnifiedChatResponse } from '../types/unified';
import { extractOpenAIUsage } from './usage-extractors';

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
        reasoning: input.reasoning
    };
  }

  async transformRequest(request: UnifiedChatRequest): Promise<any> {
    return {
        model: request.model,
        messages: request.messages,
        max_tokens: request.max_tokens,
        temperature: request.temperature,
        stream: request.stream,
        tools: request.tools,
        tool_choice: request.tool_choice
    };
  }

  async transformResponse(response: any): Promise<UnifiedChatResponse> {
    const choice = response.choices?.[0];
    const message = choice?.message;

    const usage = response.usage ? {
        input_tokens: response.usage.prompt_tokens || 0,
        output_tokens: response.usage.completion_tokens || 0,
        total_tokens: response.usage.total_tokens || 0,
        reasoning_tokens: response.usage.completion_tokens_details?.reasoning_tokens || 0,
        cached_tokens: response.usage.prompt_tokens_details?.cached_tokens || 0,
        cache_creation_tokens: 0
    } : undefined;

    return {
        id: response.id,
        model: response.model,
        created: response.created,
        content: message?.content || null,
        reasoning_content: message?.reasoning_content || null,
        tool_calls: message?.tool_calls,
        usage
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
                    tool_calls: response.tool_calls
                },
                finish_reason: response.tool_calls ? 'tool_calls' : 'stop'
            }
        ],
        usage: response.usage ? {
            prompt_tokens: response.usage.input_tokens,
            completion_tokens: response.usage.output_tokens,
            total_tokens: response.usage.total_tokens,
            prompt_tokens_details: null,
            reasoning_tokens: response.usage.reasoning_tokens
        } : undefined
    };
          }
        
          // --- 5. Provider Stream (OpenAI) -> Unified Stream ---
          transformStream(stream: ReadableStream): ReadableStream {
            const decoder = new TextDecoder();
            let buffer = "";
            
            // Use TransformStream for proper backpressure handling and stream lifecycle
            const transformer = new TransformStream({
                transform(chunk, controller) {
                    const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
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
                            const choice = data.choices?.[0];
                            
                            const usage = data.usage ? {
                                input_tokens: data.usage.prompt_tokens || 0,
                                output_tokens: data.usage.completion_tokens || 0,
                                total_tokens: data.usage.total_tokens || 0,
                                reasoning_tokens: data.usage.completion_tokens_details?.reasoning_tokens || 0,
                                cached_tokens: data.usage.prompt_tokens_details?.cached_tokens || 0,
                                cache_creation_tokens: 0
                            } : undefined;

                            const unifiedChunk = {
                                id: data.id,
                                model: data.model,
                                created: data.created,
                                delta: {
                                    role: choice?.delta?.role,
                                    content: choice?.delta?.content,
                                    reasoning_content: choice?.delta?.reasoning_content,
                                    tool_calls: choice?.delta?.tool_calls
                                },
                                finish_reason: choice?.finish_reason,
                                usage
                            };
                            controller.enqueue(unifiedChunk);
                        } catch (e) {
                            // Ignore parse errors for non-JSON lines
                        }
                    }
                },
                flush(controller) {
                    // Process any remaining buffer content
                    if (buffer.trim()) {
                        const trimmedLine = buffer.trim();
                        if (trimmedLine.startsWith("data:")) {
                            const dataStr = trimmedLine.slice(5).trim();
                            if (dataStr !== "[DONE]") {
                                try {
                                    const data = JSON.parse(dataStr);
                                    const choice = data.choices?.[0];
                                    controller.enqueue({
                                        id: data.id,
                                        model: data.model,
                                        created: data.created,
                                        delta: {
                                            role: choice?.delta?.role,
                                            content: choice?.delta?.content,
                                            reasoning_content: choice?.delta?.reasoning_content,
                                            tool_calls: choice?.delta?.tool_calls
                                        },
                                        finish_reason: choice?.finish_reason
                                    });
                                } catch (e) {
                                    // Ignore
                                }
                            }
                        }
                    }
                }
            });
            
            return stream.pipeThrough(transformer);
          }
        
          // --- 6. Unified Stream -> Client Stream (OpenAI) ---
          formatStream(stream: ReadableStream): ReadableStream {
            const encoder = new TextEncoder();
            
            // Use TransformStream for proper backpressure handling
            const transformer = new TransformStream({
                transform(unifiedChunk: any, controller) {
                    const openAIChunk = {
                        id: unifiedChunk.id || 'chatcmpl-' + Date.now(),
                        object: 'chat.completion.chunk',
                        created: unifiedChunk.created || Math.floor(Date.now() / 1000),
                        model: unifiedChunk.model,
                        choices: [
                            {
                                index: 0,
                                delta: unifiedChunk.delta,
                                finish_reason: unifiedChunk.finish_reason || null
                            }
                        ],
                        usage: unifiedChunk.usage ? {
                            prompt_tokens: unifiedChunk.usage.input_tokens,
                            completion_tokens: unifiedChunk.usage.output_tokens,
                            total_tokens: unifiedChunk.usage.total_tokens,
                            prompt_tokens_details: {
                                cached_tokens: unifiedChunk.usage.cached_tokens
                            },
                            completion_tokens_details: {
                                reasoning_tokens: unifiedChunk.usage.reasoning_tokens
                            }
                        } : undefined
                    };

                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAIChunk)}\n\n`));
                },
                flush(controller) {
                    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                }
            });
            
            return stream.pipeThrough(transformer);
          }

          // --- 7. Extract usage from raw SSE chunk ---
          extractUsage(chunk: Uint8Array | string) {
            return extractOpenAIUsage(chunk);
          }
        }
        