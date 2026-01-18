import { UnifiedTool } from "../../types/unified";

/**
 * Converts Anthropic's tool format to unified format.
 *
 * Anthropic uses: { name, description, input_schema }
 * Unified uses: { type: "function", function: { name, description, parameters } }
 */
export function convertAnthropicToolsToUnified(tools: any[]): UnifiedTool[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

/**
 * Converts unified tool format to Anthropic's format.
 *
 * Unified uses: { type: "function", function: { name, description, parameters }
 * Anthropic uses: { name, description, input_schema }
 */
export function convertUnifiedToolsToAnthropic(tools: UnifiedTool[]): any[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}
