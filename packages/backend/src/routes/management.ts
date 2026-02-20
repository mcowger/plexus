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
import { Dispatcher } from '../services/dispatcher';
import { QuotaScheduler } from '../services/quota/quota-scheduler';
import { QuotaEnforcer } from '../services/quota/quota-enforcer';
import { McpUsageStorageService } from '../services/mcp-proxy/mcp-usage-storage';

export async function registerManagementRoutes(fastify: FastifyInstance, usageStorage: UsageStorageService, dispatcher: Dispatcher, quotaScheduler?: QuotaScheduler, mcpUsageStorage?: McpUsageStorageService, quotaEnforcer?: QuotaEnforcer) {
    await registerConfigRoutes(fastify);
    await registerUsageRoutes(fastify, usageStorage);
    await registerCooldownRoutes(fastify);
    await registerPerformanceRoutes(fastify, usageStorage);
    await registerDebugRoutes(fastify, usageStorage);
    await registerErrorRoutes(fastify, usageStorage);
    await registerSystemLogRoutes(fastify);
    await registerTestRoutes(fastify, dispatcher);
    await registerOAuthRoutes(fastify);
    await registerLoggingRoutes(fastify);
    if (quotaScheduler) {
      await registerQuotaRoutes(fastify, quotaScheduler);
    }
    if (mcpUsageStorage) {
      await registerMcpLogRoutes(fastify, mcpUsageStorage);
    }
    if (quotaEnforcer) {
      await registerQuotaEnforcementRoutes(fastify, quotaEnforcer);
    }
    await registerUserQuotaRoutes(fastify);
}
