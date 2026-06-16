import type { ProviderAdapter } from '../../types/provider-adapter';
import type { WebSearchCoercionOptions } from '../../config';
import { logger } from '../../utils/logger';

/**
 * web_search_coercion adapter
 *
 * Different providers expose server-side web search as differently-named tool
 * entries in the `tools` array.  This adapter normalises any inbound web-search
 * tool entry to the format expected by the target provider.
 *
 * Known formats:
 *   - Anthropic  : { type: "web_search_20250305", name: "web_search", max_uses?: number }
 *   - OpenAI     : { type: "web_search" }
 *   - OpenRouter : { type: "openrouter:web_search" }
 *   - Google     : { type: "googleSearch", googleSearch: {} }
 *                  (used after the Gemini transformer converts unified → provider payload)
 *
 * Options schema (WebSearchCoercionOptions):
 *   target: "anthropic" | "openai" | "openrouter" | "google"
 *   max_uses?: number   (Anthropic only — ignored for other targets)
 *
 * Outbound (preDispatch):
 *   - Any tool entry that matches one of the three known web-search type strings
 *     is replaced with the target provider's canonical form.
 *   - Non-web-search tools are left untouched.
 *   - If no web-search tool is found, the payload is returned unchanged.
 *
 * Inbound (postDispatch): no-op — response shapes are not affected.
 *
 * Stream: no-op — tool definitions appear only in requests.
 */
export const webSearchCoercionAdapter: ProviderAdapter = {
  name: 'web_search_coercion',

  preDispatch(payload: Record<string, any>, options?: Record<string, any>): Record<string, any> {
    if (!options?.target) return payload;
    if (!Array.isArray(payload.tools) || payload.tools.length === 0) return payload;

    const target = options.target as WebSearchCoercionOptions['target'];
    const maxUses = options.max_uses as number | undefined;

    let didRewrite = false;
    const tools = payload.tools.map((tool: any) => {
      if (!isWebSearchTool(tool)) return tool;

      didRewrite = true;
      return buildTargetTool(target, maxUses);
    });

    if (!didRewrite) return payload;

    logger.debug(`web_search_coercion: rewrote web search tool(s) → target '${target}'`);

    return { ...payload, tools };
  },

  postDispatch(response: Record<string, any>, _options?: Record<string, any>): Record<string, any> {
    return response;
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────

/** The known type strings that identify a server-side web-search tool. */
const WEB_SEARCH_TYPES = new Set([
  'web_search_20250305', // Anthropic
  'web_search', // OpenAI
  'openrouter:web_search', // OpenRouter
  'googleSearch', // Google Gemini (post-transform unified form)
]);

/**
 * Returns true when a tool entry represents a server-side web search tool
 * from any of the three known providers.
 */
export function isWebSearchTool(tool: any): boolean {
  if (!tool || typeof tool !== 'object') return false;
  return WEB_SEARCH_TYPES.has(tool.type);
}

/**
 * Build the canonical web search tool entry for the given target provider.
 */
export function buildTargetTool(
  target: WebSearchCoercionOptions['target'],
  maxUses?: number
): Record<string, any> {
  switch (target) {
    case 'anthropic':
      return {
        type: 'web_search_20250305',
        name: 'web_search',
        ...(maxUses !== undefined ? { max_uses: maxUses } : {}),
      };
    case 'openai':
      return { type: 'web_search' };
    case 'openrouter':
      return { type: 'openrouter:web_search' };
    case 'google':
      // The Gemini transformer converts unified googleSearch → { googleSearch: {} } in the
      // provider payload. The adapter operates post-transform, so we emit the already-transformed
      // Gemini REST shape directly.
      return { googleSearch: {} };
  }
}
