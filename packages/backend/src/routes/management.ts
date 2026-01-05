import { FastifyInstance } from 'fastify';
import { UsageStorageService } from '../services/usage-storage';
import { registerConfigRoutes } from './management/config';
import { registerUsageRoutes } from './management/usage';
import { registerCooldownRoutes } from './management/cooldowns';
import { registerPerformanceRoutes } from './management/performance';
import { registerDebugRoutes } from './management/debug';
import { registerErrorRoutes } from './management/errors';
import { registerSystemLogRoutes } from './management/system-logs';

export async function registerManagementRoutes(fastify: FastifyInstance, usageStorage: UsageStorageService) {
    await registerConfigRoutes(fastify);
    await registerUsageRoutes(fastify, usageStorage);
    await registerCooldownRoutes(fastify);
    await registerPerformanceRoutes(fastify, usageStorage);
    await registerDebugRoutes(fastify, usageStorage);
    await registerErrorRoutes(fastify, usageStorage);
    await registerSystemLogRoutes(fastify);
}