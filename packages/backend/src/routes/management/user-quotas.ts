import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import yaml from 'yaml';
import { logger } from '../../utils/logger';
import {
  getConfigPath,
  validateConfig,
  loadConfig,
  getConfig,
  QuotaDefinition,
} from '../../config';

/**
 * Register API endpoints for user quota management.
 */
export async function registerUserQuotaRoutes(fastify: FastifyInstance) {
  /**
   * GET /v0/management/user-quotas
   * List all user quota definitions.
   */
  fastify.get(
    '/v0/management/user-quotas',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const config = getConfig();
        const quotas = config.user_quotas || {};

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
        const config = getConfig();
        const quotas = config.user_quotas || {};

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
   * POST /v0/management/user-quotas/:name
   * Create or update a quota definition.
   */
  fastify.post(
    '/v0/management/user-quotas/:name',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const configPath = getConfigPath();
      if (!configPath) {
        return reply.code(500).send({ error: 'Configuration path not determined' });
      }

      try {
        const { name } = request.params as { name: string };
        const body = request.body as QuotaDefinition;

        // Validate quota name (slug pattern)
        if (!/^[a-z0-9][a-z0-9-_]{1,62}$/.test(name)) {
          return reply.code(400).send({
            error: {
              message:
                'Invalid quota name. Must be a slug (lowercase letters, numbers, hyphens, underscores, 2-63 characters)',
              type: 'invalid_request_error',
            },
          });
        }

        // Validate required fields
        if (!body.type || !['rolling', 'daily', 'weekly'].includes(body.type)) {
          return reply.code(400).send({
            error: {
              message: 'Invalid or missing quota type. Must be one of: rolling, daily, weekly',
              type: 'invalid_request_error',
            },
          });
        }

        if (!body.limitType || !['requests', 'tokens'].includes(body.limitType)) {
          return reply.code(400).send({
            error: {
              message: 'Invalid or missing limitType. Must be one of: requests, tokens',
              type: 'invalid_request_error',
            },
          });
        }

        if (!body.limit || typeof body.limit !== 'number' || body.limit < 1) {
          return reply.code(400).send({
            error: {
              message: 'Invalid or missing limit. Must be a positive number',
              type: 'invalid_request_error',
            },
          });
        }

        // Rolling quotas require duration
        if (body.type === 'rolling' && (!body.duration || typeof body.duration !== 'string')) {
          return reply.code(400).send({
            error: {
              message: 'Rolling quotas require a duration field (e.g., "1h", "30m", "1d")',
              type: 'invalid_request_error',
            },
          });
        }

        const file = Bun.file(configPath);
        if (!(await file.exists())) {
          return reply.code(404).send({ error: 'Configuration file not found' });
        }

        const configContent = await file.text();
        const parsed = (yaml.parse(configContent) as any) || {};

        if (!parsed.user_quotas) {
          parsed.user_quotas = {};
        }

        // Create or update quota
        parsed.user_quotas[name] = body;

        const updatedConfig = yaml.stringify(parsed);

        // Validate before saving
        try {
          validateConfig(updatedConfig);
        } catch (e) {
          return reply.code(400).send({
            error: {
              message: 'Configuration validation failed',
              type: 'validation_error',
            },
          });
        }

        await Bun.write(configPath, updatedConfig);
        logger.info(`[UserQuota] Quota '${name}' saved via API at ${configPath}`);
        await loadConfig(configPath);

        return reply.send({
          success: true,
          name,
          quota: body,
        });
      } catch (e: any) {
        logger.error(`[UserQuota] Failed to save quota`, e);
        return reply.code(500).send({
          error: {
            message: e.message,
            type: 'server_error',
          },
        });
      }
    }
  );

  /**
   * PATCH /v0/management/user-quotas/:name
   * Partially update a quota definition.
   */
  fastify.patch(
    '/v0/management/user-quotas/:name',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const configPath = getConfigPath();
      if (!configPath) {
        return reply.code(500).send({ error: 'Configuration path not determined' });
      }

      try {
        const { name } = request.params as { name: string };
        const updates = request.body as Partial<QuotaDefinition>;

        const file = Bun.file(configPath);
        if (!(await file.exists())) {
          return reply.code(404).send({ error: 'Configuration file not found' });
        }

        const configContent = await file.text();
        const parsed = (yaml.parse(configContent) as any) || {};

        if (!parsed.user_quotas || !parsed.user_quotas[name]) {
          return reply.code(404).send({
            error: {
              message: `Quota not found: ${name}`,
              type: 'not_found_error',
            },
          });
        }

        // Merge existing with updates
        const existing = parsed.user_quotas[name];
        parsed.user_quotas[name] = { ...existing, ...updates };

        const updatedConfig = yaml.stringify(parsed);

        // Validate before saving
        try {
          validateConfig(updatedConfig);
        } catch (e) {
          return reply.code(400).send({
            error: {
              message: 'Configuration validation failed',
              type: 'validation_error',
            },
          });
        }

        await Bun.write(configPath, updatedConfig);
        logger.info(`[UserQuota] Quota '${name}' updated via API at ${configPath}`);
        await loadConfig(configPath);

        return reply.send({
          success: true,
          name,
          quota: parsed.user_quotas[name],
        });
      } catch (e: any) {
        logger.error(`[UserQuota] Failed to update quota`, e);
        return reply.code(500).send({
          error: {
            message: e.message,
            type: 'server_error',
          },
        });
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
      const configPath = getConfigPath();
      if (!configPath) {
        return reply.code(500).send({ error: 'Configuration path not determined' });
      }

      try {
        const { name } = request.params as { name: string };

        const file = Bun.file(configPath);
        if (!(await file.exists())) {
          return reply.code(404).send({ error: 'Configuration file not found' });
        }

        const configContent = await file.text();
        const parsed = (yaml.parse(configContent) as any) || {};

        if (!parsed.user_quotas || !parsed.user_quotas[name]) {
          return reply.code(404).send({
            error: {
              message: `Quota not found: ${name}`,
              type: 'not_found_error',
            },
          });
        }

        // Check if any keys are using this quota
        const keys = parsed.keys || {};
        const keysUsingQuota = Object.entries(keys)
          .filter(([, keyConfig]: [string, any]) => keyConfig.quota === name)
          .map(([keyName]) => keyName);

        if (keysUsingQuota.length > 0) {
          return reply.code(409).send({
            error: {
              message: `Cannot delete quota '${name}'. It is assigned to the following keys: ${keysUsingQuota.join(', ')}`,
              type: 'conflict_error',
            },
          });
        }

        delete parsed.user_quotas[name];

        const updatedConfig = yaml.stringify(parsed);
        validateConfig(updatedConfig);

        await Bun.write(configPath, updatedConfig);
        logger.info(`[UserQuota] Quota '${name}' deleted via API at ${configPath}`);
        await loadConfig(configPath);

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
