import { getConfig } from '../../config';
import { logger } from '../../utils/logger';
import { McpServerConfig } from '../../types/mcp';
import { getClientIp } from '../../utils/ip';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
]);

const CLIENT_AUTH_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'proxy-authorization',
]);

export function getMcpServerConfig(serverName: string): McpServerConfig | null {
  const config = getConfig();
  const mcpServers = config.mcpServers;
  
  if (!mcpServers) {
    return null;
  }

  const server = mcpServers[serverName];
  
  if (!server) {
    return null;
  }

  if (server.enabled === false) {
    return null;
  }

  return server;
}

export function validateServerName(name: string): boolean {
  const slugRegex = /^[a-z0-9][a-z0-9-_]{1,62}$/;
  return slugRegex.test(name);
}

export function filterHopByHopHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const filtered: Record<string, string> = {};
  
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    
    if (HOP_BY_HOP_HEADERS.has(lowerKey)) {
      continue;
    }
    
    if (value !== undefined && value !== null) {
      if (Array.isArray(value)) {
        if (value.length > 0 && value[0] !== undefined) {
          filtered[key] = value[0] as string;
        }
      } else {
        filtered[key] = value;
      }
    }
  }
  
  return filtered;
}

export function mergeUpstreamHeaders(
  clientHeaders: Record<string, string>,
  staticHeaders?: Record<string, string>
): Record<string, string> {
  const merged: Record<string, string> = { ...clientHeaders };
  
  if (staticHeaders) {
    for (const [key, value] of Object.entries(staticHeaders)) {
      merged[key] = value;
    }
  }
  
  return merged;
}

export function redactSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_HEADERS.has(lowerKey)) {
      redacted[key] = '[REDACTED]';
    } else {
      redacted[key] = value;
    }
  }
  
  return redacted;
}

export function filterClientAuthHeaders(headers: Record<string, string>): Record<string, string> {
  const filtered: Record<string, string> = {};
  
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (!CLIENT_AUTH_HEADERS.has(lowerKey)) {
      filtered[key] = value;
    } else {
      logger.silly(`[mcp-proxy] Filtering out client auth header: ${key}`);
    }
  }
  
  return filtered;
}

export function extractJsonRpcMethod(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  
  const rpcBody = body as Record<string, unknown>;
  
  if (typeof rpcBody.method === 'string') {
    return rpcBody.method;
  }
  
  return null;
}

/**
 * Extracts the tool name from a JSON-RPC request body.
 * For `tools/call` requests, the tool name is in `params.name`.
 * Returns null for all other methods.
 */
export function extractToolName(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const rpcBody = body as Record<string, unknown>;

  if (rpcBody.method !== 'tools/call') {
    return null;
  }

  const params = rpcBody.params;
  if (!params || typeof params !== 'object') {
    return null;
  }

  const name = (params as Record<string, unknown>).name;
  return typeof name === 'string' ? name : null;
}

export async function proxyMcpRequest(
  serverName: string,
  method: 'POST' | 'GET' | 'DELETE',
  clientHeaders: Record<string, string | string[] | undefined>,
  body?: unknown,
  query?: Record<string, string>
): Promise<{
  status: number;
  headers: Record<string, string>;
  body?: unknown;
  stream?: ReadableStream<Uint8Array>;
  error?: string;
}> {
  const serverConfig = getMcpServerConfig(serverName);
  
  if (!serverConfig) {
    return {
      status: 404,
      headers: {},
      error: `MCP server '${serverName}' not found or disabled`,
    };
  }

  const upstreamUrl = serverConfig.upstream_url;
  const staticHeaders = serverConfig.headers || {};
  
  logger.silly(`[mcp-proxy] Server config: ${JSON.stringify({ upstreamUrl, staticHeaders })}`);
  
  const filteredClientHeaders = filterHopByHopHeaders(clientHeaders);
  
  delete filteredClientHeaders['host'];
  
  // Filter out client auth headers - we don't forward Plexus client credentials to upstream
  // Upstream auth should come from static headers or URL query params only
  const clientAuthFiltered = filterClientAuthHeaders(filteredClientHeaders);
  
  const upstreamHeaders = mergeUpstreamHeaders(clientAuthFiltered, staticHeaders);
  
  logger.silly(`[mcp-proxy] Upstream headers: ${JSON.stringify(upstreamHeaders)}`);
  
  let url = upstreamUrl;
  
  if (query && Object.keys(query).length > 0) {
    const params = new URLSearchParams(query);
    const separator = upstreamUrl.endsWith('?') ? '' : (upstreamUrl.includes('?') ? '&' : '?');
    url = `${upstreamUrl}${separator}${params.toString()}`;
  }

  logger.silly(`[mcp-proxy] Final URL: ${url}`);

  try {
    const fetchOptions: RequestInit = {
      method,
      headers: upstreamHeaders,
    };

    let requestBody = '';
    if (method === 'POST' && body) {
      requestBody = typeof body === 'string' ? body : JSON.stringify(body);
      fetchOptions.body = requestBody;
      if (!upstreamHeaders['content-type']) {
        fetchOptions.headers = {
          ...fetchOptions.headers,
          'content-type': 'application/json',
        };
      }
    }

    logger.silly(`[mcp-proxy] Request body: ${requestBody}`);

    logger.silly(`[mcp-proxy] Starting fetch to ${url} with method ${method}`);
    const response = await fetch(url, fetchOptions);
    logger.silly(`[mcp-proxy] Fetch completed, status: ${response.status}`);

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
        responseHeaders[key] = value;
      }
    });

    logger.silly(`[mcp-proxy] Response headers: ${JSON.stringify(responseHeaders)}`);

    const contentType = response.headers.get('content-type');
    logger.silly(`[mcp-proxy] Content-Type: ${contentType}`);

    if (contentType?.includes('text/event-stream') || method === 'GET') {
      logger.silly(`[mcp-proxy] Streaming response detected`);
      if (response.body) {
        return {
          status: response.status,
          headers: responseHeaders,
          stream: response.body,
        };
      }
    }

    const responseText = await response.text();
    
    logger.silly(`[mcp-proxy] Response body (raw): ${responseText.substring(0, 500)}`);
    
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(responseText);
      logger.silly(`[mcp-proxy] Response body (parsed): ${JSON.stringify(parsedBody).substring(0, 500)}`);
    } catch {
      parsedBody = responseText;
      logger.silly(`[mcp-proxy] Response body (text): ${responseText.substring(0, 500)}`);
    }

    logger.silly(`[mcp-proxy] Returning status: ${response.status}`);

    return {
      status: response.status,
      headers: responseHeaders,
      body: parsedBody,
    };
  } catch (error) {
    const err = error as Error;
    logger.error(`[mcp-proxy] Error proxying request to ${serverName}:`, err);
    logger.error(`[mcp-proxy] Error name: ${err.name}`);
    logger.error(`[mcp-proxy] Error message: ${err.message}`);
    logger.error(`[mcp-proxy] Error stack: ${err.stack}`);
    
    if (err.message.includes('ECONNREFUSED') || err.message.includes('connect')) {
      logger.silly(`[mcp-proxy] Connection refused - upstream server not reachable`);
      return {
        status: 502,
        headers: {},
        error: 'Upstream server unreachable',
      };
    }
    
    if (err.message.includes('timeout') || err.message.includes('ETIMEDOUT')) {
      logger.silly(`[mcp-proxy] Request timed out`);
      return {
        status: 504,
        headers: {},
        error: 'Upstream server timeout',
      };
    }
    
    if (err.cause) {
      logger.silly(`[mcp-proxy] Error cause: ${JSON.stringify(err.cause)}`);
    }
    
    return {
      status: 500,
      headers: {},
      error: err.message || 'Unknown error',
    };
  }
}
