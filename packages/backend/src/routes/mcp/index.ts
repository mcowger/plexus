import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import formbody from '@fastify/formbody';
import { getConfig } from '../../config';
import { attachPlexusApiKeyAuth, isRequestIpAllowed, validatePlexusApiKey } from '../../utils/auth';
import { logger } from '../../utils/logger';
import * as mcpProxyService from '../../services/mcp-proxy/mcp-proxy-service';
import { getClientIp } from '../../utils/ip';
import { McpUsageStorageService } from '../../services/mcp-proxy/mcp-usage-storage';
import { registerPlexusMcpRoutes } from './plexus';
import { getMcpAuthProvider } from '../../services/mcp-oauth/provider-factory';
import {
  getMcpProtectedResourceMetadataUrl,
  getMcpServerNameFromRequest,
} from '../../services/mcp-oauth/url';
import { MCP_OAUTH_ACCESS_TOKEN_PREFIX } from '../../services/mcp-oauth/plexus-idp-provider';

const DEFAULT_TIMEOUT_MS = 120000;

// C3: JSON-RPC methods that mutate external state require the `mcp:write`
// scope. `mcp:write` includes read access, so a batch containing both write
// and read methods is correctly authorized by the write scope.
const MCP_WRITE_METHODS = new Set(['tools/call']);

// Required scope for an MCP proxy operation. The mutating surface is the
// JSON-RPC `tools/call` request issued over POST; listing, streaming
// (GET), session lifecycle (DELETE), and all other JSON-RPC methods are
// read-scoped. Returns `mcp:write` for write operations (which also grants
// read access), and `mcp:read` otherwise.
function requiredScopeForOperation(request: FastifyRequest): 'mcp:read' | 'mcp:write' {
  if (request.method === 'POST') {
    const methods = mcpProxyService.extractJsonRpcMethods(request.body);
    if (methods.some((method) => MCP_WRITE_METHODS.has(method))) {
      return 'mcp:write';
    }
  }
  return 'mcp:read';
}

function scopeAllowsOperation(scopes: string[], required: 'mcp:read' | 'mcp:write'): boolean {
  return scopes.includes(required) || (required === 'mcp:read' && scopes.includes('mcp:write'));
}

function authErrorResponse(message: string) {
  return { error: { message, type: 'auth_error', code: 401 } };
}

function oauthUnavailableReply(reply: FastifyReply) {
  return reply.code(404).send({
    error: {
      message: 'MCP OAuth is disabled',
      type: 'oauth_disabled',
      code: 404,
    },
  });
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
  const metadataUrl = getMcpProtectedResourceMetadataUrl(request);
  if (metadataUrl) {
    reply.header('WWW-Authenticate', `Bearer resource_metadata="${metadataUrl}"`);
  }
}

function setInvalidTokenChallenge(reply: FastifyReply) {
  reply.header('WWW-Authenticate', 'Bearer error="invalid_token"');
}

function mcpOAuthFallbackAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  done: (error?: Error) => void
) {
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

  const rejectBearer = () => {
    setInvalidTokenChallenge(reply);
    reply.code(401).send(authErrorResponse('Invalid bearer token'));
  };

  if (authorization) {
    const credential = extractBearerCredential(authorization);
    if (tryRawApiKey(credential)) {
      done();
      return;
    }

    const provider = getMcpAuthProvider();
    if (credential.startsWith(MCP_OAUTH_ACCESS_TOKEN_PREFIX) && provider) {
      void provider
        .validateToken(credential, request)
        .then((oauthResult) => {
          if (oauthResult) {
            const config = getConfig();
            const keyConfig = config.keys?.[oauthResult.keyName];
            if (
              keyConfig &&
              isRequestIpAllowed(request, keyConfig.allowedIps, config.trustedProxies)
            ) {
              attachPlexusApiKeyAuth(request, {
                keyName: oauthResult.keyName,
                keyConfig,
                attribution: null,
              });
              // C3: retain the OAuth token's granted scopes so the
              // protected-resource hook can enforce them against the
              // operation's required scope (read vs write).
              (request as any).mcpOAuthScopes = oauthResult.scopes;
              done();
              return;
            }
          }

          rejectBearer();
        })
        .catch((error: unknown) => {
          done(error instanceof Error ? error : new Error(String(error)));
        });
      return;
    }

    rejectBearer();
    return;
  }

  const apiKeyStyleCredential = xApiKey ?? xGoogApiKey ?? queryKey;
  if (apiKeyStyleCredential) {
    if (tryRawApiKey(apiKeyStyleCredential)) {
      done();
      return;
    }
    reply.code(401).send(authErrorResponse('Invalid API key'));
    return;
  }

  setInitialOAuthChallenge(request, reply);
  reply.code(401).send(authErrorResponse('Authentication required'));
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
  if (!Object.keys(headers).some((key) => key.toLowerCase() === 'cache-control')) {
    headers['Cache-Control'] = 'no-cache';
  }
  headers['X-Accel-Buffering'] = 'no';

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
  // Discovery, DCR, and OAuth endpoints are always registered (matching
  // what openapi.json advertises) so a config change toggling MCP OAuth takes
  // effect without a process restart. Each handler resolves the auth provider
  // via getMcpAuthProvider() at request time; when MCP OAuth is disabled the
  // provider is null and the endpoint reports that the feature is off.
  await fastify.register(formbody);

  fastify.get('/.well-known/oauth-authorization-server', async (request, reply) => {
    const provider = getMcpAuthProvider();
    if (!provider) return oauthUnavailableReply(reply);
    logger.silly('OAuth authorization server discovery');
    return reply.send(provider.getDiscoveryMetadata(request));
  });

  fastify.get('/.well-known/oauth-protected-resource/mcp/:name', async (request, reply) => {
    const provider = getMcpAuthProvider();
    if (!provider) return oauthUnavailableReply(reply);
    const serverName = getMcpServerNameFromRequest(request);
    if (!serverName || !mcpProxyService.getMcpServerConfig(serverName)) {
      return reply.code(404).send({
        error: {
          message: 'MCP server not found or disabled',
          type: 'not_found',
          code: 404,
        },
      });
    }
    logger.silly('OAuth protected resource discovery');
    return reply.send(provider.getProtectedResourceMetadata(request));
  });

  fastify.get('/oauth/authorize', async (request, reply) => {
    const provider = getMcpAuthProvider();
    if (!provider) return oauthUnavailableReply(reply);
    return provider.handleAuthorize(request, reply);
  });
  fastify.post('/oauth/authorize', async (request, reply) => {
    const provider = getMcpAuthProvider();
    if (!provider) return oauthUnavailableReply(reply);
    return provider.handleAuthorize(request, reply);
  });
  fastify.post('/oauth/token', async (request, reply) => {
    const provider = getMcpAuthProvider();
    if (!provider) return oauthUnavailableReply(reply);
    return provider.handleToken(request, reply);
  });
  fastify.post('/oauth/register', async (request, reply) => {
    const provider = getMcpAuthProvider();
    if (!provider) return oauthUnavailableReply(reply);
    return provider.handleRegister(request, reply);
  });

  await registerPlexusMcpRoutes(fastify, mcpUsageStorage);

  fastify.register(async (protectedRoutes) => {
    // C1: single request-time auth hook. It handles raw API keys, OAuth bearer
    // tokens, and api-key-style headers. OAuth token validation is a no-op when
    // MCP OAuth is disabled (getMcpAuthProvider() returns null), so the hook
    // reflects the current config value on every request rather than only at
    // route registration time.
    protectedRoutes.addHook('onRequest', mcpOAuthFallbackAuth);

    // C3: enforce OAuth scopes at the protected resource once the body is
    // available. Requests authenticated with a raw API key carry no scope
    // restriction; OAuth-authenticated requests are constrained to the scopes
    // granted on their access token.
    protectedRoutes.addHook('preHandler', (request, reply, done) => {
      const scopes = (request as any).mcpOAuthScopes as string[] | undefined;
      if (scopes) {
        const required = requiredScopeForOperation(request);
        if (!scopeAllowsOperation(scopes, required)) {
          reply.header(
            'WWW-Authenticate',
            `Bearer error="insufficient_scope", scope="${required}"`
          );
          reply.code(403).send({
            error: {
              message: `OAuth token lacks required scope '${required}' for this MCP operation`,
              type: 'insufficient_scope',
              code: 403,
            },
          });
          return;
        }
      }
      done();
    });

    protectedRoutes.addHook('preHandler', (request, reply, done) => {
      const serverName = (request.params as any)?.name;

      if (!serverName) {
        reply.code(400).send({
          error: {
            message: 'Server name is required',
            type: 'invalid_request',
          },
        });
        return;
      }

      if (!mcpProxyService.validateServerName(serverName)) {
        reply.code(400).send({
          error: {
            message: 'Invalid server name. Must be slug-safe: [a-z0-9][a-z0-9-_]{1,62}',
            type: 'invalid_request',
          },
        });
        return;
      }

      const serverConfig = mcpProxyService.getMcpServerConfig(serverName);

      if (!serverConfig) {
        reply.code(404).send({
          error: {
            message: `MCP server '${serverName}' not found or disabled`,
            type: 'not_found',
          },
        });
        return;
      }
      done();
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
        const isStreamed = !!result.stream;

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
            return reply.code(502).send({
              error: { message: result.error, type: 'upstream_error' },
            });
          }
          if (result.status === 504) {
            return reply.code(504).send({
              error: { message: result.error, type: 'upstream_timeout' },
            });
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
        request: FastifyRequest<{
          Params: { name: string };
          Querystring: Record<string, string>;
        }>,
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

        logger.silly(`GET /mcp/${serverName} - requestId: ${requestId}`);

        const result = await mcpProxyService.proxyMcpRequest(
          serverName,
          method,
          request.headers as Record<string, string | string[] | undefined>,
          undefined,
          query
        );

        const durationMs = Date.now() - startTime;
        const isStreamed = !!result.stream;

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
            return reply.code(502).send({
              error: { message: result.error, type: 'upstream_error' },
            });
          }
          if (result.status === 504) {
            return reply.code(504).send({
              error: { message: result.error, type: 'upstream_timeout' },
            });
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

        logger.silly(`DELETE /mcp/${serverName} - requestId: ${requestId}`);

        const result = await mcpProxyService.proxyMcpRequest(
          serverName,
          method,
          request.headers as Record<string, string | string[] | undefined>
        );

        const durationMs = Date.now() - startTime;
        const isStreamed = !!result.stream;

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
            return reply.code(502).send({
              error: { message: result.error, type: 'upstream_error' },
            });
          }
          if (result.status === 504) {
            return reply.code(504).send({
              error: { message: result.error, type: 'upstream_timeout' },
            });
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
