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
} from '@ai-sdk/provider';
import { logger } from '../../utils/logger.js';
import { ConvertedRequest } from '../index.js';

// ============================================================================
// Google Generative AI Type Definitions
// ============================================================================

/** Google Generative AI request structure */
export interface GoogleGenerativeAIRequest {
  contents: Array<GoogleGenerativeAIContent>;
  systemInstruction?: GoogleGenerativeAISystemInstruction;
  generationConfig?: {
    maxOutputTokens?: number;
    temperature?: number;
    topK?: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    stopSequences?: string[];
    seed?: number;
    responseMimeType?: string;
    responseSchema?: JSONSchema7;
    thinkingConfig?: {
      thinkingBudget?: number;
      includeThoughts?: boolean;
      thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high';
    };
    mediaResolution?: 'MEDIA_RESOLUTION_LOW' | 'MEDIA_RESOLUTION_MEDIUM' | 'MEDIA_RESOLUTION_HIGH';
  };
  tools?: Array<GoogleGenerativeAITool>;
  toolConfig?: {
    functionCallingConfig?: {
      mode: 'AUTO' | 'NONE' | 'ANY';
      allowedFunctionNames?: string[];
    };
  };
  safetySettings?: Array<{
    category: string;
    threshold: string;
  }>;
}

/** System instruction for Google API */
interface GoogleGenerativeAISystemInstruction {
  parts: Array<{ text: string }>;
}

/** Content message with role and parts */
interface GoogleGenerativeAIContent {
  role: 'user' | 'model';
  parts: Array<GoogleGenerativeAIContentPart>;
}

/** Content part types */
type GoogleGenerativeAIContentPart =
  | { text: string; thought?: boolean; thoughtSignature?: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { mimeType: string; fileUri: string } }
  | {
      functionCall: { name: string; args: unknown };
      thoughtSignature?: string;
    }
  | { functionResponse: { name: string; response: unknown } };

/** Tool/Function definition */
interface GoogleGenerativeAITool {
  functionDeclarations?: Array<{
    name: string;
    description?: string;
    parameters: JSONSchema7;
  }>;
  [key: string]: unknown;
}

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
 * Build a map of function call names to IDs from model (assistant) messages.
 * This helps recover the function name for function response messages.
 */
function buildFunctionNameMap(
  contents: Array<GoogleGenerativeAIContent>
): Map<string, string> {
  const functionNameMap = new Map<string, string>();
  let functionCount = 0;

  for (const content of contents) {
    if (content.role === 'model') {
      for (const part of content.parts) {
        if ('functionCall' in part) {
          functionNameMap.set(part.functionCall.name, part.functionCall.name);
          functionCount++;
          logger.debug(`Mapped function call '${part.functionCall.name}'`);
        }
      }
    }
  }

  logger.debug(`Built function name map with ${functionCount} function call(s) from ${contents.length} content item(s)`);
  return functionNameMap;
}

/**
 * Convert Google Generative AI content part to LanguageModelV2 content part.
 */
function convertContentPart(
  part: GoogleGenerativeAIContentPart,
  isUserMessage: boolean
): LanguageModelV2TextPart | LanguageModelV2FilePart {
  logger.debug(`Converting content part, isUserMessage: ${isUserMessage}`);

  if ('text' in part) {
    const textPart = part as { text: string; thought?: boolean; thoughtSignature?: string };
    logger.debug(`Converting text content with length: ${textPart.text.length} characters`);
    return {
      type: 'text',
      text: textPart.text,
    };
  }

  if ('inlineData' in part) {
    const inlineDataPart = part as { inlineData: { mimeType: string; data: string } };
    const dataUri = `data:${inlineDataPart.inlineData.mimeType};base64,${inlineDataPart.inlineData.data}`;
    const parsed = parseDataUri(dataUri);
    logger.debug(`Converting inline data with mime type: ${inlineDataPart.inlineData.mimeType}`);
    return {
      type: 'file',
      mediaType: parsed?.mediaType || inlineDataPart.inlineData.mimeType,
      data: inlineDataPart.inlineData.data,
    };
  }

  if ('fileData' in part) {
    const fileDataPart = part as { fileData: { mimeType: string; fileUri: string } };
    logger.debug(`Converting file data with mime type: ${fileDataPart.fileData.mimeType}, URI: ${fileDataPart.fileData.fileUri}`);
    return {
      type: 'file',
      mediaType: fileDataPart.fileData.mimeType,
      data: new URL(fileDataPart.fileData.fileUri),
    };
  }

  // For functionCall and functionResponse, return as text
  // (shouldn't normally reach here in user content conversion)
  logger.warn(`Converting unexpected content part type as JSON string`);
  return {
    type: 'text',
    text: JSON.stringify(part),
  };
}

/**
 * Detect if a string is JSON and parse it, or treat as plain text.
 */
function parseFunctionResponse(response: unknown): LanguageModelV2ToolResultOutput {
  const responsePreview = typeof response === 'string' && response.length > 100 
    ? `${response.substring(0, 100)}...` 
    : String(response);
  logger.debug(`Parsing function response, preview: "${responsePreview}"`);

  if (typeof response === 'string') {
    try {
      const parsed = JSON.parse(response);
      logger.debug(`Successfully parsed function response as JSON`);
      return { type: 'json', value: parsed };
    } catch {
      logger.debug(`Failed to parse as JSON, treating as text content`);
      return { type: 'text', value: response };
    }
  } else {
    // Already an object
    logger.debug(`Function response is already an object, treating as JSON`);
    return { type: 'json', value: response as any };
  }
}

// ============================================================================
// Main Conversion Function
// ============================================================================

/**
 * Convert a Google Generative AI request to LanguageModelV2 format.
 *
 * @param request - Google Generative AI request object
 * @param model - The model name to use
 * @returns Converted LanguageModelV2 prompt, options, and warnings
 *
 * @example
 * ```typescript
 * const request: GoogleGenerativeAIRequest = {
 *   contents: [
 *     { role: 'user', parts: [{ text: 'Hello' }] }
 *   ],
 *   generationConfig: { maxOutputTokens: 1024 }
 * };
 *
 * const result = convertFromGoogleGenerativeAIRequest(request, 'gemini-pro');
 * console.log(result.model); // 'gemini-pro'
 * console.log(result.options); // LanguageModelV2CallOptions
 * ```
 */
export function convertFromGoogleGenerativeAIRequest(
  request: GoogleGenerativeAIRequest,
  model: string
): ConvertedRequest {
  logger.info('Starting conversion from Google Generative AI request to LanguageModelV2 format');
  logger.debug(`Request contains ${request.contents.length} content item(s)`);

  const warnings: Array<{ type: string; message: string }> = [];
  const messages: LanguageModelV2Prompt = [];

  // Build function name map for function response recovery
  logger.debug('Building function name map from model messages');
  const functionNameMap = buildFunctionNameMap(request.contents);

  // Process system instruction first
  if (request.systemInstruction) {
    logger.debug(`Processing ${request.systemInstruction.parts.length} system instruction part(s)`);
    for (let i = 0; i < request.systemInstruction.parts.length; i++) {
      const part = request.systemInstruction.parts[i];
      messages.push({
        role: 'system',
        content: part.text,
      });
      logger.debug(`Added system instruction ${i + 1} with ${part.text.length} characters`);
    }
  }

  // Convert conversation contents
  logger.debug(`Converting ${request.contents.length} conversation content item(s)`);
  for (let i = 0; i < request.contents.length; i++) {
    const content = request.contents[i];
    logger.debug(`Processing content ${i + 1} with role: ${content.role}`);

    if (content.role === 'user') {
      const convertedParts = content.parts.map((part) => convertContentPart(part, true));
      messages.push({
        role: 'user',
        content: convertedParts,
      });
      logger.debug(`Added user message with ${content.parts.length} part(s)`);
    } else if (content.role === 'model') {
      const modelContent: Array<
        | LanguageModelV2TextPart
        | LanguageModelV2ReasoningPart
        | LanguageModelV2ToolCallPart
      > = [];

      for (const part of content.parts) {
        if ('text' in part) {
          // Check if this is a thought/reasoning
          if (part.thought) {
            modelContent.push({
              type: 'reasoning',
              text: part.text,
            });
            logger.debug(`Added reasoning content with ${part.text.length} characters`);
          } else {
            modelContent.push({
              type: 'text',
              text: part.text,
            });
            logger.debug(`Added text content with ${part.text.length} characters`);
          }
        } else if ('functionCall' in part) {
          const toolCallPart: LanguageModelV2ToolCallPart = {
            type: 'tool-call',
            toolCallId: `${part.functionCall.name}`,
            toolName: part.functionCall.name,
            input: part.functionCall.args || {},
          };
          modelContent.push(toolCallPart);
          logger.debug(`Added function call for '${part.functionCall.name}'`);
        } else if ('inlineData' in part || 'fileData' in part) {
          // Assistant shouldn't normally return images, but handle gracefully
          const filePart = convertContentPart(part, false);
          // Convert to text representation
          const mediaType = filePart.type === 'file' ? filePart.mediaType : 'unknown';
          modelContent.push({
            type: 'text',
            text: `[Unsupported content type: ${mediaType}]`,
          });
          logger.warn(`Converted unexpected media content from model as text: ${mediaType}`);
        } else if ('functionResponse' in part) {
          // Shouldn't appear in model messages
          const warning = {
            type: 'unsupported',
            message: 'Function responses should not appear in model messages',
          };
          warnings.push(warning);
          logger.warn(warning.message);
        }
      }

      if (modelContent.length > 0) {
        messages.push({
          role: 'assistant',
          content: modelContent,
        });
        logger.debug(`Added assistant message with ${modelContent.length} content part(s)`);
      }
    }
  }

  // Handle function responses that are in user messages (Google doesn't have separate tool role)
  // Need to find tool_result parts in user messages and convert them
  logger.debug('Processing function responses in user messages');
  for (let i = 0; i < request.contents.length; i++) {
    const content = request.contents[i];
    if (content.role === 'user') {
      for (const part of content.parts) {
        if ('functionResponse' in part) {
          // This is a function response, convert to tool message
          const toolResultPart: LanguageModelV2ToolResultPart = {
            type: 'tool-result',
            toolCallId: part.functionResponse.name,
            toolName: part.functionResponse.name,
            output: parseFunctionResponse(part.functionResponse.response),
          };

          messages.push({
            role: 'tool',
            content: [toolResultPart],
          });
          logger.silly(`Added tool message for function response '${part.functionResponse.name}'`);
        }
      }
    }
  }

  // Convert generation config parameters
  logger.debug('Converting generation configuration');
  const options: LanguageModelV2CallOptions = {
    prompt: messages,
  };

  if (request.generationConfig) {
    const config = request.generationConfig;
    logger.debug('Processing generation config parameters');

    if (config.maxOutputTokens) {
      options.maxOutputTokens = config.maxOutputTokens;
      logger.debug(`Set maxOutputTokens: ${config.maxOutputTokens}`);
    }
    if (config.temperature !== undefined) {
      options.temperature = config.temperature;
      logger.debug(`Set temperature: ${config.temperature}`);
    }
    if (config.topK) {
      options.topK = config.topK;
      logger.debug(`Set topK: ${config.topK}`);
    }
    if (config.topP) {
      options.topP = config.topP;
      logger.debug(`Set topP: ${config.topP}`);
    }
    if (config.frequencyPenalty !== undefined) {
      options.frequencyPenalty = config.frequencyPenalty;
      logger.debug(`Set frequencyPenalty: ${config.frequencyPenalty}`);
    }
    if (config.presencePenalty !== undefined) {
      options.presencePenalty = config.presencePenalty;
      logger.debug(`Set presencePenalty: ${config.presencePenalty}`);
    }
    if (config.stopSequences) {
      options.stopSequences = config.stopSequences;
      logger.debug(`Set stopSequences: ${config.stopSequences.join(', ')}`);
    }
    if (config.seed) {
      options.seed = config.seed;
      logger.debug(`Set seed: ${config.seed}`);
    }

    // Convert response format
    if (config.responseMimeType === 'application/json') {
      logger.debug('Converting response format to JSON');
      if (config.responseSchema) {
        options.responseFormat = {
          type: 'json',
          schema: config.responseSchema,
        };
        logger.debug('Set JSON response format with custom schema');
      } else {
        options.responseFormat = { type: 'json' };
        logger.debug('Set JSON response format without schema');
      }
    }

    // Handle thinking config
    if (config.thinkingConfig) {
      const warning = {
        type: 'other',
        message: 'Extended thinking configuration is not directly converted to V2 format',
      };
      warnings.push(warning);
      logger.warn(warning.message);
    }
  }

  // Convert tools
  if (request.tools) {
    options.tools = [];
    logger.debug(`Converting ${request.tools.length} tool definition(s)`);

    for (const tool of request.tools) {
      if (tool.functionDeclarations) {
        for (const func of tool.functionDeclarations) {
          logger.silly(`Converting tool: ${func.name}`);
          
          // Ensure parameters have type: "object" - create a new object with the required fields
          const parameters = func.parameters as Record<string, unknown>;
          const inputSchema: Record<string, unknown> = {
            ...parameters,
          };
          
          // Ensure type field is set to "object"
          if (!inputSchema.type || inputSchema.type === "None" || inputSchema.type === null) {
            logger.debug(`Tool '${func.name}' parameters missing or invalid type field, setting to 'object'`);
            inputSchema.type = "object";
          }
          
          options.tools.push({
            type: 'function',
            name: func.name,
            description: func.description,
            inputSchema: inputSchema,
          });
          logger.silly(`Converted tool: ${func.name}`);
        }
      }
    }
    logger.debug(`Converted tools: ${request.tools.flatMap(t => t.functionDeclarations?.map(f => f.name) || []).join(', ')}`);
  }

  // Convert tool config
  if (request.toolConfig?.functionCallingConfig) {
    const config = request.toolConfig.functionCallingConfig;
    logger.silly('Converting tool configuration');

    if (config.mode === 'AUTO') {
      options.toolChoice = { type: 'auto' };
      logger.silly('Set tool choice to auto');
    } else if (config.mode === 'NONE') {
      options.toolChoice = { type: 'none' };
      logger.debug('Set tool choice to none');
    } else if (config.mode === 'ANY') {
      options.toolChoice = { type: 'auto' }; // 'ANY' is similar to 'auto'
      logger.debug('Set tool choice to any (mapped to auto)');
    }

    // If specific function names are allowed, use the first one (or we could error)
    if (config.allowedFunctionNames && config.allowedFunctionNames.length > 0) {
      options.toolChoice = {
        type: 'tool',
        toolName: config.allowedFunctionNames[0],
      };
      logger.debug(`Set tool choice to specific tool: ${config.allowedFunctionNames[0]}`);
    }
  }

  // Handle safety settings
  if (request.safetySettings) {
    const warning = {
      type: 'other',
      message: 'Safety settings are not converted to V2 format',
    };
    warnings.push(warning);
    logger.warn(warning.message);
  }

  logger.info(`Conversion completed successfully. Generated ${messages.length} messages, ${warnings.length} warning(s)`);
  if (warnings.length > 0) {
    logger.warn(`Warnings generated: ${warnings.map(w => w.message).join('; ')}`);
  }

  return {
    model,
    options: options,
    warnings: warnings.length > 0 ? warnings : undefined,
  } satisfies ConvertedRequest;
}
