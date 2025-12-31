import { Transformer } from '../types/transformer';
import { UnifiedChatRequest, UnifiedChatResponse } from '../types/unified';

export class OpenAITransformer implements Transformer {
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

    return {
        id: response.id,
        model: response.model,
        created: response.created,
        content: message?.content || null,
        reasoning_content: message?.reasoning_content || null,
        tool_calls: message?.tool_calls,
        usage: response.usage
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
                usage: response.usage
            };
          }
        
          // --- 5. Provider Stream (OpenAI) -> Unified Stream ---
          transformStream(stream: ReadableStream): ReadableStream {
            const decoder = new TextDecoder();
            let buffer = "";
        
            return new ReadableStream({
                async start(controller) {
                    const reader = stream.getReader();
                    try {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
        
                            buffer += decoder.decode(value, { stream: true });
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
                                    
                                    const chunk = {
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
                                        usage: data.usage
                                    };
                                    controller.enqueue(chunk);
                                } catch (e) {
                                    // Ignore parse errors for non-JSON lines
                                }
                            }
                        }
                    } catch (e) {
                        controller.error(e);
                    } finally {
                        reader.releaseLock();
                        controller.close();
                    }
                }
            });
          }
        
          // --- 6. Unified Stream -> Client Stream (OpenAI) ---
          formatStream(stream: ReadableStream): ReadableStream {
            const encoder = new TextEncoder();
        
            return new ReadableStream({
                async start(controller) {
                    const reader = stream.getReader();
                    try {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
        
                            const unifiedChunk = value as any;
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
                                usage: unifiedChunk.usage
                            };
        
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAIChunk)}\n\n`));
                        }
                        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                    } catch (e) {
                        controller.error(e);
                    } finally {
                        reader.releaseLock();
                        controller.close();
                    }
                }
            });
          }
        }
        