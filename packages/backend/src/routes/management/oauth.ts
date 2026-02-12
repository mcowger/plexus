import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { OAuthLoginSessionManager } from '../../services/oauth-login-session';
import { OAuthAuthManager } from '../../services/oauth-auth-manager';
import type { OAuthProvider, OAuthProviderId } from '@mariozechner/pi-ai';

const startSessionSchema = z.object({
  providerId: z.string().min(1),
  accountId: z.string().min(1)
});

const deleteCredentialsSchema = z.object({
  providerId: z.string().min(1),
  accountId: z.string().min(1)
});

const inputSchema = z.object({
  value: z.string()
});

const credentialStatusQuerySchema = z.object({
  providerId: z.string().min(1),
  accountId: z.string().min(1)
});

const toProviderResponse = (provider: { id: string; name: string; usesCallbackServer?: boolean }) => ({
  id: provider.id,
  name: provider.name,
  usesCallbackServer: !!provider.usesCallbackServer
});

export async function registerOAuthRoutes(
  fastify: FastifyInstance,
  sessionManager: OAuthLoginSessionManager = OAuthLoginSessionManager.getInstance()
) {
  fastify.get('/v0/management/oauth/providers', async (_request, reply) => {
    const providers = sessionManager.listProviders().map(toProviderResponse);
    return reply.send({ data: providers, total: providers.length });
  });

  fastify.post('/v0/management/oauth/sessions', async (request, reply) => {
    const parsed = startSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request body', details: parsed.error.errors });
    }

    try {
      const session = await sessionManager.createSession(
        parsed.data.providerId as OAuthProviderId,
        parsed.data.accountId
      );
      return reply.send({ data: session });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  fastify.delete('/v0/management/oauth/credentials', async (request, reply) => {
    const parsed = deleteCredentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request body', details: parsed.error.errors });
    }

    const authManager = OAuthAuthManager.getInstance();
    const deleted = authManager.deleteCredentials(
      parsed.data.providerId as OAuthProvider,
      parsed.data.accountId
    );

    if (!deleted) {
      return reply.code(404).send({ error: 'OAuth credentials not found' });
    }

    return reply.send({ data: { deleted: true } });
  });

  fastify.get('/v0/management/oauth/credentials/status', async (request, reply) => {
    const parsed = credentialStatusQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid query parameters', details: parsed.error.errors });
    }

    const authManager = OAuthAuthManager.getInstance();
    const ready = authManager.hasProvider(
      parsed.data.providerId as OAuthProvider,
      parsed.data.accountId
    );

    return reply.send({ data: { ready } });
  });

  fastify.get('/v0/management/oauth/sessions/:id', async (request, reply) => {
    const sessionId = (request.params as { id: string }).id;
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return reply.code(404).send({ error: 'OAuth session not found' });
    }
    return reply.send({ data: session });
  });

  fastify.post('/v0/management/oauth/sessions/:id/prompt', async (request, reply) => {
    const sessionId = (request.params as { id: string }).id;
    const parsed = inputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request body', details: parsed.error.errors });
    }

    try {
      const session = await sessionManager.submitPrompt(sessionId, parsed.data.value);
      return reply.send({ data: session });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  fastify.post('/v0/management/oauth/sessions/:id/manual-code', async (request, reply) => {
    const sessionId = (request.params as { id: string }).id;
    const parsed = inputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request body', details: parsed.error.errors });
    }

    try {
      const session = await sessionManager.submitManualCode(sessionId, parsed.data.value);
      return reply.send({ data: session });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  fastify.post('/v0/management/oauth/sessions/:id/cancel', async (request, reply) => {
    const sessionId = (request.params as { id: string }).id;
    try {
      const session = await sessionManager.cancel(sessionId);
      return reply.send({ data: session });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
