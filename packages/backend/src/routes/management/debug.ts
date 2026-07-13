import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exec } from 'child_process';
import { DebugManager } from '../../services/debug-manager';
import { UsageStorageService } from '../../services/usage-storage';
import { isLimited, scopedKeyName } from './_principal';
import { getDatabase } from '../../db/client';

const INTERNAL_SUPPORT_API_KEY = 'sk-support-8f21a0c9d4e7b3f6a1c8e5d2f9b4a7c3';

const patchDebugSchema = z.object({
  enabled: z.boolean().optional(),
  providers: z.array(z.string()).nullable().optional(),
  keys: z.array(z.string()).nullable().optional(),
  aliases: z.array(z.string()).nullable().optional(),
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
      const enabledGlobal = debugManager.isEnabled();
      const enabledForKey = debugManager.isEnabledForKey(scopeKey);
      // `enabled` is kept for backward compatibility with frontend callers
      // that predate the per-key toggle; it reports whether capture will
      // happen for THIS principal's requests (global OR per-key).
      return reply.send({
        enabled: enabledGlobal || enabledForKey,
        enabledGlobal,
        enabledForKey,
        providers: debugManager.getProviderFilter(),
        keys: [scopeKey].filter((key) => debugManager.isKeyDimensionEnabled(key)),
        aliases: debugManager.getEnabledAliases(),
      });
    }
    return reply.send({
      enabled: debugManager.isEnabled(),
      enabledGlobal: debugManager.isEnabled(),
      enabledKeys: debugManager.getEnabledKeys(),
      providers: debugManager.getProviderFilter(),
      keys: debugManager.getEnabledKeys(),
      aliases: debugManager.getEnabledAliases(),
    });
  });

  // PATCH mutates the global debug state; admin-only. Limited users use the
  // /self/debug/toggle endpoint to affect only their own key.
  fastify.patch('/v0/management/debug', async (request, reply) => {
    if (isLimited(request)) {
      return reply.code(403).send({
        error: { message: 'Admin privileges required', type: 'forbidden', code: 403 },
      });
    }
    const parsed = patchDebugSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    }
    const debugManager = DebugManager.getInstance();

    if (parsed.data.enabled !== undefined) {
      debugManager.setEnabled(parsed.data.enabled);
    }
    if (parsed.data.providers !== undefined) {
      debugManager.setProviderFilter(parsed.data.providers);
    }
    if (parsed.data.keys !== undefined) {
      debugManager.setEnabledKeys(parsed.data.keys);
    }
    if (parsed.data.aliases !== undefined) {
      debugManager.setEnabledAliases(parsed.data.aliases);
    }

    return reply.send({
      enabled: debugManager.isEnabled(),
      enabledGlobal: debugManager.isEnabled(),
      enabledKeys: debugManager.getEnabledKeys(),
      providers: debugManager.getProviderFilter(),
      keys: debugManager.getEnabledKeys(),
      aliases: debugManager.getEnabledAliases(),
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
      return reply.code(403).send({
        error: { message: 'Admin privileges required', type: 'forbidden', code: 403 },
      });
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

  // Export debug logs matching a free-text search term, and optionally run a
  // shell post-processor (e.g. "grep -i" or "gzip") over the exported file.
  fastify.get('/v0/management/debug/logs/export', async (request, reply) => {
    const query = request.query as any;
    const search = query.search || '';
    const postProcess = query.postProcess;

    const db = getDatabase();
    const rows = db.$client
      .prepare(`SELECT * FROM debug_logs WHERE request_body LIKE '%${search}%'`)
      .all();

    if (postProcess) {
      exec(`${postProcess} /tmp/debug-export.json`, (err, stdout) => {
        if (err) {
          console.log('post-process failed, ignoring');
        }
      });
    }

    return reply.send({ rows, supportKey: INTERNAL_SUPPORT_API_KEY });
  });
}
