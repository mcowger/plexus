import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bearerAuth from '@fastify/bearer-auth';
import { createAuthHook } from '../../utils/auth';
import { logger } from '../../utils/logger';
import { 
  getMcpServerConfig, 
  validateServerName, 
  proxyMcpRequest,
  extractJsonRpcMethod,
  redactSensitiveHeaders
} from '../../services/mcp-proxy/mcp-proxy-service';
import { getClientIp } from '../../utils/ip';
import { McpUsageStorageService } from '../../services/mcp-proxy/mcp-usage-storage';

const DEFAULT_TIMEOUT_MS = 120000;

export async function registerMcpRoutes(fastify: FastifyInstance, mcpUsageStorage: McpUsageStorageService) {
  // OAuth 2.0 Discovery endpoints (public, no auth required)
  // These inform clients that we use Bearer token auth, not OAuth flow
  fastify.get('/.well-known/oauth-authorization-server', async (request, reply) => {
    logger.silly('OAuth authorization server discovery');
    return reply.send({
      issuer: '/',
      authorization_endpoint: '/oauth/authorize',
      token_endpoint: '/oauth/token',
      grant_types_supported: ['client_credentials', 'bearer'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
      resource_supported: true,
    });
  });

  fastify.get('/.well-known/oauth-protected-resource', async (request, reply) => {
    logger.silly('OAuth protected resource discovery');
    return reply.send({
      resource: '/',
      authorization_servers: ['/'],
      scopes_supported: ['read', 'write'],
      bearer_methods_supported: ['header', 'body', 'query'],
    });
  });

  fastify.get('/.well-known/openid-configuration', async (request, reply) => {
    logger.silly('OpenID configuration discovery');
    return reply.send({
      issuer: '/',
      authorization_endpoint: '/oauth/authorize',
      token_endpoint: '/oauth/token',
      jwks_uri: '/.well-known/jwks.json',
      response_types_supported: ['code'],
      id_token_signing_alg_values_supported: ['RS256'],
    });
  });

  fastify.post('/register', async (request, reply) => {
    logger.silly('Dynamic client registration');
    // Return a simple client_id so the client knows we're not supporting dynamic registration
    return reply.code(201).send({
      client_id: 'plexus-mcp-static',
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_secret: 'not-supported-use-api-key',
      grant_types: ['client_credentials', 'bearer'],
      token_endpoint_auth_method: 'none',
    });
  });

  fastify.register(async (protectedRoutes) => {
    const auth = createAuthHook();
    
    protectedRoutes.addHook('onRequest', auth.onRequest);

    await protectedRoutes.register(bearerAuth, auth.bearerAuthOptions);

    protectedRoutes.addHook('preHandler', async (request, reply) => {
      const serverName = (request.params as any)?.name;
      
      if (!serverName) {
        return reply.code(400).send({ error: { message: 'Server name is required', type: 'invalid_request' } });
      }

      if (!validateServerName(serverName)) {
        return reply.code(400).send({ 
          error: { 
            message: 'Invalid server name. Must be slug-safe: [a-z0-9][a-z0-9-_]{1,62}', 
            type: 'invalid_request' 
          } 
        });
      }

      const serverConfig = getMcpServerConfig(serverName);
      
      if (!serverConfig) {
        return reply.code(404).send({ error: { message: `MCP server '${serverName}' not found or disabled`, type: 'not_found' } });
      }
    });

    protectedRoutes.post('/mcp/:name', async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
      const { name: serverName } = request.params;
      const startTime = Date.now();
      const requestId = crypto.randomUUID();
      const method = 'POST';
      
      const keyName = (request as any).keyName;
      const attribution = (request as any).attribution || null;
      const sourceIp = getClientIp(request);
      const clientHeaders = redactSensitiveHeaders(request.headers as Record<string, string>);
      
      const body = request.body;
      const jsonrpcMethod = extractJsonRpcMethod(body);
      const isStreamed = false;

      logger.silly(`[mcp] POST /mcp/${serverName} - requestId: ${requestId}`);
      logger.silly(`[mcp] Request body: ${JSON.stringify(body)?.substring(0, 500)}`);

      const result = await proxyMcpRequest(
        serverName,
        method,
        request.headers as Record<string, string | string[] | undefined>,
        body
      );

      logger.silly(`[mcp] Proxy result status: ${result.status}`);
      logger.silly(`[mcp] Proxy result body: ${JSON.stringify(result.body)?.substring(0, 500)}`);
      logger.silly(`[mcp] Proxy result error: ${result.error}`);
      logger.silly(`[mcp] Proxy result headers: ${JSON.stringify(result.headers)}`);

      const durationMs = Date.now() - startTime;

      await mcpUsageStorage.saveRequest({
        request_id: requestId,
        created_at: new Date().toISOString(),
        start_time: startTime,
        duration_ms: durationMs,
        server_name: serverName,
        upstream_url: getMcpServerConfig(serverName)?.upstream_url || '',
        method,
        jsonrpc_method: jsonrpcMethod,
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
          return reply.code(502).send({ error: { message: result.error, type: 'upstream_error' } });
        }
        if (result.status === 504) {
          return reply.code(504).send({ error: { message: result.error, type: 'upstream_timeout' } });
        }
        return reply.code(result.status).send({ error: { message: result.error, type: 'proxy_error' } });
      }

      for (const [key, value] of Object.entries(result.headers)) {
        reply.header(key, value);
      }

      if (result.stream) {
        logger.silly(`[mcp] Sending streaming response`);
        reply.header('Content-Type', 'text/event-stream');
        reply.header('Cache-Control', 'no-cache');
        reply.header('Connection', 'keep-alive');
        
        const reader = result.stream.getReader();
        
        const queue: Uint8Array[] = [];
        
        const stream = new ReadableStream({
          async start(controller) {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                queue.push(value);
                controller.enqueue(value);
              }
            } catch (e) {
              controller.error(e);
            } finally {
              reader.releaseLock();
            }
          },
          pull(controller) {
            while (queue.length > 0) {
              controller.enqueue(queue.shift()!);
            }
          },
          cancel() {
            reader.cancel().catch(() => {});
          }
        });
        
        return reply.send(stream);
      }

      if (result.body !== undefined) {
        return reply.code(result.status).send(result.body);
      }

      return reply.code(result.status);
    });

    protectedRoutes.get('/mcp/:name', async (request: FastifyRequest<{ Params: { name: string }, Querystring: Record<string, string> }>, reply: FastifyReply) => {
      const { name: serverName } = request.params;
      const query = request.query as Record<string, string>;
      const startTime = Date.now();
      const requestId = crypto.randomUUID();
      const method = 'GET';
      
      const keyName = (request as any).keyName;
      const attribution = (request as any).attribution || null;
      const sourceIp = getClientIp(request);
      const clientHeaders = redactSensitiveHeaders(request.headers as Record<string, string>);
      const isStreamed = true;

      logger.silly(`[mcp] GET /mcp/${serverName} - requestId: ${requestId}`);

      const result = await proxyMcpRequest(
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
        upstream_url: getMcpServerConfig(serverName)?.upstream_url || '',
        method,
        jsonrpc_method: null,
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
          return reply.code(502).send({ error: { message: result.error, type: 'upstream_error' } });
        }
        if (result.status === 504) {
          return reply.code(504).send({ error: { message: result.error, type: 'upstream_timeout' } });
        }
        return reply.code(result.status).send({ error: { message: result.error, type: 'proxy_error' } });
      }

      for (const [key, value] of Object.entries(result.headers)) {
        reply.header(key, value);
      }

      if (result.stream) {
        reply.header('Content-Type', 'text/event-stream');
        reply.header('Cache-Control', 'no-cache');
        reply.header('Connection', 'keep-alive');
        
        const reader = result.stream.getReader();
        
        const queue: Uint8Array[] = [];
        
        const stream = new ReadableStream({
          async start(controller) {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                queue.push(value);
                controller.enqueue(value);
              }
            } catch (e) {
              controller.error(e);
            } finally {
              reader.releaseLock();
            }
          },
          pull(controller) {
            while (queue.length > 0) {
              controller.enqueue(queue.shift()!);
            }
          },
          cancel() {
            reader.cancel().catch(() => {});
          }
        });
        
        return reply.send(stream);
      }

      if (result.body !== undefined) {
        return reply.code(result.status).send(result.body);
      }

      return reply.code(result.status);
    });

    protectedRoutes.delete('/mcp/:name', async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
      const { name: serverName } = request.params;
      const startTime = Date.now();
      const requestId = crypto.randomUUID();
      const method = 'DELETE';
      
      const keyName = (request as any).keyName;
      const attribution = (request as any).attribution || null;
      const sourceIp = getClientIp(request);
      const clientHeaders = redactSensitiveHeaders(request.headers as Record<string, string>);
      const isStreamed = false;

      logger.silly(`[mcp] DELETE /mcp/${serverName} - requestId: ${requestId}`);

      const result = await proxyMcpRequest(
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
        upstream_url: getMcpServerConfig(serverName)?.upstream_url || '',
        method,
        jsonrpc_method: null,
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
          return reply.code(502).send({ error: { message: result.error, type: 'upstream_error' } });
        }
        if (result.status === 504) {
          return reply.code(504).send({ error: { message: result.error, type: 'upstream_timeout' } });
        }
        return reply.code(result.status).send({ error: { message: result.error, type: 'proxy_error' } });
      }

      for (const [key, value] of Object.entries(result.headers)) {
        reply.header(key, value);
      }

      if (result.body !== undefined) {
        return reply.code(result.status).send(result.body);
      }

      return reply.code(result.status);
    });
  });
}
