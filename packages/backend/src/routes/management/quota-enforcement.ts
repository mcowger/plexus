import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { QuotaEnforcer } from '../../services/quota/quota-enforcer';
import { ConfigService } from '../../services/config-service';
import { logger } from '../../utils/logger';
import {
  mostConstrained,
  resolveAttachedQuotaNames,
  serializeQuotaSnapshot,
} from './_quota-response';

/**
 * Register admin API endpoints for quota enforcement management.
 */
export async function registerQuotaEnforcementRoutes(
  fastify: FastifyInstance,
  quotaEnforcer: QuotaEnforcer
) {
  const configService = ConfigService.getInstance();

  /**
   * POST /v0/management/quota/clear
   * Reset quota usage for a key. With `quota` omitted, clears every quota
   * currently attached to the key (assigned, or default_quotas fallback).
   * With `quota` set, clears only that def — validated to be in the key's
   * resolved quota set first (the enforcer itself does not guard this).
   */
  fastify.post(
    '/v0/management/quota/clear',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = request.body as { key: string; quota?: string };

        if (!body.key) {
          return reply.code(400).send({
            error: {
              message: 'Missing required field: key',
              type: 'invalid_request_error',
            },
          });
        }

        await configService.flush();

        if (body.quota) {
          const config = configService.getConfig();
          const keyConfig = config.keys?.[body.key];
          if (!keyConfig) {
            return reply.code(404).send({
              error: {
                message: `Key not found: ${body.key}`,
                type: 'not_found_error',
              },
            });
          }
          const attached = resolveAttachedQuotaNames(keyConfig, config);
          if (!attached.includes(body.quota)) {
            return reply.code(400).send({
              error: {
                message: `Quota '${body.quota}' is not attached to key '${body.key}'`,
                type: 'invalid_request_error',
              },
            });
          }
        }

        await quotaEnforcer.clearQuota(body.key, body.quota);

        return reply.send({
          success: true,
          key: body.key,
          quota: body.quota ?? null,
          message: body.quota
            ? `Quota '${body.quota}' reset successfully`
            : 'Quota reset successfully',
        });
      } catch (error: any) {
        logger.error('Error clearing quota:', error);
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
   * POST /v0/management/quota/recompute
   * Repair a quota bucket by recomputing it from request_usage instead of
   * trusting the (potentially drifted) counter. Both `key` and `quota` are
   * required, and `quota` is validated to be in the key's resolved quota set
   * first, same as /quota/clear. Refused (400) for leaky rolling
   * tokens/requests quotas — see QuotaEnforcer.recomputeQuota.
   */
  fastify.post(
    '/v0/management/quota/recompute',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = request.body as { key?: string; quota?: string };

        if (!body.key || !body.quota) {
          return reply.code(400).send({
            error: {
              message: 'Missing required field(s): key, quota',
              type: 'invalid_request_error',
            },
          });
        }

        await configService.flush();
        const config = configService.getConfig();
        const keyConfig = config.keys?.[body.key];
        if (!keyConfig) {
          return reply.code(404).send({
            error: {
              message: `Key not found: ${body.key}`,
              type: 'not_found_error',
            },
          });
        }
        const attached = resolveAttachedQuotaNames(keyConfig, config);
        if (!attached.includes(body.quota)) {
          return reply.code(400).send({
            error: {
              message: `Quota '${body.quota}' is not attached to key '${body.key}'`,
              type: 'invalid_request_error',
            },
          });
        }

        const result = await quotaEnforcer.recomputeQuota(body.key, body.quota);

        if (!result.recomputed) {
          return reply.code(400).send({
            error: {
              message: `Failed to recompute quota '${body.quota}': ${result.reason}`,
              type: 'invalid_request_error',
            },
            reason: result.reason,
          });
        }

        return reply.send({
          success: true,
          key: body.key,
          quota: body.quota,
          usage: result.usage,
          windowStartMs: result.windowStartMs,
          message: `Quota '${body.quota}' recomputed successfully`,
        });
      } catch (error: any) {
        logger.error('Error recomputing quota:', error);
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
   * GET /v0/management/quota/status/:key
   * Get current quota status for a key. `quotas` is the full array-shaped
   * status (one entry per attached quota, including shared defs and
   * defaults-applied entries with `source: 'default'`); the top-level
   * `quota_name`/`allowed`/... fields are a legacy shim derived from the
   * most-constrained check, kept for wire compat.
   */
  fastify.get(
    '/v0/management/quota/status/:key',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { key } = request.params as { key: string };

        if (!key) {
          return reply.code(400).send({
            error: {
              message: 'Missing required parameter: key',
              type: 'invalid_request_error',
            },
          });
        }

        await configService.flush();
        const config = configService.getConfig();
        const keyConfig = config.keys?.[key];

        // Key not found
        if (!keyConfig) {
          return reply.code(404).send({
            error: {
              message: `Key not found: ${key}`,
              type: 'not_found_error',
            },
          });
        }

        // Get quota status
        const ctx = await quotaEnforcer.loadQuotaContext(key);
        const checks = ctx?.checks ?? [];
        const result = mostConstrained(checks);

        return reply.send({
          key,
          quotas: checks.map(serializeQuotaSnapshot),
          quota_name: result?.quotaName ?? null,
          allowed: result?.allowed ?? true,
          current_usage: result?.currentUsage ?? 0,
          limit: result?.limit ?? null,
          remaining: result?.remaining ?? null,
          resets_at: result ? new Date(result.resetsAtMs).toISOString() : null,
        });
      } catch (error: any) {
        logger.error('Error getting quota status:', error);
        return reply.code(500).send({
          error: {
            message: error.message || 'Internal server error',
            type: 'server_error',
          },
        });
      }
    }
  );
}
