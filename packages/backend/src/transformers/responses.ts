import { Transformer } from "../types/transformer";
import { UnifiedResponsesRequest, UnifiedResponsesResponse, ResponsesStreamEvent, ResponsesInputItem, ResponsesMessageItem, ResponsesFunctionCallItem, ResponsesFunctionCallOutputItem, ResponsesOutputItem, ResponsesReasoningTextPart, ResponsesSummaryTextPart } from "../types/responses";
import { UnifiedChatRequest, UnifiedChatResponse, UnifiedMessage } from "../types/unified";
import { createParser } from "eventsource-parser";
import { encode } from "eventsource-encoder";
import { logger } from "../utils/logger";
import { normalizeOpenAIChatUsage, normalizeOpenAIResponsesUsage } from "../utils/usage-normalizer";

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
      include: input.include,
      prompt_cache_key: input.prompt_cache_key,
      text: input.text,
      parallel_tool_calls: input.parallel_tool_calls,
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
    if (request.reasoning) {
      payload.reasoning = request.reasoning;
    }
    if (request.include && request.include.length > 0) {
      payload.include = request.include;
    }
    if (request.prompt_cache_key) {
      payload.prompt_cache_key = request.prompt_cache_key;
    }
    if (request.parallel_tool_calls !== undefined) {
      payload.parallel_tool_calls = request.parallel_tool_calls;
    }
    if (request.text) {
      payload.text = request.text;
    } else if (request.response_format) {
      payload.text = {
        format: {
          type: request.response_format.type,
          schema: request.response_format.json_schema
        }
      };
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
        ? normalizeOpenAIResponsesUsage(response.usage)
        : undefined;

      // Find the first message output item for content
      const messageItem = response.output?.find((item: any) => item.type === 'message');
      const content = messageItem?.content
        ?.map((part: any) => part.text)
        .join('\n') || null;

      // Find reasoning output item
      const reasoningItem = response.output?.find((item: any) => item.type === 'reasoning');
      const reasoningParts = reasoningItem?.content?.length
        ? reasoningItem.content
        : reasoningItem?.summary;
      const reasoning_content = reasoningParts
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
        ? normalizeOpenAIChatUsage(response.usage)
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
    const totalInputTokens = response.usage
      ? (response.usage.input_tokens || 0) + (response.usage.cached_tokens || 0) + (response.usage.cache_creation_tokens || 0)
      : 0;

    return {
      id: this.generateResponseId(),
      object: 'response',
      created_at: response.created || Math.floor(Date.now() / 1000),
      completed_at: Math.floor(Date.now() / 1000),
      status: 'completed',
      model: response.model,
      output: outputItems,
      usage: response.usage ? {
        input_tokens: totalInputTokens,
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
            role: this.mapInputRole(item.role),
            content: this.normalizeMessageContent(item.content)
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
        default:
          if (item.role) {
            messages.push({
              role: this.mapInputRole(item.role),
              content: this.normalizeMessageContent(item.content)
            });
          }
          break;
      }
    }

    return messages;
  }

  private mapInputRole(role?: string): UnifiedMessage['role'] {
    switch (role) {
      case 'system':
      case 'developer':
        return 'system';
      case 'assistant':
        return 'assistant';
      case 'tool':
        return 'tool';
      case 'user':
      default:
        return 'user';
    }
  }

  private normalizeMessageContent(content: any): string | null | any[] {
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return this.convertContentParts(content);
    }

    return null;
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
    if (response.reasoning_content || response.thinking?.content) {
      const reasoningText = response.reasoning_content || '';
      const reasoningSummary = response.thinking?.content || '';
      const contentParts: ResponsesReasoningTextPart[] = reasoningText
        ? [{ type: 'reasoning_text', text: reasoningText }]
        : [];
      const summaryParts: ResponsesSummaryTextPart[] = reasoningSummary
        ? [{ type: 'summary_text', text: reasoningSummary }]
        : [];
      items.push({
        type: 'reasoning',
        id: this.generateItemId('reason'),
        status: 'completed',
        content: contentParts,
        summary: summaryParts
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
                const normalizedUsage = usage ? normalizeOpenAIResponsesUsage(usage) : undefined;
                controller.enqueue({
                  id: responseId,
                  model: responseModel,
                  created: Math.floor(Date.now() / 1000),
                  delta: {},
                  finish_reason: 'stop',
                  usage: normalizedUsage
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

  formatStream(stream: ReadableStream): ReadableStream {
    const encoder = new TextEncoder();
    const reader = stream.getReader();

    let hasSentCreated = false;
    let hasSentInProgress = false;
    let responseId = '';
    let responseModel = '';
    let responseCreatedAt = 0;
    let messageItemSent = false;
    let messageItemId = '';
    let messageText = '';
    let messagePartAdded = false;
    let messageOutputIndex: number | null = null;
    let reasoningItemSent = false;
    let reasoningItemId = '';
    let reasoningText = '';
    let reasoningOutputIndex: number | null = null;
    let reasoningSummaryText = '';
    let reasoningContentIndex = 0;
    let reasoningSummaryIndex = 0;
    let reasoningSummaryPartAdded = false;
    let lastUsage: any = null;
    let sequenceNumber = 0;
    let nextOutputIndex = 0;
    const usedOutputIndices = new Set<number>();
    const outputItemsByIndex = new Map<number, any>();
    const toolOutputIndexMap = new Map<number, number>();
    const toolCallIdMap = new Map<number, string>();
    const toolItemIdMap = new Map<number, string>();
    const toolArgsMap = new Map<number, string>();
    const toolNameMap = new Map<number, string>();

    const normalizeToolArgs = (previous: string, delta: string): string => {
      if (!delta) return previous;
      const trimmed = delta.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          JSON.parse(trimmed);
          return trimmed;
        } catch {
          return previous + delta;
        }
      }
      return previous + delta;
    };

    const sendEvent = (controller: ReadableStreamDefaultController, data: any) => {
      controller.enqueue(
        encoder.encode(
          encode({
            event: data.type,
            data: JSON.stringify({
              ...data,
              sequence_number: sequenceNumber++
            })
          })
        )
      );
    };

    const ensureCreated = (controller: ReadableStreamDefaultController, chunk: any) => {
      if (hasSentCreated) return;
      responseId = chunk.id || this.generateResponseId();
      responseModel = chunk.model || responseModel;
      responseCreatedAt = chunk.created || Math.floor(Date.now() / 1000);
      sendEvent(controller, {
        type: 'response.created',
        response: {
          id: responseId,
          object: 'response',
          created_at: responseCreatedAt,
          status: 'in_progress',
          model: responseModel,
          output: []
        }
      });
      hasSentCreated = true;
    };

    const reserveOutputIndex = (): number => {
      while (usedOutputIndices.has(nextOutputIndex)) {
        nextOutputIndex += 1;
      }
      const index = nextOutputIndex;
      usedOutputIndices.add(index);
      nextOutputIndex += 1;
      return index;
    };

    const ensureInProgress = (controller: ReadableStreamDefaultController) => {
      if (hasSentInProgress) return;
      sendEvent(controller, {
        type: 'response.in_progress',
        response: {
          id: responseId,
          object: 'response',
          created_at: responseCreatedAt,
          status: 'in_progress',
          model: responseModel,
          output: []
        }
      });
      hasSentInProgress = true;
    };

    const ensureMessageItem = (controller: ReadableStreamDefaultController) => {
      if (messageItemSent) return;
      if (messageOutputIndex === null) {
        messageOutputIndex = reserveOutputIndex();
      }
      const currentMessageOutputIndex = messageOutputIndex as number;
      messageItemId = this.generateItemId('msg');
      sendEvent(controller, {
        type: 'response.output_item.added',
        output_index: currentMessageOutputIndex,
        item: {
          id: messageItemId,
          type: 'message',
          status: 'in_progress',
          role: 'assistant',
          content: []
        }
      });
      if (!messagePartAdded) {
        sendEvent(controller, {
          type: 'response.content_part.added',
          output_index: currentMessageOutputIndex,
          item_id: messageItemId,
          content_index: 0,
          part: {
            type: 'output_text',
            annotations: [],
            logprobs: [],
            text: ''
          }
        });
        messagePartAdded = true;
      }
      messageItemSent = true;
    };

    const ensureReasoningItem = (controller: ReadableStreamDefaultController) => {
      if (reasoningItemSent) return;
      reasoningOutputIndex = reserveOutputIndex();
      reasoningItemId = this.generateItemId('rs');
      sendEvent(controller, {
        type: 'response.output_item.added',
        output_index: reasoningOutputIndex,
        item: {
          id: reasoningItemId,
          type: 'reasoning',
          status: 'in_progress',
          content: [],
          summary: []
        }
      });
      reasoningItemSent = true;
    };

    const ensureToolItem = (
      controller: ReadableStreamDefaultController,
      toolIndex: number,
      toolCall: any
    ) => {
      if (toolOutputIndexMap.has(toolIndex)) return;
      const outputIndex = reserveOutputIndex();
      const callId = toolCall?.id || this.generateItemId('call');
      const itemId = this.generateItemId('fc');
      toolOutputIndexMap.set(toolIndex, outputIndex);
      toolCallIdMap.set(toolIndex, callId);
      toolItemIdMap.set(toolIndex, itemId);
      toolArgsMap.set(toolIndex, '');
      toolNameMap.set(toolIndex, toolCall?.function?.name || toolCall?.name || '');
      sendEvent(controller, {
        type: 'response.output_item.added',
        output_index: outputIndex,
        item: {
          id: itemId,
          type: 'function_call',
          status: 'in_progress',
          call_id: callId,
          name: toolCall?.function?.name || toolCall?.name || '',
          arguments: ''
        }
      });
    };

    const finalizeOutputItems = (controller: ReadableStreamDefaultController): any[] => {
      if (reasoningItemSent && reasoningOutputIndex !== null) {
        const reasoningItem = {
          id: reasoningItemId,
          type: 'reasoning',
          status: 'completed',
          content: reasoningText
            ? [
                {
                  type: 'reasoning_text',
                  text: reasoningText
                }
              ]
            : [],
          summary: reasoningSummaryText
            ? [
                {
                  type: 'summary_text',
                  text: reasoningSummaryText
                }
              ]
            : []
        };
        if (reasoningText) {
          sendEvent(controller, {
            type: 'response.reasoning_text.done',
            output_index: reasoningOutputIndex,
            item_id: reasoningItemId,
            content_index: reasoningContentIndex,
            text: reasoningText
          });
        }
        if (reasoningSummaryText) {
          sendEvent(controller, {
            type: 'response.reasoning_summary_text.done',
            output_index: reasoningOutputIndex,
            item_id: reasoningItemId,
            summary_index: reasoningSummaryIndex,
            text: reasoningSummaryText
          });
          if (reasoningSummaryPartAdded) {
            sendEvent(controller, {
              type: 'response.reasoning_summary_part.done',
              output_index: reasoningOutputIndex,
              item_id: reasoningItemId,
              summary_index: reasoningSummaryIndex,
              part: {
                type: 'summary_text',
                text: reasoningSummaryText
              }
            });
          }
        }
        sendEvent(controller, {
          type: 'response.output_item.done',
          output_index: reasoningOutputIndex,
          item: reasoningItem
        });
        outputItemsByIndex.set(reasoningOutputIndex, reasoningItem);
      }

      if (messageItemSent) {
        const messageItem = {
          id: messageItemId,
          type: 'message',
          status: 'completed',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              annotations: [],
              logprobs: [],
              text: messageText
            }
          ]
        };
        sendEvent(controller, {
          type: 'response.output_text.done',
          output_index: messageOutputIndex as number,
          item_id: messageItemId,
          content_index: 0,
          logprobs: [],
          text: messageText
        });
        sendEvent(controller, {
          type: 'response.content_part.done',
          output_index: messageOutputIndex as number,
          item_id: messageItemId,
          content_index: 0,
          part: {
            type: 'output_text',
            annotations: [],
            logprobs: [],
            text: messageText
          }
        });
        sendEvent(controller, {
          type: 'response.output_item.done',
          output_index: messageOutputIndex as number,
          item: messageItem
        });
        outputItemsByIndex.set(messageOutputIndex as number, messageItem);
      }

      for (const [toolIndex, outputIndex] of toolOutputIndexMap.entries()) {
        const itemId = toolItemIdMap.get(toolIndex);
        const callId = toolCallIdMap.get(toolIndex);
        const args = toolArgsMap.get(toolIndex) || '';
        const name = toolNameMap.get(toolIndex) || '';
        const toolItem = {
          id: itemId,
          type: 'function_call',
          status: 'completed',
          call_id: callId,
          name,
          arguments: args
        };
        sendEvent(controller, {
          type: 'response.output_item.done',
          output_index: outputIndex,
          item: toolItem
        });
        outputItemsByIndex.set(outputIndex, toolItem);
      }

      return Array.from(outputItemsByIndex.entries())
        .sort(([a], [b]) => a - b)
        .map(([, item]) => item);
    };

    return new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value: unifiedChunk } = await reader.read();
            if (done) {
              if (!hasSentCreated) {
                ensureCreated(controller, { model: responseModel, created: responseCreatedAt });
              }
              const outputItems = finalizeOutputItems(controller);
              sendEvent(controller, {
                type: 'response.completed',
                response: {
                  id: responseId || undefined,
                  object: 'response',
                  created_at: responseCreatedAt || Math.floor(Date.now() / 1000),
                  status: 'completed',
                  model: responseModel,
                  output: outputItems,
              usage: lastUsage ? {
                input_tokens: (lastUsage.input_tokens || 0) + (lastUsage.cached_tokens || 0) + (lastUsage.cache_creation_tokens || 0),
                output_tokens: lastUsage.output_tokens,
                total_tokens: lastUsage.total_tokens,
                input_tokens_details: {
                      cached_tokens: lastUsage.cached_tokens || 0
                    },
                    output_tokens_details: {
                      reasoning_tokens: lastUsage.reasoning_tokens || 0
                    }
                  } : undefined
                }
              });
              break;
            }

            ensureCreated(controller, unifiedChunk);
            ensureInProgress(controller);

            if (unifiedChunk.usage) {
              lastUsage = unifiedChunk.usage;
            }

            const delta = unifiedChunk.delta || {};
            const reasoningDelta =
              typeof delta.reasoning_content === 'string'
                ? delta.reasoning_content
                : null;
            const reasoningSummaryDelta =
              typeof delta.thinking?.content === 'string'
                ? delta.thinking.content
                : null;

            if (reasoningDelta && reasoningDelta.length > 0) {
              ensureReasoningItem(controller);
              reasoningText += reasoningDelta;
              sendEvent(controller, {
                type: 'response.reasoning_text.delta',
                output_index: reasoningOutputIndex as number,
                item_id: reasoningItemId,
                content_index: reasoningContentIndex,
                delta: reasoningDelta
              });
            }

            if (reasoningSummaryDelta && reasoningSummaryDelta.length > 0) {
              ensureReasoningItem(controller);
              if (!reasoningSummaryPartAdded) {
                sendEvent(controller, {
                  type: 'response.reasoning_summary_part.added',
                  output_index: reasoningOutputIndex as number,
                  item_id: reasoningItemId,
                  summary_index: reasoningSummaryIndex,
                  part: {
                    type: 'summary_text',
                    text: ''
                  }
                });
                reasoningSummaryPartAdded = true;
              }
              reasoningSummaryText += reasoningSummaryDelta;
              sendEvent(controller, {
                type: 'response.reasoning_summary_text.delta',
                output_index: reasoningOutputIndex as number,
                item_id: reasoningItemId,
                summary_index: reasoningSummaryIndex,
                delta: reasoningSummaryDelta
              });
            }

            if (typeof delta.content === 'string' && delta.content.length > 0) {
              ensureMessageItem(controller);
              messageText += delta.content;
              sendEvent(controller, {
                type: 'response.output_text.delta',
                output_index: messageOutputIndex as number,
                item_id: messageItemId,
                content_index: 0,
                delta: delta.content,
                logprobs: []
              });
            }

            if (Array.isArray(delta.tool_calls)) {
              for (const toolCall of delta.tool_calls) {
                const toolIndex = toolCall.index ?? 0;
                ensureToolItem(controller, toolIndex, toolCall);
                if (typeof toolCall.function?.arguments === 'string') {
                  const outputIndex = toolOutputIndexMap.get(toolIndex) ?? toolIndex + 1;
                  const itemId = toolItemIdMap.get(toolIndex);
                  const prevArgs = toolArgsMap.get(toolIndex) || '';
                  toolArgsMap.set(
                    toolIndex,
                    normalizeToolArgs(prevArgs, toolCall.function.arguments)
                  );
                  sendEvent(controller, {
                    type: 'response.function_call_arguments.delta',
                    output_index: outputIndex,
                    item_id: itemId,
                    delta: toolCall.function.arguments
                  });
                }
              }
            }

            if (unifiedChunk.finish_reason && !unifiedChunk.delta) {
              const outputItems = finalizeOutputItems(controller);

              sendEvent(controller, {
                type: 'response.completed',
                response: {
                  id: responseId || undefined,
                  object: 'response',
                  created_at: responseCreatedAt || Math.floor(Date.now() / 1000),
                  status: 'completed',
                  model: responseModel,
                  output: outputItems,
                  usage: lastUsage ? {
                    input_tokens: (lastUsage.input_tokens || 0) + (lastUsage.cached_tokens || 0) + (lastUsage.cache_creation_tokens || 0),
                    output_tokens: lastUsage.output_tokens,
                    total_tokens: lastUsage.total_tokens,
                    input_tokens_details: {
                      cached_tokens: lastUsage.cached_tokens || 0
                    },
                    output_tokens_details: {
                      reasoning_tokens: lastUsage.reasoning_tokens || 0
                    }
                  } : undefined
                }
              });
              break;
            }
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
    cache_creation_tokens?: number;
    reasoning_tokens?: number;
  } | undefined {
    try {
      const event = JSON.parse(eventData);
      
      // For response.completed events
      if (event.type === 'response.completed' && event.response?.usage) {
        const usage = normalizeOpenAIResponsesUsage(event.response.usage);
        return {
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          cached_tokens: usage.cached_tokens,
          cache_creation_tokens: usage.cache_creation_tokens,
          reasoning_tokens: usage.reasoning_tokens
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
