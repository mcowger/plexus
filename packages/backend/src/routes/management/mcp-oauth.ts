import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { McpOauthRepository } from '../../db/mcp-oauth-repository';

const revokeTokenParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
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
