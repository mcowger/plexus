import { Transformer } from '../types/transformer';
import { UnifiedChatRequest, UnifiedChatResponse, UnifiedMessage, UnifiedTool, MessageContent } from '../types/unified';
import { logger } from '../utils/logger';

export class AnthropicTransformer implements Transformer {
  defaultEndpoint = '/messages';
  
  // --- 1. Client (Anthropic) -> Unified ---
  async parseRequest(input: any): Promise<UnifiedChatRequest> {
    const messages: UnifiedMessage[] = [];

    // System
    if (input.system) {
      messages.push({ role: 'system', content: input.system });
    }

    // Messages
    if (input.messages) {
      for (const msg of input.messages) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          if (typeof msg.content === 'string') {
            messages.push({ role: msg.role, content: msg.content });
          } else if (Array.isArray(msg.content)) {
            const unifiedMsg: UnifiedMessage = { role: msg.role, content: '' };
            
            // Check for tool results
            const toolResults = msg.content.filter((c: any) => c.type === 'tool_result');
            if (toolResults.length > 0 && msg.role === 'user') {
                for (const tool of toolResults) {
                    messages.push({
                        role: 'tool',
                        content: typeof tool.content === 'string' ? tool.content : JSON.stringify(tool.content),
                        tool_call_id: tool.tool_use_id,
                    });
                }
                const otherParts = msg.content.filter((c: any) => c.type !== 'tool_result');
                if (otherParts.length > 0) {
                     messages.push({
                        role: 'user',
                        content: this.convertAnthropicContent(otherParts)
                    });
                }
                continue; 
            }

            // Handle tool calls
            const toolUses = msg.content.filter((c: any) => c.type === 'tool_use');
            if (toolUses.length > 0 && msg.role === 'assistant') {
                unifiedMsg.tool_calls = toolUses.map((t: any) => ({
                    id: t.id,
                    type: 'function',
                    function: {
                        name: t.name,
                        arguments: JSON.stringify(t.input)
                    }
                }));
            }

            // Handle Thinking/Reasoning
            const thinkingPart = msg.content.find((c: any) => c.type === 'thinking');
            if (thinkingPart && msg.role === 'assistant') {
                unifiedMsg.thinking = {
                    content: thinkingPart.thinking,
                    signature: thinkingPart.signature
                };
            }

            // Text/Image content
            const contentParts = msg.content.filter((c: any) => c.type !== 'tool_use' && c.type !== 'tool_result' && c.type !== 'thinking');
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
      tools: input.tools ? this.convertAnthropicToolsToUnified(input.tools) : undefined,
      tool_choice: input.tool_choice
    };
  }

  // --- 4. Unified -> Client (Anthropic) ---
  async formatResponse(response: UnifiedChatResponse): Promise<any> {
    const content: any[] = [];

    // Reasoning/Thinking content
    if (response.reasoning_content) {
        content.push({
            type: 'thinking',
            thinking: response.reasoning_content
        });
    }

    // Text content
    if (response.content) {
        content.push({ type: 'text', text: response.content });
    }

    // Tool Calls
    if (response.tool_calls) {
        for (const toolCall of response.tool_calls) {
            content.push({
                type: 'tool_use',
                id: toolCall.id,
                name: toolCall.function.name,
                input: JSON.parse(toolCall.function.arguments)
            });
        }
    }

    return {
        id: response.id,
        type: 'message',
        role: 'assistant',
        model: response.model,
        content,
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
            input_tokens: response.usage?.prompt_tokens || 0,
            output_tokens: response.usage?.completion_tokens || 0,
            cache_read_input_tokens: response.usage?.prompt_tokens_details?.cached_tokens || 0,
            // Anthropic doesn't explicitly return reasoning tokens in usage object typically, but if we had to map it:
            // It might be implicitly part of output_tokens.
        }
    };
  }

  // --- 2. Unified -> Provider (Anthropic) ---
  async transformRequest(request: UnifiedChatRequest): Promise<any> {
    let system: string | undefined;
    const messages: any[] = [];

    for (const msg of request.messages) {
        if (msg.role === 'system') {
            system = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        } else if (msg.role === 'user' || msg.role === 'assistant') {
            const content: any[] = [];
            
            if (msg.thinking) {
                content.push({
                    type: 'thinking',
                    thinking: msg.thinking.content,
                    signature: msg.thinking.signature
                });
            }

            if (msg.content) {
                if (typeof msg.content === 'string') {
                    content.push({ type: 'text', text: msg.content });
                } else if (Array.isArray(msg.content)) {
                    for (const part of msg.content) {
                        if (part.type === 'text') {
                            content.push({ type: 'text', text: part.text });
                        } else if (part.type === 'image_url') {
                             content.push({ type: 'image', source: { type: 'base64', media_type: part.media_type || 'image/jpeg', data: '' } }); 
                        }
                    }
                }
            }

            if (msg.role === 'assistant' && msg.tool_calls) {
                for (const tc of msg.tool_calls) {
                    content.push({
                        type: 'tool_use',
                        id: tc.id,
                        name: tc.function.name,
                        input: JSON.parse(tc.function.arguments)
                    });
                }
            }

            messages.push({ role: msg.role, content });
        } else if (msg.role === 'tool') {
             messages.push({
                 role: 'user',
                 content: [{
                     type: 'tool_result',
                     tool_use_id: msg.tool_call_id,
                     content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
                 }]
             });
        }
    }

    const mergedMessages: any[] = [];
    for (const msg of messages) {
        if (mergedMessages.length > 0) {
            const last = mergedMessages[mergedMessages.length - 1];
            if (last.role === msg.role && msg.role === 'user') {
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
        tools: request.tools ? this.convertUnifiedToolsToAnthropic(request.tools) : undefined
    };
  }

  // --- 3. Provider (Anthropic) -> Unified ---
  async transformResponse(response: any): Promise<UnifiedChatResponse> {
    const contentBlocks = response.content || [];
    let text = '';
    let reasoning = '';
    const toolCalls: any[] = [];

    for (const block of contentBlocks) {
        if (block.type === 'text') {
            text += block.text;
        } else if (block.type === 'thinking') {
            reasoning += block.thinking;
        } else if (block.type === 'tool_use') {
            toolCalls.push({
                id: block.id,
                type: 'function',
                function: {
                    name: block.name,
                    arguments: JSON.stringify(block.input)
                }
            });
        }
    }

    return {
        id: response.id,
        model: response.model,
        content: text || null,
        reasoning_content: reasoning || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: {
            prompt_tokens: response.usage?.input_tokens || 0,
            completion_tokens: response.usage?.output_tokens || 0,
            total_tokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
            prompt_tokens_details: {
                cached_tokens: response.usage?.cache_read_input_tokens || 0
            }
        }
    };
  }

  // --- 5. Provider Stream (Anthropic) -> Unified Stream ---
  transformStream(stream: ReadableStream): ReadableStream {
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
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
                            let chunk: any = null;

                            switch (data.type) {
                                case 'message_start':
                                    chunk = {
                                        id: data.message.id,
                                        model: data.message.model,
                                        created: Math.floor(Date.now() / 1000),
                                        delta: { role: 'assistant' }
                                    };
                                    break;
                                case 'content_block_delta':
                                    if (data.delta.type === 'text_delta') {
                                        chunk = {
                                            delta: { content: data.delta.text }
                                        };
                                    } else if (data.delta.type === 'thinking_delta') {
                                        chunk = {
                                            delta: { reasoning_content: data.delta.thinking }
                                        };
                                    } else if (data.delta.type === 'input_json_delta') {
                                         chunk = {
                                            delta: {
                                                tool_calls: [{
                                                    index: data.index,
                                                    function: { arguments: data.delta.partial_json }
                                                }]
                                            }
                                        };
                                    }
                                    break;
                                case 'content_block_start':
                                    if (data.content_block.type === 'tool_use') {
                                        chunk = {
                                            delta: {
                                                tool_calls: [{
                                                    index: data.index,
                                                    id: data.content_block.id,
                                                    type: 'function',
                                                    function: {
                                                        name: data.content_block.name,
                                                        arguments: ""
                                                    }
                                                }]
                                            }
                                        };
                                    }
                                    break;
                                case 'message_delta':
                                    chunk = {
                                        finish_reason: data.delta.stop_reason === 'end_turn' ? 'stop' : 
                                                      data.delta.stop_reason === 'tool_use' ? 'tool_calls' : 
                                                      data.delta.stop_reason,
                                        usage: data.usage ? {
                                            prompt_tokens: data.usage.input_tokens,
                                            completion_tokens: data.usage.output_tokens,
                                            total_tokens: data.usage.input_tokens + data.usage.output_tokens
                                        } : undefined
                                    };
                                    break;
                            }

                            if (chunk) {
                                controller.enqueue(chunk);
                            }
                        } catch (e) {
                            logger.error('Error parsing Anthropic stream chunk', e);
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

  // --- 6. Unified Stream -> Client Stream (Anthropic) ---
  formatStream(stream: ReadableStream): ReadableStream {
    const encoder = new TextEncoder();
    let hasSentStart = false;
    let contentBlockIndex = 0;

    return new ReadableStream({
        async start(controller) {
            const reader = stream.getReader();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = value as any;

                    if (!hasSentStart) {
                        const messageStart = {
                            type: 'message_start',
                            message: {
                                id: chunk.id || 'msg_' + Date.now(),
                                type: 'message',
                                role: 'assistant',
                                model: chunk.model,
                                content: [],
                                stop_reason: null,
                                stop_sequence: null,
                                usage: { input_tokens: 0, output_tokens: 0 }
                            }
                        };
                        controller.enqueue(encoder.encode(`event: message_start\ndata: ${JSON.stringify(messageStart)}\n\n`));
                        hasSentStart = true;
                    }

                    if (chunk.delta) {
                        if (chunk.delta.content) {
                            // Simplified: send as content_block_start + content_block_delta if first time, or just delta
                            // For simplicity in this implementation, we'll just send text_delta
                            // In a full implementation, you'd track content blocks
                            const textDelta = {
                                type: 'content_block_delta',
                                index: 0,
                                delta: { type: 'text_delta', text: chunk.delta.content }
                            };
                            
                            // If it's the very first content, Anthropic usually sends content_block_start first
                            // but many clients handle just deltas if index 0 is assumed.
                            controller.enqueue(encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(textDelta)}\n\n`));
                        }
                        
                        if (chunk.delta.reasoning_content) {
                            const thinkingDelta = {
                                type: 'content_block_delta',
                                index: 0,
                                delta: { type: 'thinking_delta', thinking: chunk.delta.reasoning_content }
                            };
                            controller.enqueue(encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(thinkingDelta)}\n\n`));
                        }

                        if (chunk.delta.tool_calls) {
                            for (const tc of chunk.delta.tool_calls) {
                                // Simplified tool call streaming
                                const toolDelta = {
                                    type: 'content_block_delta',
                                    index: tc.index || 0,
                                    delta: { type: 'input_json_delta', partial_json: tc.function?.arguments || "" }
                                };
                                controller.enqueue(encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(toolDelta)}\n\n`));
                            }
                        }
                    }

                    if (chunk.finish_reason) {
                        const messageDelta = {
                            type: 'message_delta',
                            delta: {
                                stop_reason: chunk.finish_reason === 'stop' ? 'end_turn' : 
                                            chunk.finish_reason === 'tool_calls' ? 'tool_use' : 
                                            chunk.finish_reason,
                                stop_sequence: null
                            },
                            usage: chunk.usage ? {
                                output_tokens: chunk.usage.completion_tokens
                            } : undefined
                        };
                        controller.enqueue(encoder.encode(`event: message_delta\ndata: ${JSON.stringify(messageDelta)}\n\n`));
                        
                        const messageStop = { type: 'message_stop' };
                        controller.enqueue(encoder.encode(`event: message_stop\ndata: ${JSON.stringify(messageStop)}\n\n`));
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

  // Helpers

  private convertAnthropicContent(content: any[]): string | MessageContent[] {
     const parts: MessageContent[] = [];
     for (const c of content) {
         if (c.type === 'text') parts.push({ type: 'text', text: c.text });
     }
     if (parts.length === 1 && parts[0].type === 'text') return parts[0].text;
     return parts;
  }

  private convertAnthropicToolsToUnified(tools: any[]): UnifiedTool[] {
      return tools.map(t => ({
          type: 'function',
          function: {
              name: t.name,
              description: t.description,
              parameters: t.input_schema
          }
      }));
  }

  private convertUnifiedToolsToAnthropic(tools: UnifiedTool[]): any[] {
      return tools.map(t => ({
          name: t.function.name,
          description: t.function.description,
          input_schema: t.function.parameters
      }));
  }
}
