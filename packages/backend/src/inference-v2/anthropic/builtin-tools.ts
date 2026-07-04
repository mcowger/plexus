/**
 * Anthropic built-in (server-side) tool vocabulary, shared across the
 * inference-v2 beta path's inbound parser (anthropic-to-context.ts) and the
 * raw-response tap (shared/fetch-tap.ts) so the request-side tool-type
 * allowlist and the response-side block-type allowlist stay in lockstep — add
 * a new Anthropic server tool here once and both sides pick it up.
 *
 * Intentionally NOT shared with the v1 transformer path
 * (transformers/anthropic/tool-mapper.ts), which keeps its own copy: v1 and v2
 * share no code.
 */

/**
 * Tool `type` values Anthropic treats as built-in server-side tools. These
 * have no `input_schema` and are not representable as pi-ai function tools, so
 * anthropic-to-context.ts splits them out and pi-ai-executor.ts re-injects
 * them verbatim into the outgoing payload.
 */
export const ANTHROPIC_BUILTIN_TOOL_TYPES = new Set([
  'web_search_20250305',
  'web_search_20260209', // adds dynamic filtering (runs via code execution)
  'web_search_20260318', // adds response_inclusion
  'web_fetch_20250910',
  'web_fetch_20260209', // adds dynamic filtering (runs via code execution)
  'web_fetch_20260309', // adds use_cache
  'web_fetch_20260318', // adds response_inclusion
]);

/**
 * Response content-block `type` values emitted by those built-in tools. pi-ai's
 * Anthropic parser drops these, so fetch-tap.ts reconstructs them from the raw
 * upstream bytes. `server_tool_use` is shared by both web_search and web_fetch
 * calls; each tool has its own result block type.
 */
export const ANTHROPIC_SERVER_TOOL_BLOCK_TYPES = new Set([
  'server_tool_use',
  'web_search_tool_result',
  'web_fetch_tool_result',
]);

/** True when `t` is an Anthropic built-in server-side tool declaration. */
export function isAnthropicBuiltinTool(t: any): boolean {
  return !!t && typeof t === 'object' && ANTHROPIC_BUILTIN_TOOL_TYPES.has(t.type);
}
