import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { logger, logEmitter } from './utils/logger';
import { loadConfig, getConfig, getConfigPath, validateConfig } from './config';
import { Dispatcher } from './services/dispatcher';
import { AnthropicTransformer, OpenAITransformer, GeminiTransformer } from './transformers';
import { UsageStorageService } from './services/usage-storage';
import { UsageRecord } from './types/usage';
import { handleResponse } from './utils/response-handler';
import { getClientIp } from './utils/ip';
import { z } from 'zod';
import { CooldownManager } from './services/cooldown-manager';
import { DebugManager } from './services/debug-manager';
import { PricingManager } from './services/pricing-manager';
import { SelectorFactory } from './services/selectors/factory';
import { requestLogger } from './middleware/log';

/**
 * Plexus Backend Server
 * 
 * Powered by Fastify and Bun.
 * This server acts as a unified gateway for various LLM providers,
 * handling request transformation, load balancing, and usage tracking.
 */

const fastify = Fastify({
    logger: false // We use a custom winston-based logger
});

// --- Plugin Registration ---

// Enable CORS for all origins to support dashboard and external client access
fastify.register(cors, {
    origin: '*', 
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-admin-key', 'x-goog-api-key'],
    exposedHeaders: ['Content-Type']
});

// --- Service Initialization ---

const dispatcher = new Dispatcher();
const usageStorage = new UsageStorageService();

// Initialize singletons with storage dependencies
CooldownManager.getInstance().setStorage(usageStorage);
DebugManager.getInstance().setStorage(usageStorage);
SelectorFactory.setUsageStorage(usageStorage);

// Bootstrap configuration and pricing data
try {
    await loadConfig();
    await PricingManager.getInstance().loadPricing();
} catch (e) {
    logger.error('Failed to load config or pricing', e);
    process.exit(1);
}

// --- Hooks & Global Logic ---

// Global Request Logger: Runs on every incoming request
fastify.addHook('onRequest', requestLogger);

/**
 * Global Error Handler
 * Normalizes errors into a consistent JSON format compatible with AI API standards.
 * Prevents double-sending responses by checking reply.sent.
 */
fastify.setErrorHandler((error, request, reply) => {
    if (reply.sent) {
        logger.error('Error occurred after response was sent', error);
        return;
    }

    logger.error('Unhandled Fastify Error', error);
    
    if (error.validation) {
        return reply.code(400).send({
            error: {
                message: "Validation Error",
                details: error.validation
            }
        });
    }

    reply.code(error.statusCode || 500).send({
        error: {
            message: error.message || "Internal Server Error",
            type: "api_error"
        }
    });
});

// --- Routes: v1 (Inference API) ---

/**
 * GET /v1/models
 * Returns a list of available model aliases configured in plexus.yaml.
 * Matches the OpenAI models list format.
 */
fastify.get('/v1/models', async (request, reply) => {
    const config = getConfig();
    const models = Object.keys(config.models).map(id => ({
        id,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'plexus'
    }));
    
    return reply.send({
        object: 'list',
        data: models
    });
});

/**
 * POST /v1/chat/completions
 * OpenAI Compatible Endpoint.
 * Translates OpenAI format to internal Unified format, dispatches to target,
 * and translates the response back to OpenAI format.
 */
fastify.post('/v1/chat/completions', async (request, reply) => {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    let usageRecord: Partial<UsageRecord> = {
        requestId,
        date: new Date().toISOString(),
        sourceIp: getClientIp(request),
        incomingApiType: 'chat',
        startTime,
        isStreamed: false,
        responseStatus: 'pending'
    };

    try {
        const body = request.body as any;
        usageRecord.incomingModelAlias = body.model;
        const authHeader = request.headers.authorization;
        usageRecord.apiKey = authHeader ? authHeader.replace('Bearer ', '').substring(0, 8) + '...' : null;

        logger.silly('Incoming OpenAI Request', body);
        const transformer = new OpenAITransformer();
        const unifiedRequest = await transformer.parseRequest(body);
        unifiedRequest.incomingApiType = 'chat';
        unifiedRequest.originalBody = body;
        unifiedRequest.requestId = requestId;
        
        const unifiedResponse = await dispatcher.dispatch(unifiedRequest);
        
        return await handleResponse(
            reply,
            unifiedResponse,
            transformer,
            usageRecord,
            usageStorage,
            startTime,
            'chat'
        );
    } catch (e: any) {
        usageRecord.responseStatus = 'error';
        usageRecord.durationMs = Date.now() - startTime;
        usageStorage.saveRequest(usageRecord as UsageRecord);
        usageStorage.saveError(requestId, e, { apiType: 'chat' });

        logger.error('Error processing OpenAI request', e);
        return reply.code(500).send({ error: { message: e.message, type: 'api_error' } });
    }
});

/**
 * POST /v1/messages
 * Anthropic Compatible Endpoint.
 */
fastify.post('/v1/messages', async (request, reply) => {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    let usageRecord: Partial<UsageRecord> = {
        requestId,
        date: new Date().toISOString(),
        sourceIp: getClientIp(request),
        incomingApiType: 'messages',
        startTime,
        isStreamed: false,
        responseStatus: 'pending'
    };

    try {
        const body = request.body as any;
        usageRecord.incomingModelAlias = body.model;
        const authHeader = request.headers['x-api-key'] as string;
        usageRecord.apiKey = authHeader ? authHeader.substring(0, 8) + '...' : null;

        logger.silly('Incoming Anthropic Request', body);
        const transformer = new AnthropicTransformer();
        const unifiedRequest = await transformer.parseRequest(body);
        unifiedRequest.incomingApiType = 'messages';
        unifiedRequest.originalBody = body;
        unifiedRequest.requestId = requestId;

        DebugManager.getInstance().startLog(requestId, body);
        
        const unifiedResponse = await dispatcher.dispatch(unifiedRequest);
        
        return await handleResponse(
            reply,
            unifiedResponse,
            transformer,
            usageRecord,
            usageStorage,
            startTime,
            'messages'
        );
    } catch (e: any) {
        usageRecord.responseStatus = 'error';
        usageRecord.durationMs = Date.now() - startTime;
        usageStorage.saveRequest(usageRecord as UsageRecord);
        usageStorage.saveError(requestId, e, { apiType: 'messages' });

        logger.error('Error processing Anthropic request', e);
        return reply.code(500).send({ type: 'error', error: { type: 'api_error', message: e.message } });
    }
});

/**
 * POST /v1beta/models/:modelWithAction
 * Gemini Compatible Endpoint.
 * Supports both unary and streamGenerateContent actions.
 */
fastify.post('/v1beta/models/:modelWithAction', async (request, reply) => {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    let usageRecord: Partial<UsageRecord> = {
        requestId,
        date: new Date().toISOString(),
        sourceIp: getClientIp(request),
        incomingApiType: 'gemini',
        startTime,
        isStreamed: false,
        responseStatus: 'pending'
    };

    try {
        const body = request.body as any;
        const params = request.params as any;
        const modelWithAction = params.modelWithAction;
        const modelName = modelWithAction.split(':')[0];
        usageRecord.incomingModelAlias = modelName;
        
        const query = request.query as any;
        const apiKey = query.key || request.headers['x-goog-api-key'];
        usageRecord.apiKey = apiKey ? apiKey.substring(0, 8) + '...' : null;

        logger.silly('Incoming Gemini Request', body);
        const transformer = new GeminiTransformer();
        const unifiedRequest = await transformer.parseRequest({ ...body, model: modelName });
        unifiedRequest.incomingApiType = 'gemini';
        unifiedRequest.originalBody = body;
        unifiedRequest.requestId = requestId;

        DebugManager.getInstance().startLog(requestId, body);
        
        if (modelWithAction.includes('streamGenerateContent')) {
            unifiedRequest.stream = true;
        }

        const unifiedResponse = await dispatcher.dispatch(unifiedRequest);
        
        return await handleResponse(
            reply,
            unifiedResponse,
            transformer,
            usageRecord,
            usageStorage,
            startTime,
            'gemini'
        );
    } catch (e: any) {
        usageRecord.responseStatus = 'error';
        usageRecord.durationMs = Date.now() - startTime;
        usageStorage.saveRequest(usageRecord as UsageRecord);
        usageStorage.saveError(requestId, e, { apiType: 'gemini' });

        logger.error('Error processing Gemini request', e);
        return reply.code(500).send({ error: { message: e.message, code: 500, status: "INTERNAL" } });
    }
});

// Responses API Placeholder
fastify.post('/v1/responses', async (request, reply) => {
     return reply.code(501).send({ error: "Not implemented" });
});

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

/**
 * handleSSE Helper
 * Standardizes the creation of Server-Sent Events streams for management dashboards.
 */
const handleSSE = async (reply: FastifyReply, setup: (stream: { writeSSE: (msg: any) => Promise<void>, sleep: (ms: number) => Promise<void> }) => Promise<void>) => {
    reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    const stream = {
        writeSSE: async (msg: any) => {
            if (reply.raw.destroyed) return;
            reply.raw.write(`event: ${msg.event}\ndata: ${msg.data}\nid: ${msg.id}\n\n`);
        },
        sleep: (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
    };

    await setup(stream);
};

fastify.get('/v0/management/events', async (request, reply) => {
    return handleSSE(reply, async (stream) => {
        const listener = async (record: any) => {
            await stream.writeSSE({
                data: JSON.stringify(record),
                event: 'log',
                id: String(Date.now()),
            });
        };

        usageStorage.on('created', listener);

        request.raw.on('close', () => {
            usageStorage.off('created', listener);
        });

        // Keep connection alive with periodic pings
        while (!request.raw.destroyed) {
            await stream.sleep(10000);
            await stream.writeSSE({
                event: 'ping',
                data: 'pong',
                id: String(Date.now())
            });
        }
    });
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
    return handleSSE(reply, async (stream) => {
        const listener = async (log: any) => {
            await stream.writeSSE({
                data: JSON.stringify(log),
                event: 'syslog',
                id: String(Date.now()),
            });
        };

        logEmitter.on('log', listener);

        request.raw.on('close', () => {
            logEmitter.off('log', listener);
        });

        while (!request.raw.destroyed) {
            await stream.sleep(10000);
            await stream.writeSSE({
                event: 'ping',
                data: 'pong',
                id: String(Date.now())
            });
        }
    });
});

// Health check endpoint for container orchestration
fastify.get('/health', (request, reply) => reply.send('OK'));

// --- Static File Serving ---

// Serve the production React build from packages/frontend/dist
fastify.register(fastifyStatic, {
    root: path.join(process.cwd(), '../frontend/dist'),
    prefix: '/',
    wildcard: false 
});

// Single Page Application (SPA) Fallback
// Redirects all non-API routes to index.html so React Router can take over
fastify.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/v1') || request.url.startsWith('/v0')) {
        reply.code(404).send({ error: "Not Found" });
    } else {
        reply.sendFile('index.html');
    }
});

const port = parseInt(process.env.PORT || '4000');
const host = '0.0.0.0';

/**
 * start
 * Asynchronously starts the Fastify server.
 */
const start = async () => {
    try {
        await fastify.listen({ port, host });
        logger.info(`Server starting on port ${port}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

// Only start the server if this file is being executed directly by Bun
if (import.meta.main) {
    start();
}

export default {
    port,
    server: fastify
}

