import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { logger } from '../utils/logger';
import { UsageStorageService } from '../services/usage-storage';
import { registerConfigRoutes } from './management/config';
import { registerUsageRoutes } from './management/usage';
import { registerCooldownRoutes } from './management/cooldowns';
import { registerPerformanceRoutes } from './management/performance';
import { registerDebugRoutes } from './management/debug';
import { registerErrorRoutes } from './management/errors';
import { registerSystemLogRoutes } from './management/system-logs';
import { registerTestRoutes } from './management/test';
import { registerQuotaRoutes } from './management/quotas';
import { registerQuotaEnforcementRoutes } from './management/quota-enforcement';
import { registerUserQuotaRoutes } from './management/user-quotas';
import { registerOAuthRoutes } from './management/oauth';
import { registerMcpLogRoutes } from './management/mcp-logs';
import { registerLoggingRoutes } from './management/logging';
import { registerRestartRoutes } from './management/restart';
import { registerProviderRoutes } from './management/providers';
import { registerMetricsRoutes } from './management/metrics';
import { Dispatcher } from '../services/dispatcher';
import { QuotaScheduler } from '../services/quota/quota-scheduler';
import { QuotaEnforcer } from '../services/quota/quota-enforcer';
import { McpUsageStorageService } from '../services/mcp-proxy/mcp-usage-storage';

function adminKeyAuth(request: FastifyRequest, reply: FastifyReply, done: () => void) {
  const providedKey = request.headers['x-admin-key'];
  const adminKey = process.env.ADMIN_KEY;

  if (!providedKey || providedKey !== adminKey) {
    logger.silly(
      `[ADMIN AUTH] Rejected request to ${request.url} - invalid or missing x-admin-key`
    );
    reply.code(401).send({ error: { message: 'Unauthorized', type: 'auth_error', code: 401 } });
    return;
  }

  logger.silly(`[ADMIN AUTH] Accepted request to ${request.url}`);
  done();
}

export async function registerManagementRoutes(
  fastify: FastifyInstance,
  usageStorage: UsageStorageService,
  dispatcher: Dispatcher,
  quotaScheduler?: QuotaScheduler,
  mcpUsageStorage?: McpUsageStorageService,
  quotaEnforcer?: QuotaEnforcer
) {
  // Verify endpoint is outside the auth scope so the login page can call it
  // with the candidate key and get a 200/401 back.
  fastify.get(
    '/v0/management/auth/verify',
    { preHandler: adminKeyAuth },
    async (_request, reply) => {
      return reply.send({ ok: true });
    }
  );

  // All other management routes are protected by the same admin key hook,
  // scoped inside this plugin so the v1 bearer-auth routes are unaffected.
  fastify.register(async (protected_) => {
    protected_.addHook('preHandler', adminKeyAuth);

    await registerConfigRoutes(protected_);
    await registerUsageRoutes(protected_, usageStorage);
    await registerCooldownRoutes(protected_);
    await registerPerformanceRoutes(protected_, usageStorage);
    await registerDebugRoutes(protected_, usageStorage);
    await registerErrorRoutes(protected_, usageStorage);
    await registerSystemLogRoutes(protected_);
    await registerTestRoutes(protected_, dispatcher);
    await registerOAuthRoutes(protected_);
    await registerLoggingRoutes(protected_);
    await registerRestartRoutes(protected_);
    await registerProviderRoutes(protected_);
    await registerMetricsRoutes(protected_, usageStorage);
    if (quotaScheduler) {
      await registerQuotaRoutes(protected_, quotaScheduler);
    }
    if (mcpUsageStorage) {
      await registerMcpLogRoutes(protected_, mcpUsageStorage);
    }
    if (quotaEnforcer) {
      await registerQuotaEnforcementRoutes(protected_, quotaEnforcer);
    }
    await registerUserQuotaRoutes(protected_);
  });
}
