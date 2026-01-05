import { FastifyInstance } from 'fastify';
import { encode } from 'eventsource-encoder';
import { logger, logEmitter } from '../utils/logger';
import { getConfigPath, validateConfig, loadConfig } from '../config';
import { UsageStorageService } from '../services/usage-storage';
import { CooldownManager } from '../services/cooldown-manager';
import { DebugManager } from '../services/debug-manager';
import { z } from 'zod';

export async function registerManagementRoutes(fastify: FastifyInstance, usageStorage: UsageStorageService) {
    // --- Management API (v0) ---

    fastify.get('/v0/management/config', async (request, reply) => {
        const configPath = getConfigPath();
        if (!configPath) {
            return reply.code(404).send({ error: "Configuration file path not found" });
        }
        const file = Bun.file(configPath);
        if (!(await file.exists())) {
            return reply.code(404).send({ error: "Configuration file not found" });
        }
        const configContent = await file.text();
        reply.header('Content-Type', 'application/x-yaml');
        return reply.send(configContent);
    });

    fastify.post('/v0/management/config', async (request, reply) => {
        const configPath = getConfigPath();
        if (!configPath) {
             return reply.code(500).send({ error: "Configuration path not determined" });
        }

        try {
            const body = request.body as string; 
            let configStr = body;
            if (typeof body !== 'string') {
                 configStr = JSON.stringify(body);
            }

            try {
                validateConfig(configStr);
            } catch (e) {
                if (e instanceof z.ZodError) {
                    return reply.code(400).send({ error: "Validation failed", details: e.errors });
                }
                 return reply.code(400).send({ error: "Invalid YAML or Schema", details: String(e) });
            }

            await Bun.write(configPath, configStr);
            logger.info(`Configuration updated via API at ${configPath}`);
            await loadConfig(configPath);
            
            return reply.code(200).header('Content-Type', 'application/x-yaml').send(configStr);
        } catch (e: any) {
            logger.error("Failed to update config", e);
            return reply.code(500).send({ error: e.message });
        }
    });

    // Support YAML and Plain Text payloads for management API
    fastify.addContentTypeParser(['text/plain', 'application/x-yaml', 'text/yaml'], { parseAs: 'string' }, (req, body, done) => {
        done(null, body);
    });

    fastify.get('/v0/management/usage', (request, reply) => {
        const query = request.query as any;
        const limit = parseInt(query.limit || '50');
        const offset = parseInt(query.offset || '0');

        const filters: any = {
            startDate: query.startDate,
            endDate: query.endDate,
            incomingApiType: query.incomingApiType,
            provider: query.provider,
            incomingModelAlias: query.incomingModelAlias,
            selectedModelName: query.selectedModelName,
            outgoingApiType: query.outgoingApiType,
            responseStatus: query.responseStatus
        };

        if (query.minDurationMs) filters.minDurationMs = parseInt(query.minDurationMs);
        if (query.maxDurationMs) filters.maxDurationMs = parseInt(query.maxDurationMs);

        try {
            const result = usageStorage.getUsage(filters, { limit, offset });
            return reply.send(result);
        } catch (e: any) {
            return reply.code(500).send({ error: e.message });
        }
    });

    fastify.delete('/v0/management/usage', (request, reply) => {
        const query = request.query as any;
        const olderThanDays = query.olderThanDays;
        let beforeDate: Date | undefined;

        if (olderThanDays) {
            const days = parseInt(olderThanDays);
            if (!isNaN(days)) {
                beforeDate = new Date();
                beforeDate.setDate(beforeDate.getDate() - days);
            }
        }

        const success = usageStorage.deleteAllUsageLogs(beforeDate);
        if (!success) return reply.code(500).send({ error: "Failed to delete usage logs" });
        return reply.send({ success: true });
    });

    fastify.delete('/v0/management/usage/:requestId', (request, reply) => {
        const params = request.params as any;
        const requestId = params.requestId;
        const success = usageStorage.deleteUsageLog(requestId);
        if (!success) return reply.code(404).send({ error: "Usage log not found or could not be deleted" });
        return reply.send({ success: true });
    });

    fastify.get('/v0/management/events', async (request, reply) => {
        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });

        const listener = async (record: any) => {
            if (reply.raw.destroyed) return;
            reply.raw.write(encode({
                data: JSON.stringify(record),
                event: 'log',
                id: String(Date.now()),
            }));
        };

        usageStorage.on('created', listener);

        request.raw.on('close', () => {
            usageStorage.off('created', listener);
        });

        // Keep connection alive with periodic pings
        while (!request.raw.destroyed) {
            await new Promise(resolve => setTimeout(resolve, 10000));
            if (!reply.raw.destroyed) {
                reply.raw.write(encode({
                    event: 'ping',
                    data: 'pong',
                    id: String(Date.now())
                }));
            }
        }
    });

    fastify.get('/v0/management/cooldowns', (request, reply) => {
        const cooldowns = CooldownManager.getInstance().getCooldowns();
        return reply.send(cooldowns);
    });

    fastify.delete('/v0/management/cooldowns', (request, reply) => {
        CooldownManager.getInstance().clearCooldown();
        return reply.send({ success: true });
    });

    fastify.delete('/v0/management/cooldowns/:provider', (request, reply) => {
        const params = request.params as any;
        const provider = params.provider;
        CooldownManager.getInstance().clearCooldown(provider);
        return reply.send({ success: true });
    });

    fastify.get('/v0/management/performance', (request, reply) => {
        const query = request.query as any;
        const provider = query.provider;
        const model = query.model;
        
        const performance = usageStorage.getProviderPerformance(provider, model);
        return reply.send(performance);
    });

    fastify.get('/v0/management/debug', (request, reply) => {
        return reply.send({ enabled: DebugManager.getInstance().isEnabled() });
    });

    fastify.post('/v0/management/debug', async (request, reply) => {
        const body = request.body as any;
        if (typeof body.enabled === 'boolean') {
            DebugManager.getInstance().setEnabled(body.enabled);
            return reply.send({ enabled: DebugManager.getInstance().isEnabled() });
        }
        return reply.code(400).send({ error: "Invalid body. Expected { enabled: boolean }" });
    });

    fastify.get('/v0/management/debug/logs', (request, reply) => {
        const query = request.query as any;
        const limit = parseInt(query.limit || '50');
        const offset = parseInt(query.offset || '0');
        return reply.send(usageStorage.getDebugLogs(limit, offset));
    });

    fastify.delete('/v0/management/debug/logs', (request, reply) => {
        const success = usageStorage.deleteAllDebugLogs();
        if (!success) return reply.code(500).send({ error: "Failed to delete logs" });
        return reply.send({ success: true });
    });

    fastify.get('/v0/management/debug/logs/:requestId', (request, reply) => {
        const params = request.params as any;
        const requestId = params.requestId;
        const log = usageStorage.getDebugLog(requestId);
        if (!log) return reply.code(404).send({ error: "Log not found" });
        return reply.send(log);
    });

    fastify.delete('/v0/management/debug/logs/:requestId', (request, reply) => {
        const params = request.params as any;
        const requestId = params.requestId;
        const success = usageStorage.deleteDebugLog(requestId);
        if (!success) return reply.code(404).send({ error: "Log not found or could not be deleted" });
        return reply.send({ success: true });
    });

    fastify.get('/v0/management/errors', (request, reply) => {
        const query = request.query as any;
        const limit = parseInt(query.limit || '50');
        const offset = parseInt(query.offset || '0');
        return reply.send(usageStorage.getErrors(limit, offset));
    });

    fastify.delete('/v0/management/errors', (request, reply) => {
        const success = usageStorage.deleteAllErrors();
        if (!success) return reply.code(500).send({ error: "Failed to delete error logs" });
        return reply.send({ success: true });
    });

    fastify.delete('/v0/management/errors/:requestId', (request, reply) => {
        const params = request.params as any;
        const requestId = params.requestId;
        const success = usageStorage.deleteError(requestId);
        if (!success) return reply.code(404).send({ error: "Error log not found or could not be deleted" });
        return reply.send({ success: true });
    });

    fastify.get('/v0/system/logs/stream', async (request, reply) => {
        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });

        const listener = async (log: any) => {
            if (reply.raw.destroyed) return;
            reply.raw.write(encode({
                data: JSON.stringify(log),
                event: 'syslog',
                id: String(Date.now()),
            }));
        };

        logEmitter.on('log', listener);

        request.raw.on('close', () => {
            logEmitter.off('log', listener);
        });

        while (!request.raw.destroyed) {
            await new Promise(resolve => setTimeout(resolve, 10000));
            if (!reply.raw.destroyed) {
                reply.raw.write(encode({
                    event: 'ping',
                    data: 'pong',
                    id: String(Date.now())
                }));
            }
        }
    });
}
