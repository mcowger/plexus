import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DebugManager } from '../../services/debug-manager';
import { UsageStorageService } from '../../services/usage-storage';

const patchDebugSchema = z.object({
  enabled: z.boolean().optional(),
  providers: z.array(z.string()).nullable().optional(),
});

export async function registerDebugRoutes(
  fastify: FastifyInstance,
  usageStorage: UsageStorageService
) {
  fastify.get('/v0/management/debug', (request, reply) => {
    const debugManager = DebugManager.getInstance();
    return reply.send({
      enabled: debugManager.isEnabled(),
      providers: debugManager.getProviderFilter(),
    });
  });

  fastify.patch('/v0/management/debug', async (request, reply) => {
    const parsed = patchDebugSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request body', details: parsed.error.errors });
    }
    const debugManager = DebugManager.getInstance();

    if (parsed.data.enabled !== undefined) {
      debugManager.setEnabled(parsed.data.enabled);
    }
    if (parsed.data.providers !== undefined) {
      debugManager.setProviderFilter(parsed.data.providers);
    }

    return reply.send({
      enabled: debugManager.isEnabled(),
      providers: debugManager.getProviderFilter(),
    });
  });

  fastify.get('/v0/management/debug/logs', async (request, reply) => {
    const query = request.query as any;
    const limit = parseInt(query.limit || '50');
    const offset = parseInt(query.offset || '0');
    const logs = await usageStorage.getDebugLogs(limit, offset);
    return reply.send(logs);
  });

  fastify.delete('/v0/management/debug/logs', async (request, reply) => {
    const success = await usageStorage.deleteAllDebugLogs();
    if (!success) return reply.code(500).send({ error: 'Failed to delete logs' });
    return reply.send({ success: true });
  });

  fastify.get('/v0/management/debug/logs/:requestId', async (request, reply) => {
    const params = request.params as any;
    const requestId = params.requestId;
    const log = await usageStorage.getDebugLog(requestId);
    if (!log) return reply.code(404).send({ error: 'Log not found' });
    return reply.send(log);
  });

  fastify.delete('/v0/management/debug/logs/:requestId', async (request, reply) => {
    const params = request.params as any;
    const requestId = params.requestId;
    const success = await usageStorage.deleteDebugLog(requestId);
    if (!success) return reply.code(404).send({ error: 'Log not found or could not be deleted' });
    return reply.send({ success: true });
  });
}
