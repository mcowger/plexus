import { isBodyCacheKeyInjectionField, type ProviderCacheKeyInjection } from '@plexus/shared';
import type { ProviderConfig } from '../../config';
import type { UnifiedChatRequest } from '../../types/unified';
import { getApiBaseType } from '../../utils/api-format';
import type { RouteResult } from '../routing/router';
import { StickySessionManager } from '../routing/sticky-session-manager';

/**
 * Body fields only exist on OpenAI-style wire bodies. Adding `prompt_cache_key`
 * to a Messages or Gemini body would be rejected as an unknown field (400), so
 * body injection is restricted to these target API types.
 */
const BODY_INJECTION_API_TYPES = new Set(['chat', 'responses']);

/**
 * Resolve the effective cache/session key injection destination for a route.
 *
 * - Explicit `off` disables injection.
 * - Any other explicit value wins.
 * - Unset leaves the client request untouched, except Meta OAuth (`muse`)
 *   routes, which default to `prompt_cache_key` because Meta's Responses
 *   prompt caching is the whole point and clients may omit or vary the key.
 */
export function resolveCacheKeyInjection(
  config: ProviderConfig | undefined
): ProviderCacheKeyInjection | undefined {
  const explicit = config?.cache_key_injection;
  if (explicit === 'off') return undefined;
  if (explicit) return explicit;
  if (config?.oauth_provider === 'meta') return 'prompt_cache_key';
  return undefined;
}

/**
 * Derive the key Plexus injects.
 *
 * 1. The client's own session affinity identity (inbound session headers, then
 *    body `prompt_cache_key`) — their explicit intent.
 * 2. Plexus's own conversation key from `StickySessionManager.computeSessionKey`
 *    (`previousResponseId` chain, else a hash of the first two messages). This
 *    is client-independent and stable across turns, and keeps unrelated
 *    conversations in distinct affinity buckets.
 * 3. Nothing — when neither is available, inject nothing rather than bucket all
 *    callers under one shared key.
 */
export function deriveCacheInjectionKey(request: UnifiedChatRequest): string | undefined {
  const routing = request.cacheRoutingHeaders;
  const session =
    routing?.session_id ??
    routing?.['x-session-affinity'] ??
    routing?.['x-session-id'] ??
    routing?.['x-client-request-id'] ??
    routing?.['x-multi-turn-session-id'] ??
    request.prompt_cache_key;
  if (session) return session;
  return StickySessionManager.computeSessionKey(request) ?? undefined;
}

/** Set the injected key on the wire body when the destination is a body field. */
export function applyBodyCacheKeyInjection(
  payload: any,
  route: RouteResult,
  request: UnifiedChatRequest,
  targetApiType: string
): any {
  const field = resolveCacheKeyInjection(route.config);
  if (!field || !isBodyCacheKeyInjectionField(field)) return payload;
  if (!BODY_INJECTION_API_TYPES.has(getApiBaseType(targetApiType))) return payload;
  const value = deriveCacheInjectionKey(request);
  if (!value) return payload;
  return { ...payload, [field]: value };
}

/**
 * Set the injected key on the upstream headers when the destination is a header.
 * Injects only when the header is not already present, case-insensitively, so a
 * client's explicit affinity/isolation value or an admin static header is never
 * silently replaced or duplicated.
 */
export function applyHeaderCacheKeyInjection(
  headers: Record<string, string>,
  route: RouteResult,
  request: UnifiedChatRequest
): Record<string, string> {
  const field = resolveCacheKeyInjection(route.config);
  if (!field || isBodyCacheKeyInjectionField(field)) return headers;
  // OpenAI/Codex deprecated the underscored name; they only honor `session-id`.
  const wireName = field === 'session_id' ? 'session-id' : field;
  const alreadySet = Object.keys(headers).some(
    (key) => key.toLowerCase() === wireName.toLowerCase()
  );
  if (alreadySet) return headers;
  const value = deriveCacheInjectionKey(request);
  if (!value) return headers;
  return { ...headers, [wireName]: value };
}
