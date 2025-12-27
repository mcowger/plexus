import { JSONSchema7 } from "json-schema";
import {
  LanguageModelV2CallOptions,
  LanguageModelV2FilePart,
  LanguageModelV2FunctionTool,
  LanguageModelV2ToolChoice,
  LanguageModelV2Prompt,
  LanguageModelV2TextPart,
  LanguageModelV2ToolCallPart,
  LanguageModelV2ToolResultPart,
  LanguageModelV2ToolResultOutput,
} from "@ai-sdk/provider";
import { logger } from "../../utils/logger.js";
import { ConvertedRequest } from "../index.js";

// ============================================================================
// OpenAI Type Definitions
// ============================================================================

/** OpenAI Chat Completions API request structure */
export interface OpenAIChatRequest {
  model: string;
  messages: Array<OpenAIChatMessage>;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  seed?: number;
  stream?: boolean;
  response_format?:
    | { type: "text" }
    | { type: "json_object" }
    | {
        type: "json_schema";
        json_schema: {
          name?: string;
          description?: string;
          schema: JSONSchema7;
          strict?: boolean;
        };
      };
  tools?: Array<OpenAIChatFunctionTool>;
  tool_choice?:
    | "auto"
    | "none"
    | "required"
    | { type: "function"; function: { name: string } };
}

/** Union type for all OpenAI chat message types */
type OpenAIChatMessage =
  | ChatCompletionSystemMessage
  | ChatCompletionDeveloperMessage
  | ChatCompletionUserMessage
  | ChatCompletionAssistantMessage
  | ChatCompletionToolMessage;

interface ChatCompletionSystemMessage {
  role: "system";
  content: string;
}

interface ChatCompletionDeveloperMessage {
  role: "developer";
  content: string;
}

interface ChatCompletionUserMessage {
  role: "user";
  content: string | Array<ChatCompletionContentPart>;
}

type ChatCompletionContentPart =
  | ChatCompletionContentPartText
  | ChatCompletionContentPartImage
  | ChatCompletionContentPartInputAudio
  | ChatCompletionContentPartFile;

interface ChatCompletionContentPartText {
  type: "text";
  text: string;
}

interface ChatCompletionContentPartImage {
  type: "image_url";
  image_url: { url: string };
}

interface ChatCompletionContentPartInputAudio {
  type: "input_audio";
  input_audio: { data: string; format: "wav" | "mp3" };
}

interface ChatCompletionContentPartFile {
  type: "file";
  file: { filename: string; file_data: string } | { file_id: string };
}

interface ChatCompletionAssistantMessage {
  role: "assistant";
  content?: string | null;
  tool_calls?: Array<ChatCompletionMessageToolCall>;
}

interface ChatCompletionMessageToolCall {
  type: "function";
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

interface ChatCompletionToolMessage {
  role: "tool";
  content: string;
  tool_call_id: string;
}

interface OpenAIChatFunctionTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: JSONSchema7;
    strict?: boolean;
  };
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
function parseDataUri(uri: string): { mediaType: string; data: string } | null {
  const match = uri.match(/^data:([^;,]+)?(?:;base64)?,(.+)$/);
  if (!match) {
    logger.debug(`Failed to parse data URI: ${uri}`);
    return null;
  }

  logger.debug(`Successfully parsed data URI with media type: ${match[1] || "text/plain"}`);
  return {
    mediaType: match[1] || "text/plain",
    data: match[2],
  };
}

/**
 * Build a map of tool call IDs to tool names from previous assistant messages.
 * This helps recover the tool name for tool result messages.
 */
function buildToolNameMap(
  messages: Array<OpenAIChatMessage>
): Map<string, string> {
  const toolNameMap = new Map<string, string>();
  let toolCount = 0;

  for (const msg of messages) {
    if (msg.role === "assistant" && msg.tool_calls) {
      for (const toolCall of msg.tool_calls) {
        toolNameMap.set(toolCall.id, toolCall.function.name);
        toolCount++;
        logger.debug(`Mapped tool call ID '${toolCall.id}' to tool name '${toolCall.function.name}'`);
      }
    }
  }

  logger.debug(`Built tool name map with ${toolCount} tool calls from ${messages.length} messages`);
  return toolNameMap;
}

/**
 * Convert an OpenAI content part to a LanguageModelV2 content part.
 */
function convertUserContentPart(
  part: ChatCompletionContentPart
): LanguageModelV2TextPart | LanguageModelV2FilePart {
  logger.debug(`Converting content part of type: ${part.type}`);

  switch (part.type) {
    case "text": {
      const textPart = part as ChatCompletionContentPartText;
      logger.debug(`Converting text content with length: ${textPart.text.length} characters`);
      return {
        type: "text",
        text: textPart.text,
      };
    }

    case "image_url": {
      const url = part.image_url.url;
      logger.debug(`Converting image content from URL: ${url}`);

      // Try to parse data URI
      if (url.startsWith("data:")) {
        const parsed = parseDataUri(url);
        if (parsed) {
          logger.debug(`Successfully parsed data URI for image with media type: ${parsed.mediaType}`);
          return {
            type: "file",
            mediaType: parsed.mediaType,
            data: parsed.data,
          };
        }
      }

      // Use as URL
      logger.debug(`Using URL directly for image`);
      return {
        type: "file",
        mediaType: "image/*",
        data: new URL(url),
      };
    }

    case "input_audio": {
      const audioPart = part as ChatCompletionContentPartInputAudio;
      const mediaType = audioPart.input_audio.format === "wav" ? "audio/wav" : "audio/mp3";
      logger.debug(`Converting audio content with format: ${audioPart.input_audio.format}, media type: ${mediaType}`);
      return {
        type: "file",
        mediaType,
        data: audioPart.input_audio.data,
      };
    }

    case "file": {
      if ("file_id" in part.file) {
        const fileId = part.file.file_id;
        logger.debug(`Converting file with ID: ${fileId}`);
        return {
          type: "file",
          mediaType: "application/pdf",
          data: fileId,
        };
      } else {
        // Handle file_data format
        const fileData = part.file as { filename: string; file_data: string };
        const parsed = parseDataUri(fileData.file_data);
        logger.debug(`Converting file with filename: ${fileData.filename}, parsed media type: ${parsed?.mediaType || "application/pdf"}`);
        return {
          type: "file",
          mediaType: parsed?.mediaType || "application/pdf",
          data: parsed?.data || fileData.file_data,
          filename: fileData.filename,
        };
      }
    }
  }
}

/**
 * Convert tool call arguments from JSON string to object.
 * Returns raw string on parse error with warning.
 */
function convertToolCallArguments(
  argumentsStr: string,
  toolName: string,
  warnings: Array<{ type: string; message: string }>
): unknown {
  const preview = argumentsStr.length > 100 ? `${argumentsStr.substring(0, 100)}...` : argumentsStr;
  logger.debug(`Parsing tool call arguments for '${toolName}', preview: "${preview}"`);

  try {
    const parsed = JSON.parse(argumentsStr);
    logger.debug(`Successfully parsed tool call arguments for '${toolName}'`);
    return parsed;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "unknown error";
    const warning = {
      type: "other",
      message: `Failed to parse tool call arguments for ${toolName}: ${errorMessage}`,
    };
    warnings.push(warning);
    logger.warn(warning.message);
    logger.debug(`Using raw arguments string for tool '${toolName}'`);
    return { _raw: argumentsStr };
  }
}

/**
 * Detect if a string is JSON and parse it, or treat as plain text.
 */
function parseToolOutput(content: string): LanguageModelV2ToolResultOutput {
  const contentPreview = content.length > 100 ? `${content.substring(0, 100)}...` : content;
  logger.debug(`Parsing tool output, content preview: "${contentPreview}"`);

  try {
    const parsed = JSON.parse(content);
    logger.debug(`Successfully parsed tool output as JSON`);
    return { type: "json", value: parsed };
  } catch {
    logger.debug(`Failed to parse as JSON, treating as text content`);
    return { type: "text", value: content };
  }
}

// ============================================================================
// Main Conversion Function
// ============================================================================

/**
 * Convert an OpenAI Chat Completions API request to LanguageModelV2 format.
 *
 * @param request - OpenAI Chat Completions API request object
 * @returns Converted LanguageModelV2 prompt, options, and warnings
 *
 * @example
 * ```typescript
 * const request: OpenAIChatRequest = {
 *   messages: [
 *     { role: 'user', content: 'Hello' }
 *   ],
 *   temperature: 0.7,
 * };
 *
 * const result = convertFromOpenAIChatRequest(request);
 * console.log(result.prompt); // LanguageModelV2Prompt
 * console.log(result.options); // Partial<LanguageModelV2CallOptions>
 * ```
 */
export function convertFromOpenAIChatRequest(
  request: OpenAIChatRequest
): ConvertedRequest {
  logger.info('Starting conversion from OpenAI Chat Completions API request to LanguageModelV2 format');
  logger.debug(`Request contains ${request.messages.length} messages`);

  const warnings: Array<{ type: string; message: string }> = [];
  const messages: LanguageModelV2Prompt = [];

  // Build tool name map for tool message recovery
  logger.debug('Building tool name map from assistant messages');
  const toolNameMap = buildToolNameMap(request.messages);

  // Convert messages
  logger.debug(`Converting ${request.messages.length} message(s)`);
  for (let i = 0; i < request.messages.length; i++) {
    const message = request.messages[i];
    logger.debug(`Processing message ${i + 1} with role: ${message.role}`);

    switch (message.role) {
      case "system":
      case "developer": {
        if (message.role === "developer") {
          const warning = {
            type: "other",
            message: "developer role converted to system role (not supported in V2)",
          };
          warnings.push(warning);
          logger.warn(warning.message);
        }
        messages.push({
          role: "system",
          content: message.content,
        });
        logger.debug(`Added system message with ${message.content.length} characters`);
        break;
      }

      case "user": {
        if (typeof message.content === "string") {
          messages.push({
            role: "user",
            content: [{ type: "text", text: message.content }],
          });
          logger.debug(`Added user message (string) with ${message.content.length} characters`);
        } else {
          const convertedContent = message.content.map((part) =>
            convertUserContentPart(part)
          );
          messages.push({
            role: "user",
            content: convertedContent,
          });
          logger.debug(`Added user message with ${message.content.length} content part(s)`);
        }
        break;
      }

      case "assistant": {
        const content: Array<
          LanguageModelV2TextPart | LanguageModelV2ToolCallPart
        > = [];

        // Add text content if present
        if (message.content) {
          content.push({
            type: "text",
            text: message.content,
          });
          logger.debug(`Added assistant text content with ${message.content.length} characters`);
        }

        // Add tool calls if present
        if (message.tool_calls) {
          logger.debug(`Processing ${message.tool_calls.length} tool call(s) for assistant message`);
          for (const toolCall of message.tool_calls) {
            const toolCallPart: LanguageModelV2ToolCallPart = {
              type: "tool-call",
              toolCallId: toolCall.id,
              toolName: toolCall.function.name,
              input: convertToolCallArguments(
                toolCall.function.arguments,
                toolCall.function.name,
                warnings
              ),
            };
            content.push(toolCallPart);
            logger.silly(`Added tool call for '${toolCall.function.name}' with ID '${toolCall.id}'`);
          }
        }

        if (content.length > 0) {
          messages.push({
            role: "assistant",
            content,
          });
          logger.silly(`Added assistant message with ${content.length} content part(s)`);
        }
        break;
      }

      case "tool": {
        const toolName = toolNameMap.get(message.tool_call_id) || "";
        const toolResultPart: LanguageModelV2ToolResultPart = {
          type: "tool-result",
          toolCallId: message.tool_call_id,
          toolName,
          output: parseToolOutput(message.content),
        };

        messages.push({
          role: "tool",
          content: [toolResultPart],
        });
        logger.silly(`Added tool message for tool '${toolName}' with ID '${message.tool_call_id}'`);
        break;
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
    frequencyPenalty: request.frequency_penalty,
    presencePenalty: request.presence_penalty,
    seed: request.seed,
  };

  if (request.max_tokens) {
    logger.debug(`Set maxOutputTokens: ${request.max_tokens}`);
  }
  if (request.temperature !== undefined) {
    logger.debug(`Set temperature: ${request.temperature}`);
  }

  // Convert stop sequences
  if (request.stop) {
    const stopSequences = Array.isArray(request.stop) ? request.stop : [request.stop];
    options.stopSequences = stopSequences;
    logger.debug(`Set stop sequences: ${stopSequences.join(', ')}`);
  }

  // Convert response format
  if (request.response_format) {
    logger.debug('Converting response format configuration');
    if (request.response_format.type === "text") {
      options.responseFormat = { type: "text" };
      logger.debug('Set response format to text');
    } else if (request.response_format.type === "json_object") {
      options.responseFormat = { type: "json" };
      logger.debug('Set response format to json object');
    } else if (request.response_format.type === "json_schema") {
      options.responseFormat = {
        type: "json",
        schema: request.response_format.json_schema.schema,
        name: request.response_format.json_schema.name,
        description: request.response_format.json_schema.description,
      };
      logger.debug(`Set response format to json schema: ${request.response_format.json_schema.name || 'unnamed'}`);
    }
  }

  // Convert tools
  if (request.tools) {
    options.tools = new Array<LanguageModelV2FunctionTool>();
    logger.debug(`Converting ${request.tools.length} tool definition(s)`);
    for (const tool of request.tools) {
      logger.silly(`Converting tool: ${tool.function.name}`);
      
      // Ensure parameters have type: "object" - create a new object with the required fields
      const parameters = tool.function.parameters as Record<string, unknown>;
      const inputSchema: Record<string, unknown> = {
        ...parameters,
      };
      
      // Ensure type field is set to "object"
      if (!inputSchema.type || inputSchema.type === "None" || inputSchema.type === null) {
        logger.debug(`Tool '${tool.function.name}' parameters missing or invalid type field, setting to 'object'`);
        inputSchema.type = "object";
      }
      
      const convertedTool: LanguageModelV2FunctionTool = {
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        inputSchema: inputSchema,
      };
      options.tools.push(convertedTool);
      logger.silly(`Converted tool: ${convertedTool.name}`);
    }
    logger.debug(`Converted tools: ${request.tools.map(t => t.function.name).join(', ')}`);
  }

  // Convert tool choice
  if (request.tool_choice) {
    logger.silly('Converting tool choice configuration');
    if (typeof request.tool_choice === "string") {
      switch (request.tool_choice) {
        case "auto":
          options.toolChoice = { type: "auto" };
          logger.debug('Set tool choice to auto');
          break;
        case "none":
          options.toolChoice = { type: "none" };
          logger.debug('Set tool choice to none');
          break;
        case "required":
          options.toolChoice = { type: "required" };
          logger.debug('Set tool choice to required');
          break;
      }
    } else {
      options.toolChoice = {
        type: "tool",
        toolName: request.tool_choice.function.name,
      } as LanguageModelV2ToolChoice;
      logger.debug(`Set tool choice to specific tool: ${request.tool_choice.function.name}`);
    }
  }

  logger.info(`Conversion completed successfully. Generated ${messages.length} messages, ${warnings.length} warning(s)`);
  if (warnings.length > 0) {
    logger.warn(`Warnings generated: ${warnings.map(w => w.message).join('; ')}`);
  }

  return {
    model: request.model,
    options: options,
    warnings: warnings.length > 0 ? warnings : undefined,
  } satisfies ConvertedRequest;
}
