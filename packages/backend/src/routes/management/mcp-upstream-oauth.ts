import {
  getMcpUpstreamOAuthCallbackUrl,
  MCP_UI_PATH,
  MCP_UPSTREAM_OAUTH_CALLBACK_PATH,
  parseMcpOAuthUrl,
} from '@plexus/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { mcpUpstreamOAuthRepository as repo } from '../../db/mcp-upstream-oauth-repository';
import {
  beginUpstreamMcpOAuth,
  cancelUpstreamMcpOAuth,
  disconnectUpstreamMcpOAuth,
  finishUpstreamMcpOAuth,
  getUpstreamMcpOAuthStatus,
  UpstreamOAuthClientConflict,
  UpstreamOAuthClientRegistrationRequired,
  UpstreamOAuthUserError,
} from '../../services/mcp-upstream-oauth/oauth';

const params = z.object({ serverName: z.string().min(1).max(255) });
const clientParams = z.object({ id: z.string().min(1).max(255) });
const clientBody = z
  .object({
    issuer: z.string().min(1).max(2048),
    clientId: z.string().min(1).max(2048),
    clientSecret: z.string().max(8192).nullable().optional(),
  })
  .strict();
const connectBody = z
  .object({
    clientId: z.string().min(1).max(2048),
    clientSecret: z.string().max(8192).optional(),
  })
  .strict();
const cookieName = 'plexus_mcp_upstream_oauth';

export async function registerMcpUpstreamOAuthRoutes(fastify: FastifyInstance) {
  fastify.get('/v0/management/mcp-upstream-oauth/clients', async () => ({
    clients: await repo.listClients(),
  }));
  fastify.put('/v0/management/mcp-upstream-oauth/clients/:id', async (request, reply) => {
    const p = clientParams.safeParse(request.params);
    const b = clientBody.safeParse(request.body);
    if (!p.success || !b.success) return reply.code(400).send({ error: 'Invalid OAuth client' });
    const issuer = parseMcpOAuthUrl(b.data.issuer);
    if (!issuer || issuer.search) return reply.code(400).send({ error: 'Invalid OAuth issuer' });
    await repo.saveClient(p.data.id, b.data);
    return reply.code(204).send();
  });
  fastify.get('/v0/management/mcp-servers/:serverName/oauth', async (request, reply) => {
    const p = params.safeParse(request.params);
    if (!p.success) return reply.code(400).send({ error: 'Invalid server name' });
    if (!(await repo.getConnection(p.data.serverName)))
      return reply.code(404).send({ error: 'OAuth connection not found' });
    return getUpstreamMcpOAuthStatus(p.data.serverName);
  });
  fastify.post('/v0/management/mcp-servers/:serverName/oauth/connect', async (request, reply) => {
    const p = params.safeParse(request.params);
    if (!p.success) return reply.code(400).send({ error: 'Invalid server name' });
    if (!(await repo.getConnection(p.data.serverName)))
      return reply.code(404).send({ error: 'OAuth connection not found' });
    const credentials =
      request.body === null || request.body === undefined
        ? undefined
        : connectBody.safeParse(request.body);
    if (credentials && !credentials.success)
      return reply.code(400).send({ error: 'Invalid OAuth client' });
    const callback = getMcpUpstreamOAuthCallbackUrl(request.headers.origin);
    if (!callback) {
      return reply.code(400).send({ error: 'Open the Plexus admin UI over HTTPS to connect' });
    }
    try {
      const { authorizationUrl, browser } = await beginUpstreamMcpOAuth(
        p.data.serverName,
        callback.href,
        credentials?.success ? credentials.data : undefined
      );
      const secure = callback.protocol === 'https:' ? '; Secure' : '';
      reply.header(
        'Set-Cookie',
        `${cookieName}=${browser}; Path=${MCP_UPSTREAM_OAUTH_CALLBACK_PATH}; HttpOnly; SameSite=Lax; Max-Age=600${secure}`
      );
      reply.header('Cache-Control', 'no-store');
      return { authorizationUrl };
    } catch (error) {
      if (error instanceof UpstreamOAuthClientRegistrationRequired) {
        reply.header('Cache-Control', 'no-store');
        return reply.code(409).send({
          error: error.message,
          code: 'oauth_client_registration_required',
          callbackUrl: callback.href,
          provider: error.provider,
        });
      }
      if (error instanceof UpstreamOAuthClientConflict) {
        return reply.code(409).send({ error: error.message, code: 'oauth_client_conflict' });
      }
      return reply.code(400).send({
        error:
          error instanceof UpstreamOAuthUserError
            ? error.message
            : 'Could not start upstream OAuth connection; check the server and OAuth configuration',
      });
    }
  });
  fastify.delete('/v0/management/mcp-servers/:serverName/oauth', async (request, reply) => {
    const p = params.safeParse(request.params);
    if (!p.success) return reply.code(400).send({ error: 'Invalid server name' });
    if (!(await repo.getConnection(p.data.serverName)))
      return reply.code(404).send({ error: 'OAuth connection not found' });
    await disconnectUpstreamMcpOAuth(p.data.serverName);
    return reply.code(204).send();
  });
}

export async function registerMcpUpstreamOAuthCallbackRoute(fastify: FastifyInstance) {
  fastify.get(MCP_UPSTREAM_OAUTH_CALLBACK_PATH, { logLevel: 'silent' }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
    reply.header(
      'Set-Cookie',
      `${cookieName}=; Path=${MCP_UPSTREAM_OAUTH_CALLBACK_PATH}; HttpOnly; SameSite=Lax; Max-Age=0`
    );
    const query = z
      .object({ state: z.string().min(1).max(256), code: z.string().min(1).max(8192) })
      .safeParse(request.query);
    const cookies = (request.headers.cookie ?? '').split(';').map((part) => part.trim());
    const browser = cookies
      .find((part) => part.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    let connected = false;
    if (query.success && browser) {
      try {
        connected = await finishUpstreamMcpOAuth(query.data.state, browser, query.data.code);
      } catch {
        /* Keep OAuth errors out of redirects and logs. */
      }
    } else if (browser) {
      const state = z.object({ state: z.string().min(1).max(256) }).safeParse(request.query);
      if (state.success) cancelUpstreamMcpOAuth(state.data.state, browser);
    }
    return reply.redirect(`${MCP_UI_PATH}?upstream_oauth=${connected ? 'connected' : 'error'}`);
  });
}
