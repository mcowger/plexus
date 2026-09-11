import type { FastifyReply, FastifyRequest } from 'fastify';
import type { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { getClientIp } from '../../../utils/ip';
import { McpUsageStorageService } from '../../../services/mcp-proxy/mcp-usage-storage';

export type PlexusMcpRequestContext = {
  startTime: number;
  requestId: string;
  sourceIp: string | null;
  method: 'POST' | 'GET' | 'DELETE';
  jsonrpcMethod: string | null;
  toolName: string | null;
};

export function createPlexusMcpRequestContext(request: FastifyRequest): PlexusMcpRequestContext {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();
  const sourceIp = getClientIp(request);
  const method = request.method as 'POST' | 'GET' | 'DELETE';
  const requestBody =
    request.body && typeof request.body === 'object'
      ? (request.body as Record<string, unknown>)
      : undefined;
  const jsonrpcMethod = typeof requestBody?.method === 'string' ? requestBody.method : null;
  const toolName =
    jsonrpcMethod === 'tools/call' &&
    requestBody?.params &&
    typeof requestBody.params === 'object' &&
    typeof (requestBody.params as Record<string, unknown>).name === 'string'
      ? ((requestBody.params as Record<string, unknown>).name as string)
      : null;

  return { startTime, requestId, sourceIp, method, jsonrpcMethod, toolName };
}

export async function handlePlexusMcpHttpRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  mcpUsageStorage: McpUsageStorageService,
  transport: WebStandardStreamableHTTPServerTransport,
  requestContext: PlexusMcpRequestContext
) {
  const webRequest = toWebRequest(request);
  const webResponse = await transport.handleRequest(webRequest, { parsedBody: request.body });

  for (const [key, value] of webResponse.headers.entries()) {
    reply.header(key, value);
  }

  const body = await webResponse.text();
  await mcpUsageStorage.saveRequest({
    request_id: requestContext.requestId,
    created_at: new Date().toISOString(),
    start_time: requestContext.startTime,
    duration_ms: Date.now() - requestContext.startTime,
    server_name: 'plexus',
    upstream_url: '/mcp/plexus',
    method: requestContext.method,
    jsonrpc_method: requestContext.jsonrpcMethod,
    tool_name: requestContext.toolName,
    api_key: 'admin',
    attribution: null,
    source_ip: requestContext.sourceIp,
    response_status: webResponse.status,
    is_streamed: false,
    has_debug: false,
    error_code: webResponse.status >= 400 ? 'MCP_ERROR' : null,
    error_message: webResponse.status >= 400 ? body || 'MCP request failed' : null,
  });
  return reply.code(webResponse.status).send(body || undefined);
}

export function toWebRequest(request: FastifyRequest) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      headers.set(key, value.join(', '));
    } else if (value !== undefined) {
      headers.set(key, String(value));
    }
  }

  const rawProtoHeader = request.headers['x-forwarded-proto'];
  const rawProto = Array.isArray(rawProtoHeader) ? rawProtoHeader[0] : rawProtoHeader;
  const protocol = rawProto === 'https' ? 'https' : 'http';
  const host = request.headers.host ?? 'localhost';
  const url = `${protocol}://${host}${request.url}`;

  return new Request(url, {
    method: request.method,
    headers,
    body:
      request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : JSON.stringify(request.body ?? null),
  });
}
