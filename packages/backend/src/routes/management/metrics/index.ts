/**
 * Metrics module - exports the main register function
 * Breaks up the monolithic metrics.ts into logical modules:
 * - types: Type definitions and constants
 * - cache: Caching utilities
 * - time: Time range utilities
 * - queries: Database queries using Drizzle ORM
 * - aggregation: Data aggregation and processing logic
 * - routes/*: Individual route handlers
 * - stream: SSE stream handler
 */

import { FastifyInstance } from 'fastify';
import { UsageStorageService } from '../../../services/usage-storage';
import { registerChartDataRoute, registerAggregatedRoute, registerStatsRoute } from './routes';
import { registerStreamRoute } from './stream';

export async function registerMetricsRoutes(
    fastify: FastifyInstance,
    usageStorage: UsageStorageService
): Promise<void> {
    // Register all routes
    registerChartDataRoute(fastify, usageStorage);
    registerAggregatedRoute(fastify, usageStorage);
    registerStatsRoute(fastify, usageStorage);
    registerStreamRoute(fastify, usageStorage);
}

// Re-export types for consumers
export * from './types';
export * from './cache';
export * from './time';
export * from './queries';
export * from './aggregation';
