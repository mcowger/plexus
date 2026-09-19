import type { ProviderAdapter } from '../../types/provider-adapter';
import type { RouteResult } from '../../services/routing/router';
import { logger } from '../../utils/logger';

/**
 * muse_code_compat adapter
 *
 * Coerces request bodies to what Meta's Model API (`api.meta.ai/v1`)
 * accepts, verified against the endpoint (see oh-my-pi's muse-code provider
 * notes):
 *
 * - `tool_choice` is dropped unconditionally. Meta accepts only `"auto"`
 *   and 400s on `"none"`, `"required"`, and named choices — and `"auto"`
 *   is the default when the field is absent, so omitting it is
 *   semantics-preserving in the only case Meta would have honored.
 * - `custom` tool declarations are stripped. Meta 400s with "`custom`
 *   tools are not supported on this endpoint". Dropping degrades one tool
 *   instead of failing the whole request (same trade-off as
 *   `strip_unsupported_tool_search`); dropped names are warned so the
 *   loss is visible in logs. If everything is dropped, the empty array is
 *   still emitted so the body shape is preserved.
 *
 * Outbound (preDispatch) only — the response shape is unaffected.
 * Auto-injected by `adapter-resolver.ts` for Muse subscription routes and
 * any provider pointed at Meta's API host; a
 * `{ name: 'muse_code_compat', enabled: false }` entry opts out, and an
 * explicit enabled entry force-enables it elsewhere.
 */
export const museCodeCompatAdapter: ProviderAdapter = {
  name: 'muse_code_compat',

  preDispatch(payload: Record<string, any>): Record<string, any> {
    let next = payload;

    if (Object.hasOwn(next, 'tool_choice')) {
      const { tool_choice: _dropped, ...rest } = next;
      next = rest;
    }

    if (Array.isArray(next.tools) && next.tools.length > 0) {
      const kept = next.tools.filter((tool: any) => !isCustomTool(tool));
      if (kept.length !== next.tools.length) {
        const dropped = next.tools
          .filter((tool: any) => isCustomTool(tool))
          .map((tool: any) => tool?.name ?? tool?.type ?? '?');
        logger.warn(
          `Muse Code compat: dropping unsupported custom tool(s) [${dropped.join(', ')}] — ` +
            `api.meta.ai rejects 'custom' tool declarations with HTTP 400.`
        );
        next = { ...next, tools: kept };
      }
    }

    return next;
  },

  postDispatch(response: Record<string, any>): Record<string, any> {
    return response;
  },
};

/**
 * True for Responses-API `custom` tool declarations (`{ type: 'custom', ... }`),
 * which Meta rejects. Matched case-insensitively; anything without a string
 * `type` is never a custom tool.
 */
export function isCustomTool(tool: any): boolean {
  if (!tool || typeof tool !== 'object') return false;
  return typeof tool.type === 'string' && tool.type.toLowerCase() === 'custom';
}

/**
 * Whether a dispatch targets Meta's Model API — judged on the provider slug
 * for `muse-code` subscription routes, or on the host for direct Meta API-key
 * providers (the 400s come from the endpoint, not the auth method).
 */
export function isMuseTarget(route: RouteResult): boolean {
  if ((route.config.oauth_provider || route.provider) === 'muse-code') return true;
  const urls =
    typeof route.config.api_base_url === 'string'
      ? [route.config.api_base_url]
      : Object.values(route.config.api_base_url ?? {});
  return urls.some(
    (url) => typeof url === 'string' && url.toLowerCase().includes('api.meta.ai')
  );
}
