import { getConfig } from '../../config';
import { getDatabase, getSchema } from '../../db/client';
import { and, asc, eq } from 'drizzle-orm';
import { decryptField } from '../../utils/encryption';
import { logger } from '../../utils/logger';
import { McpServerConfig } from '../../types/mcp';
import { getClientIp } from '../../utils/ip';
import { mcpProcessManager } from '../mcp-local/mcp-process-manager';

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

const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key']);

const CLIENT_AUTH_HEADERS = new Set(['authorization', 'x-api-key', 'proxy-authorization']);

const RESERVED_SERVER_NAMES = new Set(['plexus']);

const lastMcpKeyIds = new Map<number, number>();

interface McpKey {
  id: number;
  key: string;
}

interface McpServerKeyConfig {
  id: number;
  authScheme: string | null;
  rateLimitCooldownMs: number;
  quotaCooldownMs: number;
}

export function selectMcpKeyRoundRobin(serverId: number, keys: McpKey[]): McpKey | undefined {
  if (keys.length === 0) return undefined;

  const lastKeyId = lastMcpKeyIds.get(serverId);
  const lastIndex = keys.findIndex((key) => key.id === lastKeyId);
  const key = keys[(lastIndex + 1) % keys.length]!;
  lastMcpKeyIds.set(serverId, key.id);
  return key;
}

export function injectMcpKeyAuth(
  headers: Record<string, string>,
  authScheme: string | null,
  key: string | undefined
): Record<string, string> {
  if (!authScheme || !key) return headers;

  const normalizedScheme = authScheme.toLowerCase();
  const headerName = normalizedScheme === 'bearer' ? 'authorization' : normalizedScheme;
  const withoutExistingAuth = Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.toLowerCase() !== headerName)
  );
  return {
    ...withoutExistingAuth,
    [normalizedScheme === 'bearer' ? 'Authorization' : authScheme]:
      normalizedScheme === 'bearer' ? `Bearer ${key}` : key,
  };
}

async function getActiveMcpKeys(serverName: string): Promise<{
  server: McpServerKeyConfig;
  keys: McpKey[];
} | null> {
  const db = getDatabase();
  const schema = getSchema();
  const servers = await db
    .select({
      id: schema.mcpServers.id,
      authScheme: schema.mcpServers.authScheme,
      rateLimitCooldownMs: schema.mcpServers.rateLimitCooldownMs,
      quotaCooldownMs: schema.mcpServers.quotaCooldownMs,
    })
    .from(schema.mcpServers)
    .where(eq(schema.mcpServers.name, serverName))
    .limit(1);
  const server = servers[0];
  if (!server) return null;

  const keys: Array<McpKey & { cooldownUntil: Date | number | null }> = await db
    .select({
      id: schema.mcpKeys.id,
      key: schema.mcpKeys.key,
      cooldownUntil: schema.mcpKeys.cooldownUntil,
    })
    .from(schema.mcpKeys)
    .where(and(eq(schema.mcpKeys.mcpServerId, server.id), eq(schema.mcpKeys.isActive, true)))
    .orderBy(asc(schema.mcpKeys.id));
  const now = Date.now();

  return {
    server,
    keys: keys
      .filter((key) => !key.cooldownUntil || new Date(key.cooldownUntil).getTime() <= now)
      .map(({ id, key }) => ({ id, key: decryptField(key) as string })),
  };
}

async function cooldownMcpKey(keyId: number, cooldownMs: number): Promise<void> {
  const db = getDatabase();
  const schema = getSchema();
  const now = new Date();
  await db
    .update(schema.mcpKeys)
    .set({ cooldownUntil: new Date(now.getTime() + cooldownMs), updatedAt: now })
    .where(eq(schema.mcpKeys.id, keyId));
}

export function getMcpServerConfig(serverName: string): McpServerConfig | null {
  if (RESERVED_SERVER_NAMES.has(serverName)) {
    return null;
  }

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
  return slugRegex.test(name) && !RESERVED_SERVER_NAMES.has(name);
}

export function getEffectiveUpstreamUrl(serverConfig: McpServerConfig): string {
  if (serverConfig.mode === 'local_http') {
    return mcpProcessManager.getLocalUrl(serverConfig) || '';
  }
  return serverConfig.upstream_url;
}

export function filterHopByHopHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, string> {
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
      logger.silly(`Filtering out client auth header: ${key}`);
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

  if (serverConfig.mode === 'local_http') {
    try {
      await mcpProcessManager.ensureRunning(serverName, serverConfig);
    } catch (error) {
      logger.error(`[mcp-proxy:${serverName}] local MCP server failed to start`, error);
      return {
        status: 502,
        headers: {},
        error: (error as Error).message || 'Local MCP server failed to start',
      };
    }
  }

  const upstreamUrl = getEffectiveUpstreamUrl(serverConfig);
  const staticHeaders = serverConfig.headers || {};
  logger.info('[mcp-proxy:' + serverName + '] proxying ' + method + ' request to ' + upstreamUrl);

  logger.silly(`Server config: ${JSON.stringify({ upstreamUrl, staticHeaders })}`);

  const filteredClientHeaders = filterHopByHopHeaders(clientHeaders);

  delete filteredClientHeaders['host'];

  // Filter out client auth headers - we don't forward Plexus client credentials to upstream
  // Upstream auth should come from static headers or URL query params only
  const clientAuthFiltered = filterClientAuthHeaders(filteredClientHeaders);

  const upstreamHeaders = mergeUpstreamHeaders(clientAuthFiltered, staticHeaders);

  let url = upstreamUrl;

  if (query && Object.keys(query).length > 0) {
    const params = new URLSearchParams(query);
    const separator = upstreamUrl.endsWith('?') ? '' : upstreamUrl.includes('?') ? '&' : '?';
    url = `${upstreamUrl}${separator}${params.toString()}`;
  }

  logger.silly(`Final URL: ${url}`);

  try {
    let requestBody = '';
    if (method === 'POST' && body) {
      requestBody = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const isRemote = !serverConfig.mode || serverConfig.mode === 'remote_http';
    const keyConfig = isRemote ? await getActiveMcpKeys(serverName) : null;
    const keys = keyConfig?.keys ?? [];
    const attempts = Math.max(keys.length, 1);
    let response: Response | undefined;

    for (let attempt = 0; attempt < attempts; attempt++) {
      const key = selectMcpKeyRoundRobin(keyConfig?.server.id ?? 0, keys);
      let requestHeaders = injectMcpKeyAuth(
        upstreamHeaders,
        keyConfig?.server.authScheme ?? null,
        key?.key
      );

      const hasContentType = Object.keys(requestHeaders).some(
        (k) => k.toLowerCase() === 'content-type'
      );
      if (requestBody && !hasContentType) {
        requestHeaders = { ...requestHeaders, 'content-type': 'application/json' };
      }

      const redactedHeaders = redactSensitiveHeaders(requestHeaders);
      if (keyConfig?.server.authScheme && key) {
        const headerToRedact =
          keyConfig.server.authScheme.toLowerCase() === 'bearer'
            ? 'Authorization'
            : keyConfig.server.authScheme;
        redactedHeaders[headerToRedact] = '[REDACTED]';
      }
      logger.silly(`Upstream headers: ${JSON.stringify(redactedHeaders)}`);
      logger.silly(`Request body: ${requestBody}`);
      logger.silly(`Starting fetch to ${url} with method ${method}`);
      response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: requestBody || undefined,
      });

      if ((response.status !== 429 && response.status !== 402) || !key || !keyConfig) break;

      const cooldownMs =
        response.status === 429
          ? keyConfig.server.rateLimitCooldownMs
          : keyConfig.server.quotaCooldownMs;
      await cooldownMcpKey(key.id, cooldownMs);
      if (attempt === attempts - 1) break;
      await response.body?.cancel();
    }

    if (!response) throw new Error('MCP upstream request was not attempted');
    logger.info(
      '[mcp-proxy:' + serverName + '] upstream fetch completed with status ' + response.status
    );

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
        responseHeaders[key] = value;
      }
    });

    logger.silly(`Response headers: ${JSON.stringify(responseHeaders)}`);

    const contentType = response.headers.get('content-type');
    logger.silly(`Content-Type: ${contentType}`);

    if (contentType?.includes('text/event-stream') || (method === 'GET' && response.ok)) {
      logger.info('[mcp-proxy:' + serverName + '] upstream streaming response detected');
      if (response.body) {
        return {
          status: response.status,
          headers: responseHeaders,
          stream: response.body,
        };
      }
    }

    const responseText = await response.text();

    logger.silly(`Response body (raw): ${responseText.substring(0, 500)}`);

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(responseText);
      logger.silly(`Response body (parsed): ${JSON.stringify(parsedBody).substring(0, 500)}`);
    } catch {
      parsedBody = responseText;
      logger.silly(`Response body (text): ${responseText.substring(0, 500)}`);
    }

    logger.info(
      '[mcp-proxy:' +
        serverName +
        '] returning buffered upstream response with status ' +
        response.status
    );

    return {
      status: response.status,
      headers: responseHeaders,
      body: parsedBody,
    };
  } catch (error) {
    const err = error as Error;
    logger.error(`Error proxying request to ${serverName}:`, err);
    logger.error(`Error name: ${err.name}`);
    logger.error(`Error message: ${err.message}`);
    logger.error(`Error stack: ${err.stack}`);

    if (err.message.includes('ECONNREFUSED') || err.message.includes('connect')) {
      logger.silly(`Connection refused - upstream server not reachable`);
      return {
        status: 502,
        headers: {},
        error: 'Upstream server unreachable',
      };
    }

    if (err.message.includes('timeout') || err.message.includes('ETIMEDOUT')) {
      logger.silly(`Request timed out`);
      return {
        status: 504,
        headers: {},
        error: 'Upstream server timeout',
      };
    }

    if (err.cause) {
      logger.silly(`Error cause: ${JSON.stringify(err.cause)}`);
    }

    return {
      status: 500,
      headers: {},
      error: err.message || 'Unknown error',
    };
  }
}
