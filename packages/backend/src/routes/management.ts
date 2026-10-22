import { FastifyInstance } from 'fastify';

import { Dispatcher } from '../services/dispatch/dispatcher';
import { McpUsageStorageService } from '../services/mcp-proxy/mcp-usage-storage';
import { UsageStorageService } from '../services/observability/usage-storage';
import { ProbeService } from '../services/probes/probe-service';
import { QuotaEnforcer } from '../services/quota/quota-enforcer';
import { QuotaScheduler } from '../services/quota/quota-scheduler';
import { authenticate, ManagementAuthError, requireAdmin } from './management/_principal';
import { registerBackupRoutes } from './management/backup';
import { registerConcurrencyRoutes } from './management/concurrency';
import { registerConfigRoutes } from './management/config';
import { registerCooldownRoutes } from './management/cooldowns';
import { registerCustomCheckerRoutes } from './management/custom-checkers';
import { registerDebugRoutes } from './management/debug';
import { registerErrorRoutes } from './management/errors';
import { registerLoggingRoutes } from './management/logging';
import { registerMcpLogRoutes } from './management/mcp-logs';
import { registerMcpOAuthManagementRoutes } from './management/mcp-oauth';
import { registerMetricsRoutes } from './management/metrics';
import { registerModelRoutes } from './management/models';
import { registerOAuthRoutes } from './management/oauth';
import { registerPerformanceRoutes } from './management/performance';
import { registerProviderRoutes } from './management/providers';
import { registerQuotaEnforcementRoutes } from './management/quota-enforcement';
import { registerQuotaRoutes } from './management/quotas';
import { registerRestartRoutes } from './management/restart';
import { registerSelfRoutes } from './management/self';
import { registerSystemLogRoutes } from './management/system-logs';
import { registerTestRoutes } from './management/test';
import { registerUsageRoutes } from './management/usage';
import { registerUserQuotaRoutes } from './management/user-quotas';

export async function registerManagementRoutes(
  fastify: FastifyInstance,
  usageStorage: UsageStorageService,
  dispatcher: Dispatcher,
  probeService: ProbeService,
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
        excludedProviders: p.excludedProviders,
        excludedModels: p.excludedModels,
        quotaNames: p.quotaNames,
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
      await registerTestRoutes(adminOnly, probeService);
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
      await registerMcpOAuthManagementRoutes(adminOnly);
      if (quotaEnforcer) {
        await registerQuotaEnforcementRoutes(adminOnly, quotaEnforcer);
      }
      await registerUserQuotaRoutes(adminOnly);
      // Model routes for AI energy calculations
      await registerModelRoutes(adminOnly);
      // Backup and restore routes
      await registerBackupRoutes(adminOnly, usageStorage, mcpUsageStorage);
      // Concurrency (live snapshot + historical timeline)
      await registerConcurrencyRoutes(adminOnly, usageStorage);
      await registerCustomCheckerRoutes(adminOnly, quotaScheduler ?? QuotaScheduler.getInstance());
    });
  });
}
