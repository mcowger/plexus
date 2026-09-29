import { createHash } from 'node:crypto';
import {
  getDefaultCacheKeyInjection,
  isBodyCacheKeyInjectionField,
  type ProviderCacheKeyInjection,
} from '@plexus/shared';
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
 * Header values must be undici-safe: printable ASCII only, bounded length.
 * `fetch` throws on CR/LF, non-ASCII, or oversized header values, so a client
 * body key that fails this is hashed to a stable hex form instead of being
 * forwarded raw (which would fail the whole dispatch).
 */
const HEADER_SAFE_VALUE = /^[\x21-\x7E]{1,256}$/;

function toHeaderSafeValue(value: string): string {
  return HEADER_SAFE_VALUE.test(value) ? value : createHash('sha256').update(value).digest('hex');
}

/**
 * Resolve the effective cache/session key injection destination for a route.
 *
 * - Explicit `off` disables injection.
 * - Any other explicit value wins.
 * - Unset falls back to `getDefaultCacheKeyInjection` (Meta OAuth →
 *   `prompt_cache_key`); otherwise the client request is left untouched.
 */
export function resolveCacheKeyInjection(
  config: ProviderConfig | undefined
): ProviderCacheKeyInjection | undefined {
  const explicit = config?.cache_key_injection;
  if (explicit === 'off') return undefined;
  if (explicit) return explicit;
  return getDefaultCacheKeyInjection(config?.oauth_provider);
}

/**
 * Derive the key Plexus injects.
 *
 * 1. The client's own session affinity identity (inbound session headers, then
 *    body `prompt_cache_key`) — their explicit intent.
 * 2. Plexus's own conversation key: a hash of the first two messages, which is
 *    client-independent and stable across turns of the same conversation while
 *    keeping unrelated conversations in distinct affinity buckets. The
 *    `previousResponseId` chain branch is deliberately excluded — it changes
 *    every turn and is not a stable cache key.
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
  // `previousResponseId` changes every turn, so strip it and key off the stable
  // first-messages anchor instead.
  return (
    StickySessionManager.computeSessionKey({ ...request, previousResponseId: undefined }) ??
    undefined
  );
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
  return { ...headers, [wireName]: toHeaderSafeValue(value) };
}
