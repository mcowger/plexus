import { Transformer } from '../types/transformer';
import { UnifiedChatRequest, UnifiedChatResponse } from '../types/unified';
import { extractOpenAIUsage } from './usage-extractors';
import { createParser, EventSourceMessage } from 'eventsource-parser';
import { encode } from 'eventsource-encoder';

/**
 * OpenAITransformer
 * 
 * Handles transformation between OpenAI Chat Completions API and the internal Unified format.
 * Used for OpenAI, OpenRouter, DeepSeek, and other OpenAI-compatible providers.
 */
export class OpenAITransformer implements Transformer {
  name = 'chat';
  defaultEndpoint = '/chat/completions';

  /**
   * parseRequest (Client -> Unified)
   * Converts an incoming OpenAI-style request body into our internal UnifiedChatRequest.
   */
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

  /**
   * transformRequest (Unified -> Provider)
   * Converts our internal UnifiedChatRequest into an OpenAI-style body for the upstream provider.
   */
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

  /**
   * transformResponse (Provider -> Unified)
   * Converts a successful OpenAI unary response into our internal UnifiedChatResponse.
   */
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

  /**
   * formatResponse (Unified -> Client)
   * Formats our internal UnifiedChatResponse back into the standard OpenAI response format for the client.
   */
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

  /**
   * transformStream (Provider Stream -> Unified Stream)
   * Uses eventsource-parser to robustly handle incoming SSE chunks from the provider.
   * This solves fragmentation issues where JSON chunks are split across network packets.
   */
  transformStream(stream: ReadableStream): ReadableStream {
    const decoder = new TextDecoder();
    let parser: any;
    
    const transformer = new TransformStream({
        start(controller) {
            // Initialize the SSE parser
            parser = createParser({
                onEvent: (event: EventSourceMessage) => {
                    // Standard OpenAI terminator
                    if (event.data === '[DONE]') return;
                    
                    try {
                        const data = JSON.parse(event.data);
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
                        // Incomplete or malformed JSON chunks are ignored by the parser
                        // until a complete event is buffered.
                    }
                }
            });
        },
        transform(chunk, controller) {
            // Feed raw chunks into the parser
            const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
            parser.feed(text);
        }
    });
    
    return stream.pipeThrough(transformer);
  }

  /**
   * formatStream (Unified Stream -> Client Stream)
   * Uses eventsource-encoder to properly format our unified chunks as valid SSE for the client.
   */
  formatStream(stream: ReadableStream): ReadableStream {
    const encoder = new TextEncoder();
    
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

            // Use eventsource-encoder to ensure proper SSE data: prefix and newlines
            const sseMessage = encode({ 
                data: JSON.stringify(openAIChunk) 
            });
            controller.enqueue(encoder.encode(sseMessage));
        },
        flush(controller) {
            // Send final termination signal
            controller.enqueue(encoder.encode(encode({ data: '[DONE]' })));
        }
    });
    
    return stream.pipeThrough(transformer);
  }

  /**
   * extractUsage
   * Legacy utility for extracting usage from raw strings.
   */
  extractUsage(input: string) {
    return extractOpenAIUsage(input);
  }
}
