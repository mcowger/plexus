import { JSONSchema7 } from "json-schema";
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
} from "@ai-sdk/provider";
import { logger } from "../../utils/logger.js";

// ============================================================================
// Responses API Type Definitions
// ============================================================================

/** OpenAI Responses API request structure */
export interface OpenAIResponsesRequest {
  input: Array<OpenAIResponsesInputItem>;
  model?: string;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  seed?: number;
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
  tools?: Array<OpenAIResponsesFunctionTool | OpenAIResponsesProviderTool>;
  tool_choice?:
    | "auto"
    | "none"
    | "required"
    | { type: "function"; function: { name: string } };
}

/** Union type for all Responses API input items */
type OpenAIResponsesInputItem =
  | OpenAIResponsesSystemMessage
  | OpenAIResponsesUserMessage
  | OpenAIResponsesAssistantMessage
  | OpenAIResponsesFunctionCall
  | OpenAIResponsesFunctionCallOutput
  | OpenAIResponsesReasoning
  | OpenAIResponsesMcpApprovalResponse
  | OpenAIResponsesComputerCall
  | OpenAIResponsesLocalShellCall
  | OpenAIResponsesLocalShellCallOutput
  | OpenAIResponsesShellCall
  | OpenAIResponsesShellCallOutput
  | OpenAIResponsesApplyPatchCall
  | OpenAIResponsesApplyPatchCallOutput
  | OpenAIResponsesItemReference;

// System/Developer Messages
interface OpenAIResponsesSystemMessage {
  role: "system" | "developer";
  content: string;
}

// User Messages
interface OpenAIResponsesUserMessage {
  role: "user";
  content: Array<OpenAIResponsesUserContentPart>;
}

type OpenAIResponsesUserContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string }
  | { type: "input_image"; file_id: string }
  | { type: "input_file"; file_url: string }
  | { type: "input_file"; filename: string; file_data: string }
  | { type: "input_file"; file_id: string };

// Assistant Messages
interface OpenAIResponsesAssistantMessage {
  role: "assistant";
  content: Array<{ type: "output_text"; text: string }>;
  id?: string;
}

// Function Calls
interface OpenAIResponsesFunctionCall {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
  id?: string;
}

// Function Call Outputs
interface OpenAIResponsesFunctionCallOutput {
  type: "function_call_output";
  call_id: string;
  output:
    | string
    | Array<
        | { type: "input_text"; text: string }
        | { type: "input_image"; image_url: string }
        | { type: "input_file"; filename: string; file_data: string }
      >;
}

// Reasoning
interface OpenAIResponsesReasoning {
  type: "reasoning";
  id: string;
  encrypted_content?: string | null;
  summary: Array<{
    type: "summary_text";
    text: string;
  }>;
}

// MCP Approval Response
interface OpenAIResponsesMcpApprovalResponse {
  type: "mcp_approval_response";
  approval_request_id: string;
  approve: boolean;
}

// Computer Call
interface OpenAIResponsesComputerCall {
  type: "computer_call";
  id: string;
  status?: string;
}

// Local Shell Call
interface OpenAIResponsesLocalShellCall {
  type: "local_shell_call";
  id: string;
  call_id: string;
  action: {
    type: "exec";
    command: string[];
    timeout_ms?: number;
    user?: string;
    working_directory?: string;
    env?: Record<string, string>;
  };
}

// Local Shell Call Output
interface OpenAIResponsesLocalShellCallOutput {
  type: "local_shell_call_output";
  call_id: string;
  output: string;
}

// Shell Call
interface OpenAIResponsesShellCall {
  type: "shell_call";
  id: string;
  call_id: string;
  status: "in_progress" | "completed" | "incomplete";
  action: {
    commands: string[];
    timeout_ms?: number;
    max_output_length?: number;
  };
}

// Shell Call Output
interface OpenAIResponsesShellCallOutput {
  type: "shell_call_output";
  call_id: string;
  max_output_length?: number;
  output: Array<{
    stdout: string;
    stderr: string;
    outcome: { type: "timeout" } | { type: "exit"; exit_code: number };
  }>;
}

// Apply Patch Call
interface OpenAIResponsesApplyPatchCall {
  type: "apply_patch_call";
  id?: string;
  call_id: string;
  status: "in_progress" | "completed";
  operation:
    | {
        type: "create_file";
        path: string;
        diff: string;
      }
    | {
        type: "delete_file";
        path: string;
      }
    | {
        type: "update_file";
        path: string;
        diff: string;
      };
}

// Apply Patch Call Output
interface OpenAIResponsesApplyPatchCallOutput {
  type: "apply_patch_call_output";
  call_id: string;
  status: "completed" | "failed";
  output?: string;
}

// Item Reference
interface OpenAIResponsesItemReference {
  type: "item_reference";
  id: string;
}

// Tools
interface OpenAIResponsesFunctionTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: JSONSchema7;
    strict?: boolean;
  };
}

type OpenAIResponsesProviderTool =
  | { type: "web_search" }
  | { type: "web_search_preview" }
  | { type: "code_interpreter" }
  | { type: "file_search" }
  | { type: "image_generation" }
  | { type: "mcp" }
  | { type: "local_shell" }
  | { type: "shell" }
  | { type: "apply_patch" }
  | { type: "computer_use" };

// ============================================================================
// Result Type
// ============================================================================

/**
 * Result of converting an OpenAI Responses API request
 * to LanguageModelV2 format.
 */
export interface ConvertFromOpenAIResponsesRequestResult {
  /** Converted LanguageModelV2 prompt */
  prompt: LanguageModelV2Prompt;
  /** Converted LanguageModelV2 call options */
  options: Partial<LanguageModelV2CallOptions>;
  /** Warnings generated during conversion for unsupported features */
  warnings: Array<{ type: string; message: string }>;
}

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
 * Build a map of call IDs to function names from function calls.
 * This helps recover the tool name for function call output messages.
 */
function buildFunctionNameMap(
  items: Array<OpenAIResponsesInputItem>
): Map<string, string> {
  const functionNameMap = new Map<string, string>();
  let functionCount = 0;

  for (const item of items) {
    // Only process items with 'type' field (not 'role' field messages)
    if ("type" in item && item.type === "function_call") {
      const functionCallItem = item as OpenAIResponsesFunctionCall;
      functionNameMap.set(functionCallItem.call_id, functionCallItem.name);
      functionCount++;
      logger.debug(`Mapped function call ID '${functionCallItem.call_id}' to function name '${functionCallItem.name}'`);
    }
  }

  logger.debug(`Built function name map with ${functionCount} function call(s) from ${items.length} input item(s)`);
  return functionNameMap;
}

/**
 * Convert a Responses API user content part to LanguageModelV2 content part.
 */
function convertUserContentPart(
  part: OpenAIResponsesUserContentPart
): LanguageModelV2TextPart | LanguageModelV2FilePart {
  logger.debug(`Converting content part of type: ${part.type}`);

  switch (part.type) {
    case "input_text": {
      const textPart = part as { type: "input_text"; text: string };
      logger.debug(`Converting input text with length: ${textPart.text.length} characters`);
      return {
        type: "text",
        text: textPart.text,
      };
    }

    case "input_image": {
      if ("image_url" in part) {
        const url = part.image_url;
        logger.debug(`Converting input image from URL: ${url}`);

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
      } else {
        // file_id format
        const fileId = part.file_id;
        logger.debug(`Converting input image with file ID: ${fileId}`);
        return {
          type: "file",
          mediaType: "image/*",
          data: fileId,
        };
      }
    }

    case "input_file": {
      if ("file_url" in part) {
        const fileUrl = part.file_url;
        logger.debug(`Converting input file from URL: ${fileUrl}`);
        return {
          type: "file",
          mediaType: "application/octet-stream",
          data: new URL(fileUrl),
        };
      } else if ("file_id" in part) {
        const fileId = part.file_id;
        logger.debug(`Converting input file with ID: ${fileId}`);
        return {
          type: "file",
          mediaType: "application/octet-stream",
          data: fileId,
        };
      } else {
        // filename + file_data format
        const fileData = part as { filename: string; file_data: string };
        const parsed = parseDataUri(fileData.file_data);
        logger.debug(`Converting input file with filename: ${fileData.filename}, parsed media type: ${parsed?.mediaType || "application/octet-stream"}`);
        return {
          type: "file",
          mediaType: parsed?.mediaType || "application/octet-stream",
          data: parsed?.data || fileData.file_data,
          filename: fileData.filename,
        };
      }
    }
  }
}

/**
 * Convert function call arguments from JSON string to object.
 * Returns raw string on parse error with warning.
 */
function convertFunctionCallArguments(
  argumentsStr: string,
  functionName: string,
  warnings: Array<{ type: string; message: string }>
): unknown {
  const preview = argumentsStr.length > 100 ? `${argumentsStr.substring(0, 100)}...` : argumentsStr;
  logger.debug(`Parsing function call arguments for '${functionName}', preview: "${preview}"`);

  try {
    const parsed = JSON.parse(argumentsStr);
    logger.debug(`Successfully parsed function call arguments for '${functionName}'`);
    return parsed;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "unknown error";
    const warning = {
      type: "other",
      message: `Failed to parse function call arguments for ${functionName}: ${errorMessage}`,
    };
    warnings.push(warning);
    logger.warn(warning.message);
    logger.debug(`Using raw arguments string for function '${functionName}'`);
    return { _raw: argumentsStr };
  }
}

/**
 * Detect if a string is JSON and parse it, or treat as plain text.
 */
function parseFunctionOutput(content: string): LanguageModelV2ToolResultOutput {
  const contentPreview = content.length > 100 ? `${content.substring(0, 100)}...` : content;
  logger.debug(`Parsing function output, content preview: "${contentPreview}"`);

  try {
    const parsed = JSON.parse(content);
    logger.debug(`Successfully parsed function output as JSON`);
    return { type: "json", value: parsed };
  } catch {
    logger.debug(`Failed to parse as JSON, treating as text content`);
    return { type: "text", value: content };
  }
}

/**
 * Convert function call output parts (content array) to tool result output.
 */
function convertFunctionCallOutputContent(
  content: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string }
    | { type: "input_file"; filename: string; file_data: string }
  >
): LanguageModelV2ToolResultOutput {
  const contentItems: Array<
    | { type: "text"; text: string }
    | { type: "media"; data: string; mediaType: string }
  > = [];

  for (const part of content) {
    switch (part.type) {
      case "input_text": {
        contentItems.push({
          type: "text",
          text: part.text,
        });
        break;
      }

      case "input_image": {
        const url = part.image_url;
        const parsed = parseDataUri(url);
        if (parsed) {
          contentItems.push({
            type: "media",
            data: parsed.data,
            mediaType: parsed.mediaType,
          });
        }
        break;
      }

      case "input_file": {
        const parsed = parseDataUri(part.file_data);
        if (parsed) {
          contentItems.push({
            type: "media",
            data: parsed.data,
            mediaType: parsed.mediaType,
          });
        }
        break;
      }
    }
  }

  return {
    type: "content",
    value: contentItems,
  };
}

// ============================================================================
// Main Conversion Function
// ============================================================================

/**
 * Convert an OpenAI Responses API request to LanguageModelV2 format.
 *
 * @param request - OpenAI Responses API request object
 * @returns Converted LanguageModelV2 prompt, options, and warnings
 *
 * @example
 * ```typescript
 * const request: OpenAIResponsesRequest = {
 *   input: [
 *     { role: 'user', content: [{ type: 'input_text', text: 'Hello' }] }
 *   ],
 *   temperature: 0.7,
 * };
 *
 * const result = convertFromOpenAIResponsesRequest(request);
 * console.log(result.prompt); // LanguageModelV2Prompt
 * console.log(result.options); // Partial<LanguageModelV2CallOptions>
 * ```
 */
export function convertFromOpenAIResponsesRequest(
  request: OpenAIResponsesRequest
): ConvertFromOpenAIResponsesRequestResult {
  logger.info('Starting conversion from OpenAI Responses API request to LanguageModelV2 format');
  logger.debug(`Request contains ${request.input.length} input item(s)`);

  const warnings: Array<{ type: string; message: string }> = [];
  const messages: LanguageModelV2Prompt = [];

  // Build function name map for function output recovery
  logger.debug('Building function name map from function call items');
  const functionNameMap = buildFunctionNameMap(request.input);

  // Convert input items
  logger.debug(`Converting ${request.input.length} input item(s)`);
  for (let i = 0; i < request.input.length; i++) {
    const item = request.input[i];
    logger.debug(`Processing input item ${i + 1}`);

    // Handle messages with 'role' field (system, developer, user, assistant)
    if ("role" in item) {
      if (item.role === "system" || item.role === "developer") {
        if (item.role === "developer") {
          const warning = {
            type: "other",
            message: "developer role converted to system role (not supported in V2)",
          };
          warnings.push(warning);
          logger.warn(warning.message);
        }
        messages.push({
          role: "system",
          content: item.content,
        });
        logger.debug(`Added system message with ${item.content.length} characters`);
      } else if (item.role === "user") {
        const convertedContent = item.content.map((part) => convertUserContentPart(part));
        messages.push({
          role: "user",
          content: convertedContent,
        });
        logger.debug(`Added user message with ${item.content.length} content part(s)`);
      } else if (item.role === "assistant") {
        messages.push({
          role: "assistant",
          content: item.content.map((part) => ({
            type: "text" as const,
            text: part.text,
          })),
        });
        logger.debug(`Added assistant message with ${item.content.length} content part(s)`);
      }
      continue;
    }

    // Handle items with 'type' field - cast to ensure type narrowing
    const typedItem = item as {
      type: string;
      call_id?: string;
      name?: string;
      arguments?: string;
      output?: unknown;
      encrypted_content?: string | null;
      approval_request_id?: string;
      id?: string;
      status?: string;
      action?: unknown;
      operation?: unknown;
    };

    switch (typedItem.type) {
      case "function_call": {
        const functionCallItem = typedItem as OpenAIResponsesFunctionCall;
        const toolCallPart: LanguageModelV2ToolCallPart = {
          type: "tool-call",
          toolCallId: functionCallItem.call_id,
          toolName: functionCallItem.name,
          input: convertFunctionCallArguments(
            functionCallItem.arguments,
            functionCallItem.name,
            warnings
          ),
        };

        // Add as assistant message with tool call
        messages.push({
          role: "assistant",
          content: [toolCallPart],
        });
        logger.debug(`Added function call for '${functionCallItem.name}' with call ID '${functionCallItem.call_id}'`);
        break;
      }

      case "function_call_output": {
        const outputItem = typedItem as OpenAIResponsesFunctionCallOutput;
        const functionName = functionNameMap.get(outputItem.call_id) || "";
        let output: LanguageModelV2ToolResultOutput;

        if (typeof outputItem.output === "string") {
          output = parseFunctionOutput(outputItem.output);
        } else {
          output = convertFunctionCallOutputContent(outputItem.output);
        }

        const toolResultPart: LanguageModelV2ToolResultPart = {
          type: "tool-result",
          toolCallId: outputItem.call_id,
          toolName: functionName,
          output,
        };

        messages.push({
          role: "tool",
          content: [toolResultPart],
        });
        logger.debug(`Added function call output for call ID '${outputItem.call_id}', function: '${functionName}'`);
        break;
      }

      case "reasoning": {
        const reasoningItem = typedItem as OpenAIResponsesReasoning;
        const reasoningText = reasoningItem.summary
          .filter((s) => s.type === "summary_text")
          .map((s) => s.text)
          .join("\n");

        if (reasoningText) {
          const reasoningPart: LanguageModelV2ReasoningPart = {
            type: "reasoning",
            text: reasoningText,
          };

          messages.push({
            role: "assistant",
            content: [reasoningPart],
          });
          logger.debug(`Added reasoning content with ${reasoningText.length} characters`);
        }

        if (reasoningItem.encrypted_content) {
          const warning = {
            type: "other",
            message: "Encrypted reasoning content is not converted to V2 format",
          };
          warnings.push(warning);
          logger.warn(warning.message);
        }
        break;
      }

      case "mcp_approval_response": {
        const warning = {
          type: "unsupported",
          message: "MCP approval responses are not supported in V2 format",
        };
        warnings.push(warning);
        logger.warn(warning.message);
        break;
      }

      case "computer_call": {
        const warning = {
          type: "unsupported",
          message: "Computer calls are not supported in V2 format",
        };
        warnings.push(warning);
        logger.warn(warning.message);
        break;
      }

      case "local_shell_call": {
        const warning = {
          type: "unsupported",
          message: "Local shell calls are not supported in V2 format",
        };
        warnings.push(warning);
        logger.warn(warning.message);
        break;
      }

      case "local_shell_call_output": {
        const warning = {
          type: "unsupported",
          message: "Local shell call outputs are not supported in V2 format",
        };
        warnings.push(warning);
        logger.warn(warning.message);
        break;
      }

      case "shell_call": {
        const warning = {
          type: "unsupported",
          message: "Shell calls are not supported in V2 format",
        };
        warnings.push(warning);
        logger.warn(warning.message);
        break;
      }

      case "shell_call_output": {
        const warning = {
          type: "unsupported",
          message: "Shell call outputs are not supported in V2 format",
        };
        warnings.push(warning);
        logger.warn(warning.message);
        break;
      }

      case "apply_patch_call": {
        const warning = {
          type: "unsupported",
          message: "Apply patch calls are not supported in V2 format",
        };
        warnings.push(warning);
        logger.warn(warning.message);
        break;
      }

      case "apply_patch_call_output": {
        const warning = {
          type: "unsupported",
          message: "Apply patch call outputs are not supported in V2 format",
        };
        warnings.push(warning);
        logger.warn(warning.message);
        break;
      }

      case "item_reference": {
        const warning = {
          type: "unsupported",
          message: "Item references are not supported in V2 format",
        };
        warnings.push(warning);
        logger.warn(warning.message);
        break;
      }

      default: {
        logger.warn(`Unknown input item type: ${typedItem.type}`);
        break;
      }
    }
  }

  // Convert parameters
  logger.debug('Converting request parameters');
  const options: Partial<LanguageModelV2CallOptions> = {
    prompt: messages,
    maxOutputTokens: request.max_output_tokens,
    temperature: request.temperature,
    topP: request.top_p,
    frequencyPenalty: request.frequency_penalty,
    presencePenalty: request.presence_penalty,
    seed: request.seed,
  };

  if (request.max_output_tokens) {
    logger.debug(`Set maxOutputTokens: ${request.max_output_tokens}`);
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
    logger.debug(`Processing ${request.tools.length} tool definition(s)`);
    options.tools = request.tools
      .filter((tool) => tool.type === "function")
      .map((tool) => {
        if (tool.type === "function") {
          return {
            type: "function",
            name: tool.function.name,
            description: tool.function.description,
            inputSchema: tool.function.parameters,
            strict: tool.function.strict,
          };
        }
        // This line should be unreachable due to filter, but keeps type safety
        return tool as never;
      });

    logger.debug(`Converted ${options.tools?.length || 0} function tool(s)`);

    // Warn about provider tools
    const providerTools = request.tools.filter(
      (tool) => tool.type !== "function"
    );
    if (providerTools.length > 0) {
      const warning = {
        type: "other",
        message: `Provider tools (${providerTools
          .map((t) => (t as any).type)
          .join(", ")}) are not converted to V2 format`,
      };
      warnings.push(warning);
      logger.warn(warning.message);
    }
  }

  // Convert tool choice
  if (request.tool_choice) {
    logger.debug('Converting tool choice configuration');
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
      };
      logger.debug(`Set tool choice to specific tool: ${request.tool_choice.function.name}`);
    }
  }

  logger.info(`Conversion completed successfully. Generated ${messages.length} messages, ${warnings.length} warning(s)`);
  if (warnings.length > 0) {
    logger.warn(`Warnings generated: ${warnings.map(w => w.message).join('; ')}`);
  }

  return {
    prompt: messages,
    options,
    warnings,
  };
}
