import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bearerAuth from '@fastify/bearer-auth';
import formbody from '@fastify/formbody';
import { getConfig } from '../../config';
import {
  attachPlexusApiKeyAuth,
  createAuthHook,
  isRequestIpAllowed,
  validatePlexusApiKey,
} from '../../utils/auth';
import { logger } from '../../utils/logger';
import * as mcpProxyService from '../../services/mcp-proxy/mcp-proxy-service';
import { getClientIp } from '../../utils/ip';
import { McpUsageStorageService } from '../../services/mcp-proxy/mcp-usage-storage';
import { registerPlexusMcpRoutes } from './plexus';
import { getMcpAuthProvider, isMcpOAuthEnabled } from '../../services/mcp-oauth/provider-factory';
import { getMcpResourceUrl, getRequestBaseUrl } from '../../services/mcp-oauth/url';
import { MCP_OAUTH_ACCESS_TOKEN_PREFIX } from '../../services/mcp-oauth/plexus-idp-provider';

const DEFAULT_TIMEOUT_MS = 120000;

function authErrorResponse(message: string) {
  return { error: { message, type: 'auth_error', code: 401 } };
}

function getStringHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function extractBearerCredential(authorization: string): string {
  return authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice('bearer '.length)
    : authorization;
}

function setInitialOAuthChallenge(request: FastifyRequest, reply: FastifyReply) {
  const metadataUrl = `${getRequestBaseUrl(request)}/.well-known/oauth-protected-resource`;
  reply.header('WWW-Authenticate', `Bearer resource_metadata="${metadataUrl}"`);
}

function setInvalidTokenChallenge(reply: FastifyReply) {
  reply.header('WWW-Authenticate', 'Bearer error="invalid_token"');
}

async function mcpOAuthFallbackAuth(request: FastifyRequest, reply: FastifyReply) {
  const authorization = getStringHeader(request.headers.authorization);
  const xApiKey = getStringHeader(request.headers['x-api-key']);
  const xGoogApiKey = getStringHeader(request.headers['x-goog-api-key']);
  const queryKey =
    request.query && typeof request.query === 'object'
      ? typeof (request.query as any).key === 'string'
        ? (request.query as any).key
        : null
      : null;

  const tryRawApiKey = (secret: string): boolean => {
    const result = validatePlexusApiKey(secret, request);
    if (!result) return false;
    attachPlexusApiKeyAuth(request, result);
    return true;
  };

  if (authorization) {
    const credential = extractBearerCredential(authorization);
    if (tryRawApiKey(credential)) return;

    const provider = getMcpAuthProvider();
    const oauthResult = credential.startsWith(MCP_OAUTH_ACCESS_TOKEN_PREFIX)
      ? await provider?.validateToken(credential)
      : null;
    if (oauthResult) {
      const config = getConfig();
      const keyConfig = config.keys?.[oauthResult.keyName];
      if (keyConfig && isRequestIpAllowed(request, keyConfig.allowedIps, config.trustedProxies)) {
        attachPlexusApiKeyAuth(request, {
          keyName: oauthResult.keyName,
          keyConfig,
          attribution: null,
        });
        return;
      }
    }

    setInvalidTokenChallenge(reply);
    await reply.code(401).send(authErrorResponse('Invalid bearer token'));
    return reply;
  }

  const apiKeyStyleCredential = xApiKey ?? xGoogApiKey ?? queryKey;
  if (apiKeyStyleCredential) {
    if (tryRawApiKey(apiKeyStyleCredential)) return;
    await reply.code(401).send(authErrorResponse('Invalid API key'));
    return reply;
  }

  setInitialOAuthChallenge(request, reply);
  await reply.code(401).send(authErrorResponse('Authentication required'));
  return reply;
}

// streamUpstreamResponse proxies an upstream MCP event-stream to the client,
// writing the head via reply.raw so it is flushed immediately. Fastify's
// reply.send() buffers a streamed response head until the first body chunk,
// which strands clients on MCP's long-lived idle SSE channels.
async function streamUpstreamResponse(
  reply: FastifyReply,
  status: number,
  upstreamHeaders: Record<string, string>,
  stream: ReadableStream<Uint8Array>
): Promise<void> {
  const headers: Record<string, string> = { ...upstreamHeaders };

  // Preserve the upstream content-type (it carries the session-bound SSE
  // framing); only default it when the upstream omitted one.
  if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = 'text/event-stream';
  }
  headers['Cache-Control'] = 'no-cache';
  headers['Connection'] = 'keep-alive';

  // Take over the response lifecycle so Fastify does not also try to send a
  // reply, and write the head directly so it reaches the client immediately
  // instead of being buffered until the first stream chunk.
  reply.hijack();
  reply.raw.writeHead(status, headers);
  reply.raw.flushHeaders();

  const reader = stream.getReader();

  // Cancel the upstream read when the client disconnects so we do not leak the
  // upstream fetch connection or its MCP session.
  const onClose = () => {
    reader.cancel().catch(() => {});
  };
  reply.raw.on('close', onClose);

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        reply.raw.write(value);
      }
    }
  } catch (error) {
    logger.silly(`[mcp] Upstream stream error: ${(error as Error).message}`);
  } finally {
    reply.raw.removeListener('close', onClose);
    reply.raw.end();
  }
}

export async function registerMcpRoutes(
  fastify: FastifyInstance,
  mcpUsageStorage: McpUsageStorageService
) {
  const oauthEnabled = isMcpOAuthEnabled();
  const authProvider = getMcpAuthProvider();

  if (oauthEnabled && authProvider) {
    await fastify.register(formbody);

    fastify.get('/.well-known/oauth-authorization-server', async (request, reply) => {
      logger.silly('OAuth authorization server discovery');
      return reply.send(authProvider.getDiscoveryMetadata(request));
    });

    fastify.get('/.well-known/oauth-protected-resource', async (request, reply) => {
      logger.silly('OAuth protected resource discovery');
      return reply.send(authProvider.getProtectedResourceMetadata(request));
    });

    fastify.get('/oauth/authorize', async (request, reply) =>
      authProvider.handleAuthorize(request, reply)
    );
    fastify.post('/oauth/authorize', async (request, reply) =>
      authProvider.handleAuthorize(request, reply)
    );
    fastify.post('/oauth/token', async (request, reply) =>
      authProvider.handleToken(request, reply)
    );
    fastify.post('/register', async (request, reply) =>
      authProvider.handleRegister(request, reply)
    );
  }

  await registerPlexusMcpRoutes(fastify, mcpUsageStorage);

  fastify.register(async (protectedRoutes) => {
    if (oauthEnabled) {
      protectedRoutes.addHook('onRequest', mcpOAuthFallbackAuth);
    } else {
      const auth = createAuthHook();

      protectedRoutes.addHook('onRequest', auth.onRequest);

      await protectedRoutes.register(bearerAuth, auth.bearerAuthOptions);
    }

    protectedRoutes.addHook('preHandler', async (request, reply) => {
      const serverName = (request.params as any)?.name;

      if (!serverName) {
        return reply
          .code(400)
          .send({ error: { message: 'Server name is required', type: 'invalid_request' } });
      }

      if (!mcpProxyService.validateServerName(serverName)) {
        return reply.code(400).send({
          error: {
            message: 'Invalid server name. Must be slug-safe: [a-z0-9][a-z0-9-_]{1,62}',
            type: 'invalid_request',
          },
        });
      }

      const serverConfig = mcpProxyService.getMcpServerConfig(serverName);

      if (!serverConfig) {
        return reply.code(404).send({
          error: {
            message: `MCP server '${serverName}' not found or disabled`,
            type: 'not_found',
          },
        });
      }
    });

    protectedRoutes.post(
      '/mcp/:name',
      async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
        const { name: serverName } = request.params;
        const startTime = Date.now();
        const requestId = crypto.randomUUID();
        const method = 'POST';

        const keyName = (request as any).keyName;
        const attribution = (request as any).attribution || null;
        const sourceIp = getClientIp(request);
        const clientHeaders = mcpProxyService.redactSensitiveHeaders(
          request.headers as Record<string, string>
        );

        const body = request.body;
        const jsonrpcMethod = mcpProxyService.extractJsonRpcMethod(body);
        const toolName = mcpProxyService.extractToolName(body);
        const isStreamed = false;

        logger.silly(`POST /mcp/${serverName} - requestId: ${requestId}`);
        logger.silly(`Request body: ${JSON.stringify(body)?.substring(0, 500)}`);

        const result = await mcpProxyService.proxyMcpRequest(
          serverName,
          method,
          request.headers as Record<string, string | string[] | undefined>,
          body
        );

        logger.silly(`Proxy result status: ${result.status}`);
        logger.silly(`Proxy result body: ${JSON.stringify(result.body)?.substring(0, 500)}`);
        logger.silly(`Proxy result error: ${result.error}`);
        logger.silly(`Proxy result headers: ${JSON.stringify(result.headers)}`);

        const durationMs = Date.now() - startTime;

        await mcpUsageStorage.saveRequest({
          request_id: requestId,
          created_at: new Date().toISOString(),
          start_time: startTime,
          duration_ms: durationMs,
          server_name: serverName,
          upstream_url: mcpProxyService.getMcpServerConfig(serverName)
            ? mcpProxyService.getEffectiveUpstreamUrl(
                mcpProxyService.getMcpServerConfig(serverName)!
              )
            : '',
          method,
          jsonrpc_method: jsonrpcMethod,
          tool_name: toolName,
          api_key: keyName,
          attribution,
          source_ip: sourceIp,
          response_status: result.status,
          is_streamed: isStreamed,
          has_debug: false,
          error_code: result.error ? 'PROXY_ERROR' : null,
          error_message: result.error || null,
        });

        if (result.error) {
          if (result.status === 502) {
            return reply
              .code(502)
              .send({ error: { message: result.error, type: 'upstream_error' } });
          }
          if (result.status === 504) {
            return reply
              .code(504)
              .send({ error: { message: result.error, type: 'upstream_timeout' } });
          }
          return reply
            .code(result.status)
            .send({ error: { message: result.error, type: 'proxy_error' } });
        }

        for (const [key, value] of Object.entries(result.headers)) {
          reply.header(key, value);
        }

        if (result.stream) {
          logger.silly(`Sending streaming response`);
          return streamUpstreamResponse(reply, result.status, result.headers, result.stream);
        }

        if (result.body !== undefined) {
          return reply.code(result.status).send(result.body);
        }

        return reply.code(result.status);
      }
    );

    protectedRoutes.get(
      '/mcp/:name',
      async (
        request: FastifyRequest<{ Params: { name: string }; Querystring: Record<string, string> }>,
        reply: FastifyReply
      ) => {
        const { name: serverName } = request.params;
        const query = request.query as Record<string, string>;
        const startTime = Date.now();
        const requestId = crypto.randomUUID();
        const method = 'GET';

        const keyName = (request as any).keyName;
        const attribution = (request as any).attribution || null;
        const sourceIp = getClientIp(request);
        const clientHeaders = mcpProxyService.redactSensitiveHeaders(
          request.headers as Record<string, string>
        );
        const isStreamed = true;

        logger.silly(`GET /mcp/${serverName} - requestId: ${requestId}`);

        const result = await mcpProxyService.proxyMcpRequest(
          serverName,
          method,
          request.headers as Record<string, string | string[] | undefined>,
          undefined,
          query
        );

        const durationMs = Date.now() - startTime;

        await mcpUsageStorage.saveRequest({
          request_id: requestId,
          created_at: new Date().toISOString(),
          start_time: startTime,
          duration_ms: durationMs,
          server_name: serverName,
          upstream_url: mcpProxyService.getMcpServerConfig(serverName)
            ? mcpProxyService.getEffectiveUpstreamUrl(
                mcpProxyService.getMcpServerConfig(serverName)!
              )
            : '',
          method,
          jsonrpc_method: null,
          tool_name: null,
          api_key: keyName,
          attribution,
          source_ip: sourceIp,
          response_status: result.status,
          is_streamed: isStreamed,
          has_debug: false,
          error_code: result.error ? 'PROXY_ERROR' : null,
          error_message: result.error || null,
        });

        if (result.error) {
          if (result.status === 502) {
            return reply
              .code(502)
              .send({ error: { message: result.error, type: 'upstream_error' } });
          }
          if (result.status === 504) {
            return reply
              .code(504)
              .send({ error: { message: result.error, type: 'upstream_timeout' } });
          }
          return reply
            .code(result.status)
            .send({ error: { message: result.error, type: 'proxy_error' } });
        }

        for (const [key, value] of Object.entries(result.headers)) {
          reply.header(key, value);
        }

        if (result.stream) {
          return streamUpstreamResponse(reply, result.status, result.headers, result.stream);
        }

        if (result.body !== undefined) {
          return reply.code(result.status).send(result.body);
        }

        return reply.code(result.status);
      }
    );

    protectedRoutes.delete(
      '/mcp/:name',
      async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
        const { name: serverName } = request.params;
        const startTime = Date.now();
        const requestId = crypto.randomUUID();
        const method = 'DELETE';

        const keyName = (request as any).keyName;
        const attribution = (request as any).attribution || null;
        const sourceIp = getClientIp(request);
        const clientHeaders = mcpProxyService.redactSensitiveHeaders(
          request.headers as Record<string, string>
        );
        const isStreamed = false;

        logger.silly(`DELETE /mcp/${serverName} - requestId: ${requestId}`);

        const result = await mcpProxyService.proxyMcpRequest(
          serverName,
          method,
          request.headers as Record<string, string | string[] | undefined>
        );

        const durationMs = Date.now() - startTime;

        await mcpUsageStorage.saveRequest({
          request_id: requestId,
          created_at: new Date().toISOString(),
          start_time: startTime,
          duration_ms: durationMs,
          server_name: serverName,
          upstream_url: mcpProxyService.getMcpServerConfig(serverName)
            ? mcpProxyService.getEffectiveUpstreamUrl(
                mcpProxyService.getMcpServerConfig(serverName)!
              )
            : '',
          method,
          jsonrpc_method: null,
          tool_name: null,
          api_key: keyName,
          attribution,
          source_ip: sourceIp,
          response_status: result.status,
          is_streamed: isStreamed,
          has_debug: false,
          error_code: result.error ? 'PROXY_ERROR' : null,
          error_message: result.error || null,
        });

        if (result.error) {
          if (result.status === 502) {
            return reply
              .code(502)
              .send({ error: { message: result.error, type: 'upstream_error' } });
          }
          if (result.status === 504) {
            return reply
              .code(504)
              .send({ error: { message: result.error, type: 'upstream_timeout' } });
          }
          return reply
            .code(result.status)
            .send({ error: { message: result.error, type: 'proxy_error' } });
        }

        for (const [key, value] of Object.entries(result.headers)) {
          reply.header(key, value);
        }

        if (result.body !== undefined) {
          return reply.code(result.status).send(result.body);
        }

        return reply.code(result.status);
      }
    );
  });
}
