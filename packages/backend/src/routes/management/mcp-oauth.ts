import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { McpOauthRepository } from '../../db/mcp-oauth-repository';

const revokeTokenParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const clientParamsSchema = z.object({
  clientId: z.string().min(1),
});

const updateClientStatusSchema = z.object({
  status: z.enum(['active', 'disabled']),
});

export async function registerMcpOAuthManagementRoutes(fastify: FastifyInstance) {
  const repo = new McpOauthRepository();

  fastify.get('/v0/management/mcp-oauth/clients', async (_request, reply) => {
    try {
      const clients = await repo.listClientsWithActiveTokens();
      return reply.send({ clients });
    } catch (e: any) {
      return reply.code(500).send({ error: e.message || 'Internal server error' });
    }
  });

  fastify.patch('/v0/management/mcp-oauth/clients/:clientId', async (request, reply) => {
    const parsedParams = clientParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: 'Invalid client id' });
    }
    const parsedBody = updateClientStatusSchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.code(400).send({ error: 'Invalid status', details: parsedBody.error.issues });
    }

    const { clientId } = parsedParams.data;
    const { status } = parsedBody.data;

    try {
      const client = await repo.getClient(clientId);
      if (!client) {
        return reply.code(404).send({ error: 'OAuth client not found' });
      }
      await repo.setClientStatus(clientId, status);
      return reply.send({ success: true, clientId, status });
    } catch (e: any) {
      return reply.code(500).send({ error: e.message || 'Internal server error' });
    }
  });

  fastify.delete('/v0/management/mcp-oauth/clients/:clientId', async (request, reply) => {
    const parsed = clientParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid client id' });
    }

    const { clientId } = parsed.data;
    try {
      const client = await repo.getClient(clientId);
      if (!client) {
        return reply.code(404).send({ error: 'OAuth client not found' });
      }
      const revokedCount = await repo.revokeTokensForClient(clientId);
      await repo.deleteClient(clientId);
      return reply.send({ success: true, clientId, revokedCount });
    } catch (e: any) {
      return reply.code(500).send({ error: e.message || 'Internal server error' });
    }
  });

  fastify.post('/v0/management/mcp-oauth/clients/:clientId/revoke', async (request, reply) => {
    const parsed = clientParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid client id' });
    }

    const { clientId } = parsed.data;
    try {
      const client = await repo.getClient(clientId);
      if (!client) {
        return reply.code(404).send({ error: 'OAuth client not found' });
      }
      const revokedCount = await repo.revokeTokensForClient(clientId);
      return reply.send({ success: true, clientId, revokedCount });
    } catch (e: any) {
      return reply.code(500).send({ error: e.message || 'Internal server error' });
    }
  });

  fastify.post('/v0/management/mcp-oauth/tokens/:id/revoke', async (request, reply) => {
    const parsed = revokeTokenParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid token id', details: parsed.error.issues });
    }

    try {
      const revokedCount = await repo.revokeTokenById(parsed.data.id);
      if (revokedCount === 0) {
        return reply.code(404).send({ error: 'Active OAuth token not found' });
      }
      return reply.send({ success: true, revokedCount });
    } catch (e: any) {
      return reply.code(500).send({ error: e.message || 'Internal server error' });
    }
  });
}
