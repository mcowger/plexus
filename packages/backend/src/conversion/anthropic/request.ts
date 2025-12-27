import { JSONSchema7 } from 'json-schema';
import {
  LanguageModelV2CallOptions,
  LanguageModelV2FilePart,
  LanguageModelV2Message,
  LanguageModelV2Prompt,
  LanguageModelV2ReasoningPart,
  LanguageModelV2TextPart,
  LanguageModelV2ToolCallPart,
  LanguageModelV2ToolResultPart,
  LanguageModelV2ToolResultOutput,
  LanguageModelV2ToolChoice,
  LanguageModelV2FunctionTool,
} from '@ai-sdk/provider';
import { logger } from '../../utils/logger.js';
import { ConvertedRequest } from '../index.js';

// ============================================================================
// Anthropic Messages API Type Definitions
// ============================================================================

/** Anthropic Messages API request structure */
export interface AnthropicMessagesRequest {
  messages: Array<AnthropicMessage>;
  system?:
    | AnthropicTextContent
    | Array<AnthropicTextContent | AnthropicImageContent | AnthropicDocumentContent>;
  model: string;
  max_tokens?: number;
  temperature?: number;
  top_k?: number;
  top_p?: number;
  stop_sequences?: string[];
  tools?: Array<AnthropicTool>;
  tool_choice?: AnthropicToolChoice;
  thinking?: { type: 'enabled'; budget_tokens?: number };
  output_format?: { type: 'json_schema'; schema: JSONSchema7 };
}

/** Union type for Anthropic messages */
type AnthropicMessage = AnthropicUserMessage | AnthropicAssistantMessage;

interface AnthropicUserMessage {
  role: 'user';
  content: Array<
    | AnthropicTextContent
    | AnthropicImageContent
    | AnthropicDocumentContent
    | AnthropicToolResultContent
  >;
}

interface AnthropicAssistantMessage {
  role: 'assistant';
  content: Array<
    | AnthropicTextContent
    | AnthropicThinkingContent
    | AnthropicToolCallContent
  >;
}

// Content types
interface AnthropicTextContent {
  type: 'text';
  text: string;
}

interface AnthropicImageContent {
  type: 'image';
  source:
    | { type: 'base64'; media_type: string; data: string }
    | { type: 'url'; url: string }
    | { type: 'text'; media_type: 'text/plain'; data: string };
}

interface AnthropicDocumentContent {
  type: 'document';
  source:
    | { type: 'base64'; media_type: string; data: string }
    | { type: 'url'; url: string }
    | { type: 'text'; media_type: 'text/plain'; data: string };
  title?: string;
}

interface AnthropicThinkingContent {
  type: 'thinking';
  thinking: string;
}

interface AnthropicToolCallContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

interface AnthropicToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image'; source: { type: string; [key: string]: unknown } }
        | { type: 'document'; source: { type: string; [key: string]: unknown } }
      >;
  is_error?: boolean;
}

// Tools
interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: JSONSchema7;
  strict?: boolean;
}

type AnthropicToolChoice =
  | 'auto'
  | 'any'
  | 'none'
  | { type: 'tool'; name: string };

// ============================================================================
// Result Type
// ============================================================================

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse a data URI to extract media type and base64 data.
 * Format: data:[<mediatype>][;base64],<data>
 */
function parseDataUri(
  uri: string
): { mediaType: string; data: string } | null {
  const match = uri.match(/^data:([^;,]+)?(?:;base64)?,(.+)$/);
  if (!match) {
    logger.debug(`Failed to parse data URI: ${uri}`);
    return null;
  }

  logger.debug(`Successfully parsed data URI with media type: ${match[1] || 'text/plain'}`);
  return {
    mediaType: match[1] || 'text/plain',
    data: match[2],
  };
}



/**
 * Convert Anthropic content to LanguageModelV2 content parts.
 */
function convertUserContentPart(
  part:
    | AnthropicTextContent
    | AnthropicImageContent
    | AnthropicDocumentContent
    | AnthropicToolResultContent
): LanguageModelV2TextPart | LanguageModelV2FilePart {
  logger.debug(`Converting content part of type: ${part.type}`);

  switch (part.type) {
    case 'text': {
      const textContent = part as AnthropicTextContent;
      logger.debug(`Converting text content with length: ${textContent.text.length} characters`);
      return {
        type: 'text',
        text: textContent.text,
      };
    }

    case 'image': {
      const source = part.source;
      let mediaType = 'image/*';
      let data: string | URL;

      if (source.type === 'base64') {
        mediaType = source.media_type || 'image/*';
        data = source.data;
        logger.debug(`Converting base64 image with media type: ${mediaType}`);
      } else if (source.type === 'url') {
        data = new URL(source.url);
        logger.debug(`Converting image from URL: ${source.url}`);
      } else {
        // source.type === 'text'
        const parsed = parseDataUri(source.data);
        mediaType = parsed?.mediaType || 'image/*';
        data = parsed?.data || source.data;
        logger.debug(`Converting image from data URI with media type: ${mediaType}`);
      }

      return {
        type: 'file',
        mediaType,
        data,
      };
    }

    case 'document': {
      const source = part.source;
      let mediaType = part.source.type === 'base64' ? part.source.media_type : 'application/pdf';
      let data: string | URL;

      if (source.type === 'base64') {
        mediaType = source.media_type || 'application/pdf';
        data = source.data;
        logger.debug(`Converting base64 document with media type: ${mediaType}, title: ${part.title || 'none'}`);
      } else if (source.type === 'url') {
        data = new URL(source.url);
        logger.debug(`Converting document from URL: ${source.url}, title: ${part.title || 'none'}`);
      } else {
        // source.type === 'text'
        const parsed = parseDataUri(source.data);
        mediaType = parsed?.mediaType || 'application/pdf';
        data = parsed?.data || source.data;
        logger.debug(`Converting document from data URI with media type: ${mediaType}, title: ${part.title || 'none'}`);
      }

      return {
        type: 'file',
        mediaType,
        data,
        filename: part.title,
      };
    }

    case 'tool_result': {
      // This shouldn't normally be reached in user content, but handle it anyway
      // Return text representation
      logger.warn(`Processing unexpected tool_result content in user message, tool_use_id: ${part.tool_use_id}`);
      
      if (typeof part.content === 'string') {
        logger.silly(`Converting tool result as text content, length: ${part.content.length} characters`);
        return {
          type: 'text',
          text: part.content,
        };
      } else {
        // Content array - convert first text part
        const textPart = part.content.find((p) => p.type === 'text');
        if (textPart && 'text' in textPart) {
          logger.silly(`Converting tool result array, found text part with length: ${textPart.text.length} characters`);
          return {
            type: 'text',
            text: textPart.text,
          };
        }
        const jsonString = JSON.stringify(part.content);
        logger.debug(`Converting tool result array to JSON string, length: ${jsonString.length} characters`);
        return {
          type: 'text',
          text: jsonString,
        };
      }
    }
  }
}


// ============================================================================
// Main Conversion Function
// ============================================================================

/**
 * Convert an Anthropic Messages API request to LanguageModelV2 format.
 *
 * @param request - Anthropic Messages API request object
 * @returns Converted LanguageModelV2 prompt, options, and warnings
 *
 * @example
 * ```typescript
 * const request: AnthropicMessagesRequest = {
 *   messages: [
 *     { role: 'user', content: [{ type: 'text', text: 'Hello' }] }
 *   ],
 *   max_tokens: 1024,
 * };
 *
 * const result = convertFromAnthropicMessagesRequest(request);
 * console.log(result.prompt); // LanguageModelV2Prompt
 * console.log(result.options); // Partial<LanguageModelV2CallOptions>
 * ```
 */
export function convertFromAnthropicMessagesRequest(
  request: AnthropicMessagesRequest
): ConvertedRequest {
  logger.info('Starting conversion from Anthropic Messages API request to LanguageModelV2 format');
  logger.debug(`Request contains ${request.messages.length} messages, model: ${request.model || 'default'}`);
  
  const warnings: Array<{ type: string; message: string }> = [];
  const messages: LanguageModelV2Prompt = [];

  // Process system messages first
  if (request.system) {
    const systemContent = Array.isArray(request.system)
      ? request.system
      : [request.system];
    
    logger.debug(`Processing ${systemContent.length} system message(s)`);

    for (const sysItem of systemContent) {
      if (sysItem.type === 'text') {
        const textContent = sysItem as AnthropicTextContent;
        messages.push({
          role: 'system',
          content: textContent.text,
        });
        logger.debug(`Added system message with ${textContent.text.length} characters`);
      } else {
        const warning = {
          type: 'unsupported',
          message: 'Non-text system content is not supported in V2 format',
        };
        warnings.push(warning);
        logger.warn(warning.message);
      }
    }
  }

  // Convert conversation messages
  logger.debug(`Converting ${request.messages.length} conversation messages`);
  for (let i = 0; i < request.messages.length; i++) {
    const message = request.messages[i];
    logger.debug(`Processing message ${i + 1} with role: ${message.role}`);
    
    if (message.role === 'user') {
      const convertedContent = message.content.map((part) => convertUserContentPart(part));
      messages.push({
        role: 'user',
        content: convertedContent,
      });
      logger.debug(`Converted user message with ${message.content.length} content part(s)`);
    } else if (message.role === 'assistant') {
      const content: Array<
        | LanguageModelV2TextPart
        | LanguageModelV2ReasoningPart
        | LanguageModelV2ToolCallPart
      > = [];

      for (const part of message.content) {
        if ('type' in part) {
          if (part.type === 'text') {
            const textPart = part as AnthropicTextContent;
            content.push({
              type: 'text',
              text: textPart.text,
            });
            logger.debug(`Added text part with ${textPart.text.length} characters`);
          } else if (part.type === 'thinking') {
            const thinkingPart = part as AnthropicThinkingContent;
            content.push({
              type: 'reasoning',
              text: thinkingPart.thinking,
            });
            logger.debug(`Added reasoning part with ${thinkingPart.thinking.length} characters`);
          } else if (part.type === 'tool_use') {
            const toolUsePart = part as AnthropicToolCallContent;
            const toolCallPart: LanguageModelV2ToolCallPart = {
              type: 'tool-call',
              toolCallId: toolUsePart.id,
              toolName: toolUsePart.name,
              input: toolUsePart.input,
            };
            content.push(toolCallPart);
            logger.silly(`Added tool call part for tool '${toolUsePart.name}' with ID '${toolUsePart.id}'`);
          }
        }
      }

      if (content.length > 0) {
        messages.push({
          role: 'assistant',
          content,
        });
        logger.debug(`Added assistant message with ${content.length} content part(s)`);
      }
    }
  }

  // Convert parameters
  logger.debug('Converting request parameters');
  const options: LanguageModelV2CallOptions = {
    prompt: messages,
    maxOutputTokens: request.max_tokens,
    temperature: request.temperature,
    topP: request.top_p,
    topK: request.top_k,
    stopSequences: request.stop_sequences,
  };

  if (request.max_tokens) {
    logger.debug(`Set maxOutputTokens: ${request.max_tokens}`);
  }
  if (request.temperature !== undefined) {
    logger.debug(`Set temperature: ${request.temperature}`);
  }

  // Convert response format
  if (request.output_format) {
    logger.debug('Converting output format configuration');
    if (request.output_format.type === 'json_schema') {
      options.responseFormat = {
        type: 'json',
        schema: request.output_format.schema,
      };
      logger.debug('Set JSON response format with custom schema');
    }
  }


    // Convert tools
  if (request.tools) {
    options.tools = new Array<LanguageModelV2FunctionTool>();
    logger.debug(`Converting ${request.tools.length} tool definition(s)`);
    for (const tool of request.tools) {
      logger.silly(`Converting tool: ${tool.name}`);
      
      // Ensure parameters have type: "object" - create a new object with the required fields
      const parameters = tool.input_schema as Record<string, unknown>;
      const inputSchema: Record<string, unknown> = {
        ...parameters,
      };
      
      // Ensure type field is set to "object"
      if (!inputSchema.type || inputSchema.type === "None" || inputSchema.type === null) {
        logger.debug(`Tool '${tool.name}' parameters missing or invalid type field, setting to 'object'`);
        inputSchema.type = "object";
      }
      
      const convertedTool: LanguageModelV2FunctionTool = {
        type: "function",
        name: tool.name,
        description: tool.description,
        inputSchema: inputSchema,
      };
      options.tools.push(convertedTool);
      logger.silly(`Converted tool: ${convertedTool.name}`);
    }
    logger.debug(`Converted tools: ${request.tools.map(t => t.name).join(', ')}`);
  }
  // // Convert tools
  // if (request.tools) {
  //   logger.debug(`Converting ${request.tools.length} tool definition(s)`);
  //   options.tools = request.tools.map((tool) => ({
  //     type: 'function',
  //     name: tool.name,
  //     description: tool.description,
  //     inputSchema: tool.input_schema,
  //     strict: tool.strict,
  //   }));
  //   logger.debug(`Converted tools: ${request.tools.map(t => t.name).join(', ')}`);
  // }

  // Convert tool choice
  if (request.tool_choice) {
    logger.silly('Converting tool choice configuration');
    if (typeof request.tool_choice === 'string') {
      switch (request.tool_choice) {
        case 'auto':
          options.toolChoice = { type: 'auto' };
          logger.debug('Set tool choice to auto');
          break;
        case 'any':
          // 'any' in Anthropic is similar to 'auto' in V2
          options.toolChoice = { type: 'auto' };
          logger.debug('Set tool choice to any (mapped to auto)');
          break;
        case 'none':
          options.toolChoice = { type: 'none' };
          logger.debug('Set tool choice to none');
          break;
      }
    } else if (request.tool_choice.type === 'tool') {
      options.toolChoice = {
        type: 'tool',
        toolName: request.tool_choice.name,
      } as LanguageModelV2ToolChoice;
      logger.debug(`Set tool choice to specific tool: ${request.tool_choice.name}`);
    }
  }

  // Handle extended thinking
  if (request.thinking) {
    const warning = {
      type: 'other',
      message:
        'Extended thinking configuration is not directly converted to V2 format',
    };
    warnings.push(warning);
    logger.warn(warning.message);
  }

  logger.info(`Conversion completed successfully. Generated ${messages.length} messages, ${warnings.length} warning(s)`);
  if (warnings.length > 0) {
    logger.warn(`Warnings generated: ${warnings.map(w => w.message).join('; ')}`);
  }

  return {
    model: request.model,
    options,
    warnings,
  };
}
