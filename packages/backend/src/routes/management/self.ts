import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import { logger } from '../../utils/logger';
import { DebugManager } from '../../services/debug-manager';
import { ConfigService } from '../../services/config-service';
import { ConfigRepository } from '../../db/config-repository';
import type { Principal } from './_principal';

const toggleSchema = z.object({
  enabled: z.boolean(),
});

const commentSchema = z.object({
  comment: z.string().nullable().optional(),
});

function generateSecret(): string {
  // `sk-` prefix mirrors existing Plexus conventions and external provider
  // secrets.
  return `sk-${crypto.randomBytes(24).toString('hex')}`;
}

/**
 * Self-service endpoints for the currently authenticated principal.
 *
 * - Limited (api-key) users may only act on their own key.
 * - Admin users may act on the key identified by `?keyName=...` query param,
 *   allowing them to e.g. rotate a user's secret or toggle trace on their
 *   behalf from the admin UI.
 */
export async function registerSelfRoutes(fastify: FastifyInstance) {
  // Resolve the effective key name for a self-service action. Limited users
  // always operate on their own key; admins may override via ?keyName=.
  const resolveTarget = (
    request: import('fastify').FastifyRequest
  ): { keyName: string } | { error: { code: number; message: string } } => {
    const principal = request.principal as Principal;
    if (principal.role === 'limited') {
      return { keyName: principal.keyName };
    }
    const q = request.query as { keyName?: string };
    if (!q.keyName) {
      return {
        error: { code: 400, message: 'Admin must supply ?keyName= for self-service endpoints' },
      };
    }
    return { keyName: q.keyName };
  };

  /**
   * Returns the principal's identity plus the key's current metadata.
   * Limited users use this to populate the "My Key" page.
   */
  fastify.get('/v0/management/self/me', async (request, reply) => {
    const principal = request.principal as Principal;
    if (principal.role === 'admin') {
      return reply.send({ role: 'admin' });
    }

    const config = ConfigService.getInstance().getConfig();
    const keyRow = config.keys?.[principal.keyName];

    return reply.send({
      role: 'limited',
      keyName: principal.keyName,
      allowedProviders: principal.allowedProviders,
      allowedModels: principal.allowedModels,
      quotaName: principal.quotaName ?? null,
      comment: keyRow?.comment ?? principal.comment ?? null,
      traceEnabled: DebugManager.getInstance().isEnabledForKey(principal.keyName),
      traceEnabledGlobal: DebugManager.getInstance().isEnabled(),
    });
  });

  /**
   * Rotate the authenticated user's secret. Returns the new plaintext secret
   * exactly once in the response body.
   *
   * Because scoping of logs/traces/errors is done by key *name* (not secret),
   * rotating the secret preserves all historical data.
   */
  fastify.post('/v0/management/self/rotate', async (request, reply) => {
    const target = resolveTarget(request);
    if ('error' in target) {
      return reply.code(target.error.code).send({ error: target.error.message });
    }

    const config = ConfigService.getInstance().getConfig();
    const existing = config.keys?.[target.keyName];
    if (!existing) {
      return reply.code(404).send({ error: `Key '${target.keyName}' not found` });
    }

    const newSecret = generateSecret();
    await ConfigService.getInstance().saveKey(target.keyName, {
      ...existing,
      secret: newSecret,
    });

    logger.info(
      `[AUDIT] secret rotated for key='${target.keyName}' by principal='${
        request.principal!.role === 'admin' ? 'admin' : request.principal!.keyName
      }'`
    );

    return reply.send({
      keyName: target.keyName,
      secret: newSecret,
      message: 'Secret rotated. Store it now — it will not be shown again.',
    });
  });

  /**
   * Update the authenticated user's key comment.
   */
  fastify.patch('/v0/management/self/comment', async (request, reply) => {
    const parsed = commentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid body', details: parsed.error.errors });
    }

    const target = resolveTarget(request);
    if ('error' in target) {
      return reply.code(target.error.code).send({ error: target.error.message });
    }

    const config = ConfigService.getInstance().getConfig();
    const existing = config.keys?.[target.keyName];
    if (!existing) {
      return reply.code(404).send({ error: `Key '${target.keyName}' not found` });
    }

    await ConfigService.getInstance().saveKey(target.keyName, {
      ...existing,
      comment: parsed.data.comment ?? undefined,
    });

    logger.info(
      `[AUDIT] comment updated for key='${target.keyName}' by principal='${
        request.principal!.role === 'admin' ? 'admin' : request.principal!.keyName
      }'`
    );

    return reply.send({ success: true, keyName: target.keyName, comment: parsed.data.comment });
  });

  /**
   * Toggle tracing for the authenticated user's key. Only affects their
   * key's capture; the global trace flag is untouched.
   */
  fastify.post('/v0/management/self/debug/toggle', async (request, reply) => {
    const parsed = toggleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid body', details: parsed.error.errors });
    }

    const target = resolveTarget(request);
    if ('error' in target) {
      return reply.code(target.error.code).send({ error: target.error.message });
    }

    const dm = DebugManager.getInstance();
    if (parsed.data.enabled) dm.enableForKey(target.keyName);
    else dm.disableForKey(target.keyName);

    logger.info(
      `[AUDIT] trace ${parsed.data.enabled ? 'enabled' : 'disabled'} for key='${target.keyName}' by principal='${
        request.principal!.role === 'admin' ? 'admin' : request.principal!.keyName
      }'`
    );

    return reply.send({
      keyName: target.keyName,
      enabled: dm.isEnabledForKey(target.keyName),
      enabledGlobal: dm.isEnabled(),
    });
  });
}
