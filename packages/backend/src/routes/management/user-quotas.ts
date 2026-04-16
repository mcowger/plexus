import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../../utils/logger';
import { QuotaDefinition, QuotaDefinitionSchema } from '../../config';
import { ConfigService } from '../../services/config-service';

/**
 * Register API endpoints for user quota management.
 */
export async function registerUserQuotaRoutes(fastify: FastifyInstance) {
  const configService = ConfigService.getInstance();

  /**
   * GET /v0/management/user-quotas
   * List all user quota definitions.
   */
  fastify.get(
    '/v0/management/user-quotas',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const quotas = await configService.getRepository().getAllUserQuotas();
        return reply.send(quotas);
      } catch (error: any) {
        logger.error('[UserQuota] Error listing quotas:', error);
        return reply.code(500).send({
          error: {
            message: error.message || 'Internal server error',
            type: 'server_error',
          },
        });
      }
    }
  );

  /**
   * GET /v0/management/user-quotas/:name
   * Get a specific quota definition.
   */
  fastify.get(
    '/v0/management/user-quotas/:name',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { name } = request.params as { name: string };
        const quotas = await configService.getRepository().getAllUserQuotas();

        const quota = quotas[name];
        if (!quota) {
          return reply.code(404).send({
            error: {
              message: `Quota not found: ${name}`,
              type: 'not_found_error',
            },
          });
        }

        return reply.send({ name, ...quota });
      } catch (error: any) {
        logger.error('[UserQuota] Error getting quota:', error);
        return reply.code(500).send({
          error: {
            message: error.message || 'Internal server error',
            type: 'server_error',
          },
        });
      }
    }
  );

  /**
   * PUT /v0/management/user-quotas/:name
   * Create or replace a quota definition (full, validated).
   */
  fastify.put(
    '/v0/management/user-quotas/:name',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { name } = request.params as { name: string };

      if (!/^[a-z0-9][a-z0-9-_]{1,62}$/.test(name)) {
        return reply.code(400).send({
          error: {
            message:
              'Invalid quota name. Must be a slug (lowercase letters, numbers, hyphens, underscores, 2-63 characters)',
            type: 'invalid_request_error',
          },
        });
      }

      const result = QuotaDefinitionSchema.safeParse(request.body);
      if (!result.success) {
        return reply.code(400).send({
          error: { message: 'Validation failed', type: 'invalid_request_error' },
          details: result.error.issues,
        });
      }

      try {
        await configService.saveUserQuota(name, result.data);
        logger.info(`[UserQuota] Quota '${name}' saved via API (PUT)`);
        return reply.send({ success: true, name, quota: result.data });
      } catch (e: any) {
        logger.error(`[UserQuota] Failed to save quota`, e);
        return reply.code(500).send({ error: { message: e.message, type: 'server_error' } });
      }
    }
  );

  /**
   * PATCH /v0/management/user-quotas/:name
   * Partially update a quota definition — merges into existing then validates.
   */
  fastify.patch(
    '/v0/management/user-quotas/:name',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { name } = request.params as { name: string };
        const updates = request.body as Partial<QuotaDefinition>;

        const quotas = await configService.getRepository().getAllUserQuotas();
        const existing = quotas[name];

        if (!existing) {
          return reply.code(404).send({
            error: { message: `Quota not found: ${name}`, type: 'not_found_error' },
          });
        }

        const merged = { ...existing, ...updates };
        const result = QuotaDefinitionSchema.safeParse(merged);
        if (!result.success) {
          return reply.code(400).send({
            error: { message: 'Validation failed', type: 'invalid_request_error' },
            details: result.error.issues,
          });
        }

        await configService.saveUserQuota(name, result.data);
        logger.info(`[UserQuota] Quota '${name}' updated via API (PATCH)`);
        return reply.send({ success: true, name, quota: result.data });
      } catch (e: any) {
        logger.error(`[UserQuota] Failed to update quota`, e);
        return reply.code(500).send({ error: { message: e.message, type: 'server_error' } });
      }
    }
  );

  /**
   * DELETE /v0/management/user-quotas/:name
   * Delete a quota definition.
   */
  fastify.delete(
    '/v0/management/user-quotas/:name',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { name } = request.params as { name: string };

        const quotas = await configService.getRepository().getAllUserQuotas();
        if (!quotas[name]) {
          return reply.code(404).send({
            error: {
              message: `Quota not found: ${name}`,
              type: 'not_found_error',
            },
          });
        }

        // Check if any keys are using this quota
        const keys = await configService.getRepository().getAllKeys();
        const keysUsingQuota = Object.entries(keys)
          .filter(([, keyConfig]) => keyConfig.quota === name)
          .map(([keyName]) => keyName);

        if (keysUsingQuota.length > 0) {
          return reply.code(409).send({
            error: {
              message: `Cannot delete quota '${name}'. It is assigned to the following keys: ${keysUsingQuota.join(', ')}`,
              type: 'conflict_error',
            },
          });
        }

        await configService.deleteUserQuota(name);
        logger.info(`[UserQuota] Quota '${name}' deleted via API`);

        return reply.send({
          success: true,
          name,
          message: `Quota '${name}' deleted successfully`,
        });
      } catch (e: any) {
        logger.error(`[UserQuota] Failed to delete quota`, e);
        return reply.code(500).send({
          error: {
            message: e.message,
            type: 'server_error',
          },
        });
      }
    }
  );
}
