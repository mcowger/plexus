import { UnifiedTool } from '../../types/unified';

/**
 * Converts Anthropic's tool format to unified format.
 *
 * Anthropic uses: { name, description, input_schema }
 * Unified uses: { type: "function", function: { name, description, parameters } }
 *
 * Built-in Anthropic tools (e.g. web_search_20250305) are passed through as-is
 * so they survive the round-trip and can be coerced by provider adapters.
 */
export function convertAnthropicToolsToUnified(tools: any[]): UnifiedTool[] {
  return tools.map((t: any) => {
    // Pass through built-in Anthropic tool types verbatim
    if (t.type && ANTHROPIC_BUILTIN_TOOL_TYPES.has(t.type)) {
      return t as unknown as UnifiedTool;
    }
    // Pull out the fields we explicitly map; everything else (e.g.
    // eager_input_streaming, cache_control, type) is carried through as
    // extra fields so Anthropic-native tool options survive a same-format
    // (messages -> messages) round-trip.
    const { name, description, input_schema, ...rest } = t;
    const tool: any = {
      type: 'function' as const,
      function: {
        name,
        description,
        parameters: input_schema,
      },
    };
    if (rest && Object.keys(rest).length > 0) {
      tool._anthropicExtras = rest;
    }
    return tool;
  });
}

/**
 * Anthropic built-in tool type strings that must be passed through as-is.
 * These are server-side tools (e.g. web search) that Anthropic recognises by
 * their `type` field and must NOT be mapped to the custom function schema.
 */
const ANTHROPIC_BUILTIN_TOOL_TYPES = new Set(['web_search_20250305']);

/**
 * Converts unified tool format to Anthropic's format.
 *
 * Unified uses: { type: "function", function: { name, description, parameters }
 * Anthropic uses: { name, description, input_schema }
 *
 * Built-in Anthropic tools (e.g. web_search_20250305) are passed through
 * unchanged — they are not function declarations and must not be rewritten.
 */
export function convertUnifiedToolsToAnthropic(tools: UnifiedTool[]): any[] {
  return tools.map((t: any) => {
    // Pass through built-in Anthropic tool types verbatim
    if (t.type && ANTHROPIC_BUILTIN_TOOL_TYPES.has(t.type)) {
      return t;
    }
    const result: any = {
      name: t.function?.name ?? '',
      description: t.function?.description ?? '',
      input_schema: t.function?.parameters ?? {},
    };
    // Re-attach Anthropic-native extras preserved on parse (e.g.
    // eager_input_streaming, cache_control) so they survive the round-trip.
    if (t._anthropicExtras && typeof t._anthropicExtras === 'object') {
      Object.assign(result, t._anthropicExtras);
    }
    return result;
  });
}
