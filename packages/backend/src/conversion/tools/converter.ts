import { LanguageModelV2FunctionTool, LanguageModelV2ProviderDefinedTool, LanguageModelV2ToolChoice } from "@ai-sdk/provider";
import { ToolSet, ToolChoice, tool, jsonSchema } from "ai";
import { logger } from "../../utils/logger.js";

/**
 * Type guard to check if a tool is a LanguageModelV2FunctionTool and not a LanguageModelV2ProviderDefinedTool.
 */
function isLanguageModelFunctionTool(
  tool: LanguageModelV2FunctionTool | LanguageModelV2ProviderDefinedTool
): tool is LanguageModelV2FunctionTool {
  return "inputSchema" in tool && tool.inputSchema !== undefined;
}

/**
 * Convert an array of LanguageModelV2FunctionTool to a ToolSet for use with generateText().
 *
 * The conversion creates a Record<string, Tool> where each tool is keyed by its name.
 * This format is required by the AI SDK's generateText function.
 * LanguageModelV2ProviderDefinedTool instances are filtered out.
 *
 * Uses the AI SDK's built-in tool() and jsonSchema() helpers for proper schema handling.
 *
 * @param tools - Array of LanguageModelV2FunctionTool and/or LanguageModelV2ProviderDefinedTool to convert
 * @returns ToolSet object compatible with generateText, or undefined if input is empty
 */
export function convertLanguageModelToolsToToolSet(
  tools: Array<LanguageModelV2FunctionTool | LanguageModelV2ProviderDefinedTool> | undefined
): ToolSet | undefined {
  // Handle undefined or empty array
  if (!tools || tools.length === 0) {
    logger.debug("No tools provided to convert");
    return undefined;
  }

  logger.debug(`Converting ${tools.length} LanguageModelV2FunctionTool(s) to ToolSet`);

  const toolSet: ToolSet = {};

  // Use explicit for loop as required
  for (let i = 0; i < tools.length; i++) {
    
    const languageModelTool: LanguageModelV2FunctionTool | LanguageModelV2ProviderDefinedTool = tools[i];

    // Validate tool structure
    if (!languageModelTool || typeof languageModelTool !== "object") {
      logger.warn(`Tool at index ${i} is not a valid object, skipping`);
      continue;
    }

    // Exclude LanguageModelV2ProviderDefinedTool from conversion
    if (!isLanguageModelFunctionTool(languageModelTool)) {
      logger.debug(`Tool at index ${i} is a LanguageModelV2ProviderDefinedTool, skipping`);
      continue;
    }

    // Validate tool name
    const toolName: string | undefined = languageModelTool.name;
    if (!toolName || typeof toolName !== "string") {
      logger.warn(`Tool at index ${i} has invalid or missing name, skipping`);
      continue;
    }

    // Validate that tool has required properties
    if (!languageModelTool.description && !languageModelTool.inputSchema) {
      logger.warn(`Tool '${toolName}' has no description or inputSchema, skipping`);
      continue;
    }

    // Get the input schema, ensuring it has required JSON Schema properties
    let inputSchemaObject = languageModelTool.inputSchema as Record<string, unknown> | undefined;
    
    if (!inputSchemaObject) {
      logger.debug(`Tool '${toolName}' has no inputSchema, using empty object schema`);
      inputSchemaObject = { type: "object", properties: {} };
    } else {
      // Ensure the schema is an object (copy to avoid mutation)
      inputSchemaObject = { ...inputSchemaObject };
      
      // Ensure type is set to "object"
      if (!inputSchemaObject.type || inputSchemaObject.type === "None" || inputSchemaObject.type === null) {
        logger.debug(`Tool '${toolName}' inputSchema has invalid type: ${inputSchemaObject.type}, setting to 'object'`);
        inputSchemaObject.type = "object";
      }
      
      // Ensure properties exists (default to empty object)
      if (!inputSchemaObject.properties) {
        logger.debug(`Tool '${toolName}' inputSchema missing properties, setting to empty object`);
        inputSchemaObject.properties = {};
      }
    }

    try {
      // Use AI SDK's jsonSchema helper to create a properly validated schema
      const schema = jsonSchema(inputSchemaObject);
      
      // Use AI SDK's tool helper to create the tool definition
      const aiTool = tool({
        description: languageModelTool.description || `Tool: ${toolName}`,
        inputSchema: schema,
      });
      
      // Add tool to ToolSet with tool name as key
      toolSet[toolName] = aiTool;
      logger.silly(`Added tool '${toolName}' to ToolSet using AI SDK tool() helper`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to convert tool '${toolName}': ${errorMessage}`);
      continue;
    }
  }

  // Validate that we successfully converted at least one tool
  const toolSetKeys: string[] = Object.keys(toolSet);
  if (toolSetKeys.length === 0) {
    logger.warn("No valid tools were converted from input array");
    return undefined;
  }

  logger.info(`Successfully converted ${toolSetKeys.length} tool(s) to ToolSet`);
  return toolSet;
}

/**
 * Convert LanguageModelV2ToolChoice to the appropriate format for the AI SDK.
 *
 * Filters out provider-defined tools by ensuring only function tools are referenced
 * in the tool choice. If the referenced tool is a provider-defined tool, returns undefined.
 *
 * @param toolChoice - LanguageModelV2ToolChoice to convert
 * @param functionToolNames - Set of function tool names available for selection
 * @returns Converted tool choice compatible with generateText, or undefined if invalid
 */
export function convertLanguageModelToolChoice(
  toolChoice: LanguageModelV2ToolChoice | undefined,
  functionToolNames: Set<string>
): ToolChoice<ToolSet> | undefined {
  // Handle undefined tool choice
  if (!toolChoice) {
    logger.debug("No tool choice provided");
    return undefined;
  }

  logger.debug(`Converting tool choice with type: ${toolChoice.type}`);

  // Auto type
  if (toolChoice.type === "auto") {
    logger.info(`Tool choice type 'auto' converted to 'auto'`);
    return "auto";
  }

  // None type
  if (toolChoice.type === "none") {
    logger.info(`Tool choice type 'none' converted to 'none'`);
    return "none";
  }

  // Required type
  if (toolChoice.type === "required") {
    logger.info(`Tool choice type 'required' converted to 'required'`);
    return "required";
  }

  // For specific tool selection, validate that it's a function tool
  if (toolChoice.type === "tool") {
    const toolName = toolChoice.toolName;
    
    // Check if the tool name is in the function tools set
    if (!functionToolNames.has(toolName)) {
      logger.warn(`Tool choice references '${toolName}', which is not a valid function tool or is provider-defined, returning undefined`);
      return undefined;
    }

    logger.info(`Tool choice set to specific tool: ${toolName}`);
    return {
      type: "tool",
      toolName: toolName,
    };
  }

  logger.warn(`Unknown tool choice type encountered`);
  return undefined;
}
