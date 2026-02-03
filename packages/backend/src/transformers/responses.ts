import { Transformer } from "../types/transformer";
import { UnifiedResponsesRequest, UnifiedResponsesResponse, ResponsesStreamEvent, ResponsesInputItem, ResponsesMessageItem, ResponsesFunctionCallItem, ResponsesFunctionCallOutputItem, ResponsesOutputItem } from "../types/responses";
import { UnifiedChatRequest, UnifiedChatResponse, UnifiedMessage } from "../types/unified";
import { createParser } from "eventsource-parser";
import { encode } from "eventsource-encoder";
import { logger } from "../utils/logger";

/**
 * ResponsesTransformer
 * 
 * Implements the OpenAI Responses API format transformer.
 * Handles bidirectional transformation between Responses API and Chat Completions formats.
 */
export class ResponsesTransformer implements Transformer {
  name = "responses";
  defaultEndpoint = "/responses";

  /**
   * Parses incoming Responses API request into unified format
   */
  async parseRequest(input: any): Promise<UnifiedChatRequest> {
    // Validate required fields
    if (!input.model) {
      throw new Error("Missing required field: model");
    }
    if (!input.input) {
      throw new Error("Missing required field: input");
    }

    // Normalize input to array format
    const normalizedInput = this.normalizeInput(input.input);

    // Convert input items to Chat Completions messages
    const messages = this.convertInputItemsToMessages(normalizedInput);

    // Add instructions as system message if present
    if (input.instructions) {
      messages.unshift({
        role: 'system',
        content: input.instructions
      });
    }

    // Convert tools (filter out built-in tools that Chat Completions doesn't support)
    const tools = this.convertToolsForChatCompletions(input.tools || []);

    return {
      requestId: input.requestId,
      model: input.model,
      messages,
      max_tokens: input.max_output_tokens,
      temperature: input.temperature ?? 1.0,
      stream: input.stream ?? false,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: this.convertToolChoiceForChatCompletions(input.tool_choice),
      reasoning: input.reasoning,
      response_format: input.text?.format ? {
        type: input.text.format.type,
        json_schema: input.text.format.schema
      } : undefined,
      metadata: input.metadata,
      incomingApiType: 'responses',
      originalBody: input,
    };
  }

  /**
   * Transforms Chat Completions request to Responses API format (not typically needed)
   */
  async transformRequest(request: UnifiedChatRequest): Promise<any> {
    // Convert UnifiedChatRequest to Responses API format
    const inputItems: any[] = [];

    // Convert messages to input items
    for (const msg of request.messages) {
      if (msg.role === 'system') {
        // System messages become instructions (not input items)
        continue; // Will be handled below
      } else if (msg.role === 'user' || msg.role === 'assistant') {
        const content: any[] = [];

        if (typeof msg.content === 'string') {
          content.push({
            type: msg.role === 'user' ? 'input_text' : 'output_text',
            text: msg.content
          });
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === 'text') {
              content.push({
                type: msg.role === 'user' ? 'input_text' : 'output_text',
                text: part.text
              });
            } else if (part.type === 'image_url') {
              content.push({
                type: 'input_image',
                image_url: part.image_url.url,
                detail: 'auto'
              });
            }
          }
        }

        inputItems.push({
          type: 'message',
          role: msg.role,
          content
        });
      } else if (msg.role === 'tool') {
        // Tool result becomes function_call_output item
        inputItems.push({
          type: 'function_call_output',
          call_id: msg.tool_call_id,
          output: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
        });
      }

      // If assistant message has tool calls, add them as function_call items
      if (msg.role === 'assistant' && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          inputItems.push({
            type: 'function_call',
            call_id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments
          });
        }
      }
    }

    // Extract system message for instructions
    const systemMessage = request.messages.find(m => m.role === 'system');
    const instructions = systemMessage 
      ? (typeof systemMessage.content === 'string' ? systemMessage.content : JSON.stringify(systemMessage.content))
      : undefined;

    // Convert tools to Responses API format
    const tools = request.tools?.map(tool => ({
      type: 'function',
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters
    }));

    const payload: any = {
      model: request.model,
      input: inputItems,
      stream: request.stream
    };

    if (instructions) {
      payload.instructions = instructions;
    }
    if (request.max_tokens) {
      payload.max_output_tokens = request.max_tokens;
    }
    if (request.temperature !== undefined) {
      payload.temperature = request.temperature;
    }
    if (tools && tools.length > 0) {
      payload.tools = tools;
    }
    if (request.tool_choice) {
      payload.tool_choice = request.tool_choice;
    }

    return payload;
  }

  /**
   * Transforms provider response to unified chat format
   * (inherited from Transformer interface)
   */
  async transformResponse(response: any): Promise<UnifiedChatResponse> {
    // This method handles TWO cases:
    // 1. Converting Chat Completions format to Unified (when routing responses -> chat)
    // 2. Converting Responses API format to Unified (when routing responses -> responses in passthrough)
    
    // Detect which format we received
    if (response.output && response.object === 'response') {
      // Case 2: Responses API format (passthrough mode)
      // Extract usage from Responses API format
      const usage = response.usage
        ? {
            input_tokens: response.usage.input_tokens || 0,
            output_tokens: response.usage.output_tokens || 0,
            total_tokens: response.usage.total_tokens || 0,
            reasoning_tokens: response.usage.output_tokens_details?.reasoning_tokens || 0,
            cached_tokens: response.usage.input_tokens_details?.cached_tokens || 0,
            cache_creation_tokens: 0,
          }
        : undefined;

      // Find the first message output item for content
      const messageItem = response.output?.find((item: any) => item.type === 'message');
      const content = messageItem?.content
        ?.map((part: any) => part.text)
        .join('\n') || null;

      // Find reasoning output item
      const reasoningItem = response.output?.find((item: any) => item.type === 'reasoning');
      const reasoning_content = reasoningItem?.summary
        ?.map((part: any) => part.text)
        .join('\n') || null;

      return {
        id: response.id,
        model: response.model,
        created: response.created_at || Math.floor(Date.now() / 1000),
        content,
        reasoning_content,
        tool_calls: undefined, // TODO: Extract from function_call output items if needed
        usage,
      };
    } else {
      // Case 1: Chat Completions format
      const choice = response.choices?.[0];
      const message = choice?.message;

      const usage = response.usage
        ? {
            input_tokens: response.usage.prompt_tokens || 0,
            output_tokens: response.usage.completion_tokens || 0,
            total_tokens: response.usage.total_tokens || 0,
            reasoning_tokens:
              response.usage.completion_tokens_details?.reasoning_tokens || 0,
            cached_tokens:
              response.usage.prompt_tokens_details?.cached_tokens || 0,
            cache_creation_tokens: 0,
          }
        : undefined;

      return {
        id: response.id,
        model: response.model,
        created: response.created,
        content: message?.content || null,
        reasoning_content: message?.reasoning_content || null,
        tool_calls: message?.tool_calls,
        usage,
      };
    }
  }

  /**
   * Formats unified response into Responses API format for the client
   */
  async formatResponse(response: UnifiedChatResponse): Promise<any> {
    const outputItems = this.convertChatResponseToOutputItems(response);

    return {
      id: this.generateResponseId(),
      object: 'response',
      created_at: response.created || Math.floor(Date.now() / 1000),
      completed_at: Math.floor(Date.now() / 1000),
      status: 'completed',
      model: response.model,
      output: outputItems,
      usage: response.usage ? {
        input_tokens: response.usage.input_tokens,
        input_tokens_details: {
          cached_tokens: response.usage.cached_tokens || 0
        },
        output_tokens: response.usage.output_tokens,
        output_tokens_details: {
          reasoning_tokens: response.usage.reasoning_tokens || 0
        },
        total_tokens: response.usage.total_tokens
      } : undefined,
      plexus: response.plexus,
    };
  }

  /**
   * Normalizes input to array of items
   */
  private normalizeInput(input: string | any[]): any[] {
    if (typeof input === 'string') {
      // Convert simple string to message item
      return [{
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: input
        }]
      }];
    }
    return input;
  }

  /**
   * Converts Responses API input items to Chat Completions messages
   */
  private convertInputItemsToMessages(items: any[]): UnifiedMessage[] {
    const messages: UnifiedMessage[] = [];

    for (const item of items) {
      switch (item.type) {
        case 'message':
          messages.push({
            role: item.role,
            content: this.convertContentParts(item.content)
          });
          break;

        case 'function_call':
          // Add assistant message with tool call
          messages.push({
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: item.call_id,
              type: 'function',
              function: {
                name: item.name,
                arguments: item.arguments
              }
            }]
          });
          break;

        case 'function_call_output':
          // Add tool message with result
          const outputContent = typeof item.output === 'string' 
            ? item.output 
            : (item.output?.text || JSON.stringify(item.output));
          
          messages.push({
            role: 'tool',
            tool_call_id: item.call_id,
            content: outputContent
          });
          break;

        case 'reasoning':
          // Convert reasoning to assistant message (limited support)
          if (item.summary && item.summary.length > 0) {
            const reasoningText = item.summary
              .map((part: any) => part.text)
              .join('\n');
            messages.push({
              role: 'assistant',
              content: reasoningText
            });
          }
          break;
      }
    }

    return messages;
  }

  /**
   * Converts Responses API content parts to Chat Completions format
   */
  private convertContentParts(parts: any[]): string | any[] {
    if (parts.length === 1 && (parts[0].type === 'input_text' || parts[0].type === 'output_text')) {
      return parts[0].text;
    }

    return parts.map(part => {
      switch (part.type) {
        case 'input_text':
        case 'output_text':
        case 'summary_text':
          return { type: 'text', text: part.text };
        
        case 'input_image':
          return {
            type: 'image_url',
            image_url: {
              url: part.image_url,
              detail: part.detail
            }
          };
        
        default:
          return part;
      }
    });
  }

  /**
   * Filters out built-in tools and converts function tools
   */
  private convertToolsForChatCompletions(tools: any[]): any[] {
    return tools
      .filter(tool => tool.type === 'function')
      .map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          strict: tool.strict
        }
      }));
  }

  /**
   * Converts tool_choice to Chat Completions format
   */
  private convertToolChoiceForChatCompletions(toolChoice: any): any {
    if (typeof toolChoice === 'string') {
      return toolChoice;
    }
    if (toolChoice?.type === 'function') {
      return {
        type: 'function',
        function: { name: toolChoice.name }
      };
    }
    return 'auto';
  }

  /**
   * Converts Chat Completions response to output items array
   */
  private convertChatResponseToOutputItems(response: UnifiedChatResponse): ResponsesOutputItem[] {
    const items: ResponsesOutputItem[] = [];

    // Add reasoning if present
    if (response.reasoning_content) {
      items.push({
        type: 'reasoning',
        id: this.generateItemId('reason'),
        status: 'completed',
        summary: [{
          type: 'summary_text',
          text: response.reasoning_content
        }]
      });
    }

    // Add tool calls if present
    if (response.tool_calls && response.tool_calls.length > 0) {
      for (const toolCall of response.tool_calls) {
        items.push({
          type: 'function_call',
          id: this.generateItemId('fc'),
          status: 'completed',
          call_id: toolCall.id,
          name: toolCall.function.name,
          arguments: toolCall.function.arguments
        });
      }
    }

    // Add main message
    items.push({
      type: 'message',
      id: this.generateItemId('msg'),
      status: 'completed',
      role: 'assistant',
      content: [{
        type: 'output_text',
        text: response.content || '',
        annotations: response.annotations || []
      }]
    });

    return items;
  }

  /**
   * Transforms streaming response from Chat Completions to Responses API SSE
   */
  transformStream(stream: ReadableStream): ReadableStream {
    // Converts Responses API SSE stream to Unified chunks
    // Following the same pattern as OpenAI and Anthropic transformers
    const decoder = new TextDecoder();
    let responseModel = '';
    let responseId = '';

    return new ReadableStream({
      async start(controller) {
        const parser = createParser({
          onEvent: (event) => {
            if (event.data === '[DONE]') {
              return;
            }

            try {
              const data = JSON.parse(event.data);
              
              // Extract metadata from response.created event
              if (data.type === 'response.created' && data.response) {
                responseModel = data.response.model || '';
                responseId = data.response.id || '';
                // Emit initial chunk with role
                controller.enqueue({
                  id: responseId,
                  model: responseModel,
                  created: data.response.created_at || Math.floor(Date.now() / 1000),
                  delta: { role: 'assistant' },
                  finish_reason: null
                });
                return;
              }

              // Convert Responses API events to Unified chunks
              if (data.type === 'response.output_text.delta') {
                // Text content delta
                controller.enqueue({
                  id: responseId,
                  model: responseModel,
                  created: Math.floor(Date.now() / 1000),
                  delta: {
                    content: data.delta
                  },
                  finish_reason: null
                });
              } else if (data.type === 'response.function_call_arguments.delta') {
                // Tool call arguments delta
                controller.enqueue({
                  id: responseId,
                  model: responseModel,
                  created: Math.floor(Date.now() / 1000),
                  delta: {
                    tool_calls: [{
                      index: 0,
                      function: {
                        arguments: data.delta
                      }
                    }]
                  },
                  finish_reason: null
                });
              } else if (data.type === 'response.output_item.added' && data.item?.type === 'function_call') {
                // Tool call start
                controller.enqueue({
                  id: responseId,
                  model: responseModel,
                  created: Math.floor(Date.now() / 1000),
                  delta: {
                    tool_calls: [{
                      index: 0,
                      id: data.item.call_id,
                      type: 'function',
                      function: {
                        name: data.item.name,
                        arguments: ''
                      }
                    }]
                  },
                  finish_reason: null
                });
              } else if (data.type === 'response.completed') {
                // Final chunk with usage data and finish reason
                const usage = data.response?.usage;
                controller.enqueue({
                  id: responseId,
                  model: responseModel,
                  created: Math.floor(Date.now() / 1000),
                  delta: {},
                  finish_reason: 'stop',
                  usage: usage ? {
                    input_tokens: usage.input_tokens || 0,
                    output_tokens: usage.output_tokens || 0,
                    total_tokens: usage.total_tokens || 0,
                    reasoning_tokens: usage.output_tokens_details?.reasoning_tokens || 0,
                    cached_tokens: usage.input_tokens_details?.cached_tokens || 0,
                    cache_creation_tokens: 0
                  } : undefined
                });
              }
            } catch (e) {
              logger.error('Error parsing Responses API streaming chunk', e);
            }
          }
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
      }
    });
  }

  /**
   * Extract usage information from SSE event data
   */
  extractUsage(eventData: string): { 
    input_tokens?: number;
    output_tokens?: number;
    cached_tokens?: number;
    reasoning_tokens?: number;
  } | undefined {
    try {
      const event = JSON.parse(eventData);
      
      // For response.completed events
      if (event.type === 'response.completed' && event.response?.usage) {
        return {
          input_tokens: event.response.usage.input_tokens,
          output_tokens: event.response.usage.output_tokens,
          cached_tokens: event.response.usage.input_tokens_details?.cached_tokens,
          reasoning_tokens: event.response.usage.output_tokens_details?.reasoning_tokens
        };
      }
      
      return undefined;
    } catch (e) {
      return undefined;
    }
  }

  /**
   * Generates unique response ID
   */
  private generateResponseId(): string {
    return `resp_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Generates unique item ID with prefix
   */
  private generateItemId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 15)}`;
  }
}
