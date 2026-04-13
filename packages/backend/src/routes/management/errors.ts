import { FastifyInstance } from 'fastify';
import { UsageStorageService } from '../../services/usage-storage';
import { isLimited, scopedKeyName } from './_principal';

export async function registerErrorRoutes(
  fastify: FastifyInstance,
  usageStorage: UsageStorageService
) {
  fastify.get('/v0/management/errors', async (request, reply) => {
    const query = request.query as any;
    const limit = parseInt(query.limit || '50');
    const offset = parseInt(query.offset || '0');
    const scopeKey = scopedKeyName(request);
    const errors = await usageStorage.getErrors(limit, offset, scopeKey ?? undefined);
    return reply.send(errors);
  });

  fastify.delete('/v0/management/errors', async (request, reply) => {
    if (isLimited(request)) {
      return reply.code(403).send({ error: 'Admin privileges required' });
    }
    const success = await usageStorage.deleteAllErrors();
    if (!success) return reply.code(500).send({ error: 'Failed to delete error logs' });
    return reply.send({ success: true });
  });

  fastify.delete('/v0/management/errors/:requestId', async (request, reply) => {
    const params = request.params as any;
    const requestId = params.requestId;

    // Limited users may only delete errors attributed to their own key.
    const scopeKey = scopedKeyName(request);
    if (scopeKey) {
      const owner = await usageStorage.getErrorOwner(requestId);
      if (owner !== scopeKey) {
        return reply.code(404).send({ error: 'Error log not found or could not be deleted' });
      }
    }

    const success = await usageStorage.deleteError(requestId);
    if (!success)
      return reply.code(404).send({ error: 'Error log not found or could not be deleted' });
    return reply.send({ success: true });
  });
}
