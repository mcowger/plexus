import type { UnifiedChatRequest } from '../../types/unified';
import { getApiBaseType } from '../../utils/api-format';
import type { RouteResult } from '../routing/router';

export function setupProviderHeaders(
  route: RouteResult,
  apiType: string,
  request: UnifiedChatRequest
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Set Accept header based on streaming
  if (request.stream) {
    headers['Accept'] = 'text/event-stream';
  } else {
    headers['Accept'] = 'application/json';
  }

  // Use static API key
  if (route.config.api_key) {
    const type = getApiBaseType(apiType);
    if (type === 'messages') {
      headers['x-api-key'] = route.config.api_key;
      headers['anthropic-version'] = '2023-06-01';
    } else if (type === 'gemini') {
      headers['x-goog-api-key'] = route.config.api_key;
    } else {
      // Default to Bearer for Chat (OpenAI) and others
      headers['Authorization'] = `Bearer ${route.config.api_key}`;
    }
  } else {
    throw new Error(`No API key configured for provider '${route.provider}'`);
  }

  if (route.config.headers) {
    Object.assign(headers, route.config.headers);
  }

  // Forward cache routing headers for Responses API prompt caching.
  // These headers enable server-side cache routing at the upstream provider
  // (e.g. theclawbay, OpenAI). Without them, each request may land on a
  // different backend server, causing cache misses.
  if (request.cacheRoutingHeaders) {
    if (request.cacheRoutingHeaders.session_id) {
      // OpenAI's Codex backend deprecated the underscored header in favor of
      // the hyphenated form (more proxy-compatible); the old name is now
      // silently ignored upstream, so send the current one.
      headers['session-id'] = request.cacheRoutingHeaders.session_id;
    }
    if (request.cacheRoutingHeaders['x-client-request-id']) {
      headers['x-client-request-id'] = request.cacheRoutingHeaders['x-client-request-id'];
    }
  }

  if (apiType.toLowerCase() === 'responses:lite') {
    headers['x-openai-internal-codex-responses-lite'] = 'true';
  }

  return headers;
}
