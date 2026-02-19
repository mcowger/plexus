/**
 * GET /api/v1/metrics/stream route handler
 * Unified SSE endpoint for real-time metrics
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { encode } from 'eventsource-encoder';
import { UsageStorageService } from '../../../services/usage-storage';
import { TimeRange } from './types';
import { fetchLiveRequests, fetchDashboardSeries, fetchWeeklyStats, fetchTodayMetrics, fetchProviderPerformanceRecords } from './queries';
import { computeLiveSnapshot, computeProviderPerformance, computeDashboardUsage, buildDashboardStats } from './aggregation';
import { getTimeRangeBounds } from './time';

interface StreamQuery {
    windowMinutes?: string;
    limit?: string;
}

function isKnownProvider(provider: unknown): boolean {
    if (typeof provider !== 'string') return false;
    const normalized = provider.trim().toLowerCase();
    return normalized !== '' && normalized !== 'unknown';
}

export function registerStreamRoute(
    fastify: FastifyInstance,
    usageStorage: UsageStorageService
): void {
    fastify.get('/api/v1/metrics/stream', async (request: FastifyRequest, reply: FastifyReply) => {
        const query = request.query as StreamQuery;
        const windowMinutes = Math.min(60, Math.max(1, parseInt(query.windowMinutes || '5', 10)));
        const limit = Math.min(5000, Math.max(50, parseInt(query.limit || '1200', 10)));

        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });

        // Send connected event
        reply.raw.write(encode({
            event: 'connected',
            data: JSON.stringify({
                type: 'connected',
                timestamp: Date.now(),
                data: { message: 'Connected to metrics stream', timestamp: Date.now() }
            }),
            id: String(Date.now())
        }));

        let isActive = true;
        const clients = new Set<() => void>();

        /**
         * Send an event to the client
         */
        const sendEvent = (eventType: string, data: unknown) => {
            if (!isActive || reply.raw.destroyed) return;
            try {
                reply.raw.write(encode({
                    event: eventType,
                    data: JSON.stringify({
                        type: eventType,
                        timestamp: Date.now(),
                        data
                    }),
                    id: String(Date.now())
                }));
            } catch (e: unknown) {
                request.log.error(e, 'Failed to send SSE event');
                isActive = false;
            }
        };

        /**
         * Build live dashboard snapshot
         */
        const buildLiveSnapshot = async () => {
            const windowStartMs = Date.now() - (windowMinutes * 60 * 1000);
            const records = await fetchLiveRequests(usageStorage, windowStartMs, limit);
            const snapshot = computeLiveSnapshot(records, windowMinutes);

            return {
                windowMinutes,
                ...snapshot
            };
        };

        /**
         * Build dashboard data
         */
        const buildDashboardData = async (timeRange: TimeRange) => {
            const { startTime } = getTimeRangeBounds(timeRange);
            const now = new Date();
            now.setSeconds(0, 0);

            const [seriesRows, weeklyStats, todayRow] = await Promise.all([
                fetchDashboardSeries(usageStorage, timeRange, startTime, now.getTime()),
                fetchWeeklyStats(usageStorage, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).getTime(), now.getTime()),
                fetchTodayMetrics(usageStorage, new Date(now.setHours(0, 0, 0, 0)).getTime())
            ]);

            const usageData = computeDashboardUsage(seriesRows, timeRange);
            const stats = buildDashboardStats(
                { requests: weeklyStats.requests, inputTokens: weeklyStats.inputTokens, outputTokens: weeklyStats.outputTokens },
                weeklyStats.avgDurationMs
            );

            return {
                stats,
                usageData,
                cooldowns: [],
                todayMetrics: {
                    requests: todayRow.requests,
                    inputTokens: todayRow.inputTokens,
                    outputTokens: todayRow.outputTokens,
                    reasoningTokens: todayRow.reasoningTokens,
                    cachedTokens: todayRow.cachedTokens,
                    totalCost: todayRow.totalCost
                },
                timeRange
            };
        };

        /**
         * Get provider performance data
         */
        const getProviderPerformance = async () => {
            const records = await fetchProviderPerformanceRecords(usageStorage);
            return computeProviderPerformance(records);
        };

        /**
         * Send initial data
         */
        const sendInitialData = async () => {
            try {
                const [snapshot, dashboard] = await Promise.all([
                    buildLiveSnapshot(),
                    buildDashboardData('day')
                ]);

                sendEvent('live_snapshot', snapshot);
                sendEvent('dashboard', dashboard);

                const performance = await getProviderPerformance();
                sendEvent('provider_performance', performance);
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                request.log.error({ error: msg }, 'Failed to send initial data');
            }
        };

        // Send initial data
        await sendInitialData();

        // Set up periodic data refresh
        const refreshInterval = setInterval(async () => {
            if (!isActive || reply.raw.destroyed) {
                clearInterval(refreshInterval);
                return;
            }

            try {
                const snapshot = await buildLiveSnapshot();
                sendEvent('live_snapshot', snapshot);
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                request.log.error({ error: msg }, 'Failed to refresh live snapshot');
            }
        }, 5000); // Refresh every 5 seconds

        // Set up dashboard refresh (less frequent)
        const dashboardInterval = setInterval(async () => {
            if (!isActive || reply.raw.destroyed) {
                clearInterval(dashboardInterval);
                return;
            }

            try {
                const dashboard = await buildDashboardData('day');
                sendEvent('dashboard', dashboard);

                const performance = await getProviderPerformance();
                sendEvent('provider_performance', performance);
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                request.log.error({ error: msg }, 'Failed to refresh dashboard');
            }
        }, 30000); // Refresh every 30 seconds

        // Keep connection alive with pings
        const pingInterval = setInterval(() => {
            if (!isActive || reply.raw.destroyed) {
                clearInterval(pingInterval);
                return;
            }
            sendEvent('ping', {});
        }, 10000); // Ping every 10 seconds

        // Listen for new usage records
        const usageListener = (record: unknown) => {
            const maybeRecord = record as { provider?: unknown };
            if (!isKnownProvider(maybeRecord.provider)) {
                return;
            }
            sendEvent('usage_update', record);
        };

        usageStorage.on('created', usageListener);
        clients.add(() => usageStorage.off('created', usageListener));

        // Clean up on close
        request.raw.on('close', () => {
            isActive = false;
            clearInterval(refreshInterval);
            clearInterval(dashboardInterval);
            clearInterval(pingInterval);
            clients.forEach(cleanup => cleanup());
            clients.clear();
            usageStorage.off('created', usageListener);
        });

        // Keep connection open
        while (isActive && !reply.raw.destroyed) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    });
}
