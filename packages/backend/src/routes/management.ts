import { FastifyInstance } from 'fastify';
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
import { registerSelfRoutes } from './management/self';
import { authenticate, requireAdmin, ManagementAuthError } from './management/_principal';
import { registerModelRoutes } from './management/models';
import { Dispatcher } from '../services/dispatcher';
import { QuotaScheduler } from '../services/quota/quota-scheduler';
import { QuotaEnforcer } from '../services/quota/quota-enforcer';
import { McpUsageStorageService } from '../services/mcp-proxy/mcp-usage-storage';

export async function registerManagementRoutes(
  fastify: FastifyInstance,
  usageStorage: UsageStorageService,
  dispatcher: Dispatcher,
  quotaScheduler?: QuotaScheduler,
  mcpUsageStorage?: McpUsageStorageService,
  quotaEnforcer?: QuotaEnforcer
) {
  // Encapsulate all management routes in their own scope so the management
  // error handler doesn't collide with the global one (avoids FSTWRN004).
  fastify.register(async (mgmt) => {
    // Translate ManagementAuthError throws (from authenticate / requireAdmin) into
    // correctly-shaped 401/403 responses. In Fastify v5, async hooks must throw
    // rather than calling reply.send() to abort the hook chain.
    mgmt.setErrorHandler(async (error, _request, reply) => {
      if (error instanceof ManagementAuthError) {
        return reply.code(error.statusCode).send(error.authBody);
      }
      throw error;
    });

    // Verify endpoint runs the authentication hook but has no further checks,
    // so the login page can call it with a candidate credential. Returns
    // principal info (role + key metadata for limited users) on success.
    mgmt.get('/v0/management/auth/verify', { preHandler: authenticate }, async (request, reply) => {
      const p = request.principal!;
      if (p.role === 'admin') {
        return reply.send({ ok: true, role: 'admin' });
      }
      return reply.send({
        ok: true,
        role: 'limited',
        keyName: p.keyName,
        allowedProviders: p.allowedProviders,
        allowedModels: p.allowedModels,
        quotaName: p.quotaName ?? null,
        comment: p.comment ?? null,
      });
    });

    // Limited-user routes: authenticated, but not admin-gated. Handlers must
    // enforce their own scoping (or use requireAdmin where appropriate).
    mgmt.register(async (scoped) => {
      scoped.addHook('preHandler', authenticate);

      // Self-service: /self/me, /self/rotate, /self/comment, /self/debug/toggle,
      // /self/quota (limited users reading their own quota state).
      await registerSelfRoutes(scoped, quotaEnforcer);

      // Cooldowns: admin can clear any; limited restricted by allowedProviders.
      await registerCooldownRoutes(scoped);

      // Usage / Logs / Errors / Debug: handlers force-inject the limited user's
      // keyName as a filter.
      await registerUsageRoutes(scoped, usageStorage);
      await registerDebugRoutes(scoped, usageStorage);
      await registerErrorRoutes(scoped, usageStorage);
    });

    // Admin-only routes: mutating config, system-level controls, etc.
    mgmt.register(async (adminOnly) => {
      adminOnly.addHook('preHandler', authenticate);
      adminOnly.addHook('preHandler', requireAdmin);

      await registerConfigRoutes(adminOnly, usageStorage);
      await registerSystemLogRoutes(adminOnly);
      await registerTestRoutes(adminOnly, dispatcher);
      await registerOAuthRoutes(adminOnly);
      await registerLoggingRoutes(adminOnly);
      await registerRestartRoutes(adminOnly);
      await registerProviderRoutes(adminOnly);
      await registerMetricsRoutes(adminOnly, usageStorage);
      await registerPerformanceRoutes(adminOnly, usageStorage);
      if (quotaScheduler) {
        await registerQuotaRoutes(adminOnly, quotaScheduler);
      }
      if (mcpUsageStorage) {
        await registerMcpLogRoutes(adminOnly, mcpUsageStorage);
      }
      if (quotaEnforcer) {
        await registerQuotaEnforcementRoutes(adminOnly, quotaEnforcer);
      }
      await registerUserQuotaRoutes(adminOnly);
      // Model routes for AI energy calculations
      await registerModelRoutes(adminOnly);
    });
  });
}
