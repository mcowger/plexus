import type { CacheRoutingHeaders } from '../types/unified';

type Headers = Record<string, string | string[] | undefined>;

export function getHeaderValue(headers: Headers, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export function getCacheRoutingHeaders(
  headers: Headers,
  promptCacheKey?: string
): CacheRoutingHeaders | undefined {
  const cacheRoutingHeaders: CacheRoutingHeaders = {
    session_id:
      getHeaderValue(headers, 'session_id') ||
      getHeaderValue(headers, 'session-id') ||
      promptCacheKey,
    'x-client-request-id': getHeaderValue(headers, 'x-client-request-id') || promptCacheKey,
    'x-session-affinity': getHeaderValue(headers, 'x-session-affinity'),
    'x-session-id': getHeaderValue(headers, 'x-session-id'),
    'x-prompt-cache-isolation-key': getHeaderValue(headers, 'x-prompt-cache-isolation-key'),
    'x-multi-turn-session-id': getHeaderValue(headers, 'x-multi-turn-session-id'),
  };

  return Object.values(cacheRoutingHeaders).some(Boolean) ? cacheRoutingHeaders : undefined;
}
