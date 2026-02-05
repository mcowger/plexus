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
import { registerOAuthRoutes } from './management/oauth';
import { Dispatcher } from '../services/dispatcher';
import { QuotaScheduler } from '../services/quota/quota-scheduler';

export async function registerManagementRoutes(fastify: FastifyInstance, usageStorage: UsageStorageService, dispatcher: Dispatcher, quotaScheduler?: QuotaScheduler) {
    await registerConfigRoutes(fastify);
    await registerUsageRoutes(fastify, usageStorage);
    await registerCooldownRoutes(fastify);
    await registerPerformanceRoutes(fastify, usageStorage);
    await registerDebugRoutes(fastify, usageStorage);
    await registerErrorRoutes(fastify, usageStorage);
    await registerSystemLogRoutes(fastify);
    await registerTestRoutes(fastify, dispatcher);
    await registerOAuthRoutes(fastify);
    if (quotaScheduler) {
      await registerQuotaRoutes(fastify, quotaScheduler);
    }
}
