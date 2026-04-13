import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DebugManager } from '../../services/debug-manager';
import { UsageStorageService } from '../../services/usage-storage';
import { isLimited, scopedKeyName } from './_principal';

const patchDebugSchema = z.object({
  enabled: z.boolean().optional(),
  providers: z.array(z.string()).nullable().optional(),
});

export async function registerDebugRoutes(
  fastify: FastifyInstance,
  usageStorage: UsageStorageService
) {
  // GET returns the global debug state plus the per-key enabled list. Admin
  // sees everything; limited users see only whether their own key is enabled
  // (the global flag is still reported, since it implicitly affects them).
  fastify.get('/v0/management/debug', (request, reply) => {
    const debugManager = DebugManager.getInstance();
    const scopeKey = scopedKeyName(request);
    if (scopeKey) {
      return reply.send({
        enabledGlobal: debugManager.isEnabled(),
        enabledForKey: debugManager.isEnabledForKey(scopeKey),
        providers: debugManager.getProviderFilter(),
      });
    }
    return reply.send({
      enabled: debugManager.isEnabled(),
      enabledGlobal: debugManager.isEnabled(),
      enabledKeys: debugManager.getEnabledKeys(),
      providers: debugManager.getProviderFilter(),
    });
  });

  // PATCH mutates the global debug state; admin-only. Limited users use the
  // /self/debug/toggle endpoint to affect only their own key.
  fastify.patch('/v0/management/debug', async (request, reply) => {
    if (isLimited(request)) {
      return reply.code(403).send({ error: 'Admin privileges required' });
    }
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
      enabledGlobal: debugManager.isEnabled(),
      enabledKeys: debugManager.getEnabledKeys(),
      providers: debugManager.getProviderFilter(),
    });
  });

  fastify.get('/v0/management/debug/logs', async (request, reply) => {
    const query = request.query as any;
    const limit = parseInt(query.limit || '50');
    const offset = parseInt(query.offset || '0');
    const scopeKey = scopedKeyName(request);
    const logs = await usageStorage.getDebugLogs(limit, offset, scopeKey ?? undefined);
    return reply.send(logs);
  });

  fastify.delete('/v0/management/debug/logs', async (request, reply) => {
    if (isLimited(request)) {
      return reply.code(403).send({ error: 'Admin privileges required' });
    }
    const success = await usageStorage.deleteAllDebugLogs();
    if (!success) return reply.code(500).send({ error: 'Failed to delete logs' });
    return reply.send({ success: true });
  });

  fastify.get('/v0/management/debug/logs/:requestId', async (request, reply) => {
    const params = request.params as any;
    const requestId = params.requestId;

    // Limited users may only read logs attributed to their own key.
    const scopeKey = scopedKeyName(request);
    if (scopeKey) {
      const owner = await usageStorage.getDebugLogOwner(requestId);
      if (owner !== scopeKey) {
        return reply.code(404).send({ error: 'Log not found' });
      }
    }

    const log = await usageStorage.getDebugLog(requestId);
    if (!log) return reply.code(404).send({ error: 'Log not found' });
    return reply.send(log);
  });

  fastify.delete('/v0/management/debug/logs/:requestId', async (request, reply) => {
    const params = request.params as any;
    const requestId = params.requestId;

    const scopeKey = scopedKeyName(request);
    if (scopeKey) {
      const owner = await usageStorage.getDebugLogOwner(requestId);
      if (owner !== scopeKey) {
        return reply.code(404).send({ error: 'Log not found or could not be deleted' });
      }
    }

    const success = await usageStorage.deleteDebugLog(requestId);
    if (!success) return reply.code(404).send({ error: 'Log not found or could not be deleted' });
    return reply.send({ success: true });
  });
}
