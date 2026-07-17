import type { ProviderAdapter } from '../../types/provider-adapter';

/**
 * strip_unsupported_tool_search adapter
 *
 * Strips Anthropic advanced-tool-use `tool_search_tool_*` shorthand entries
 * from `payload.tools` so that wire protocols that don't understand them
 * don't reject the request.
 *
 * Why this exists:
 *
 * When the incoming API type and the target API type match (e.g. a client
 * sends an Anthropic /v1/messages body and the chosen target's wire API is
 * also Anthropic /v1/messages), the dispatcher takes a pass-through shortcut
 * that forwards the original request body untouched (`shouldUsePassThrough`).
 * This is the correct behaviour for upstream providers that speak real
 * Anthropic (Anthropic direct, Vertex, Bedrock-native), but OpenRouter's
 * /v1/messages compatibility layer only recognises a small subset of
 * Anthropic server-tool shorthands — `web_search_20250305` and a couple of
 * others — and rejects the newer advanced-tool-use shorthands
 * (`tool_search_tool_bm25_20251119`, `tool_search_tool_regex_20251119`)
 * with HTTP 400 "Unknown server-tool shorthand".
 *
 * This adapter is auto-injected by `adapter-resolver.ts` for any route whose
 * `pi_ai_provider === 'openrouter'`, so it fires on both pass-through and
 * transformer-driven dispatch paths without any user-visible config.
 *
 * Outbound (preDispatch):
 *   - Drops any tool entry whose `type` starts with `tool_search_tool_`
 *     (case-insensitive). All other tools — including ordinary function
 *     tools and other server-side tools — are left untouched.
 *   - If nothing is dropped, the payload reference is returned unchanged so
 *     callers can cheaply detect "no work done".
 *   - If everything in `tools` is dropped, the empty array is still emitted
 *     so the request body shape is preserved (the upstream provider simply
 *     sees no tools).
 *
 * Inbound (postDispatch) and stream hooks: no-op — the response shape is
 * not affected by which tools were declared.
 */
export const stripUnsupportedToolSearchAdapter: ProviderAdapter = {
  name: 'strip_unsupported_tool_search',

  preDispatch(payload: Record<string, any>): Record<string, any> {
    if (!Array.isArray(payload.tools) || payload.tools.length === 0) return payload;

    const filtered = payload.tools.filter((tool: any) => !isToolSearchShorthand(tool));
    if (filtered.length === payload.tools.length) return payload;

    return { ...payload, tools: filtered };
  },

  postDispatch(response: Record<string, any>): Record<string, any> {
    return response;
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns true when a tool entry is an Anthropic tool-search shorthand that
 * only the real Anthropic / Vertex / Bedrock wire protocols understand.
 *
 * Anthropic advanced-tool-use server tools are declared with a `type` field
 * like `tool_search_tool_bm25_20251119` or `tool_search_tool_regex_20251119`
 * and carry a `name` matching the user-facing tool name. The `tool_search_tool_`
 * prefix is the discriminator; matching it covers the current bm25/regex
 * variants and any future `tool_search_tool_*` shorthand Anthropic ships
 * under the same advanced-tool-use umbrella.
 */
export function isToolSearchShorthand(tool: any): boolean {
  if (!tool || typeof tool !== 'object') return false;
  const type = tool.type;
  if (typeof type !== 'string') return false;
  return type.toLowerCase().startsWith('tool_search_tool_');
}
