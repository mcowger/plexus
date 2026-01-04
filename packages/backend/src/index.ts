import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
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
import { customAuth } from './middleware/auth';

const app = new Hono();
const dispatcher = new Dispatcher();
const usageStorage = new UsageStorageService();

// Initialize CooldownManager with storage
CooldownManager.getInstance().setStorage(usageStorage);
// Initialize DebugManager with storage
DebugManager.getInstance().setStorage(usageStorage);
// Initialize SelectorFactory with storage
SelectorFactory.setUsageStorage(usageStorage);

// Load config and pricing on startup
try {
    await loadConfig();
    await PricingManager.getInstance().loadPricing();
} catch (e) {
    logger.error('Failed to load config or pricing', e);
    process.exit(1);
}

// Middleware for logging
// Global Request Logger
app.use('*', requestLogger);

// Models list endpoint (no auth required - matches OpenAI)
app.get('/v1/models', (c) => {
    const config = getConfig();
    const models = Object.keys(config.models).map(id => ({
        id,
        object: 'model',
        created: Date.now(),
        owned_by: 'plexus'
    }));
    
    return c.json({
        object: 'list',
        data: models
    });
});
    
// Auth Middleware
app.use('/v1/*', customAuth);

// OpenAI Compatible Endpoint
app.post('/v1/chat/completions', async (c) => {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    let usageRecord: Partial<UsageRecord> = {
        requestId,
        date: new Date().toISOString(),
        sourceIp: getClientIp(c),
        incomingApiType: 'chat',
        startTime,
        isStreamed: false,
        responseStatus: 'pending'
    };

    try {
        const body = await c.req.json();
        usageRecord.incomingModelAlias = body.model;
        // API Key extraction (best effort placeholder)
        const authHeader = c.req.header('Authorization');
        usageRecord.apiKey = authHeader ? authHeader.replace('Bearer ', '').substring(0, 8) + '...' : null;

        logger.silly('Incoming OpenAI Request', body);
        const transformer = new OpenAITransformer();
        const unifiedRequest = await transformer.parseRequest(body);
        unifiedRequest.incomingApiType = 'chat';
        unifiedRequest.originalBody = body;
        unifiedRequest.requestId = requestId;
        
        //DebugManager.getInstance().startLog(requestId, body);

        const unifiedResponse = await dispatcher.dispatch(unifiedRequest);
        
        return await handleResponse(
            c,
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
        return c.json({ error: { message: e.message, type: 'api_error' } }, 500);
    }
});

// Anthropic Compatible Endpoint
app.post('/v1/messages', async (c) => {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    let usageRecord: Partial<UsageRecord> = {
        requestId,
        date: new Date().toISOString(),
        sourceIp: getClientIp(c),
        incomingApiType: 'messages',
        startTime,
        isStreamed: false,
        responseStatus: 'pending'
    };

    try {
        const body = await c.req.json();
        usageRecord.incomingModelAlias = body.model;
        // API Key extraction
        const authHeader = c.req.header('x-api-key');
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
            c,
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
        // Anthropic error format
        return c.json({ type: 'error', error: { type: 'api_error', message: e.message } }, 500);
    }
});

// Gemini Compatible Endpoint
app.post('/v1beta/models/:modelWithAction', async (c) => {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    let usageRecord: Partial<UsageRecord> = {
        requestId,
        date: new Date().toISOString(),
        sourceIp: getClientIp(c),
        incomingApiType: 'gemini',
        startTime,
        isStreamed: false,
        responseStatus: 'pending'
    };

    try {
        const body = await c.req.json();
        const modelWithAction = c.req.param('modelWithAction');
        // Extract model from "model-name:action"
        const modelName = modelWithAction.split(':')[0];
        usageRecord.incomingModelAlias = modelName;
        
        // API Key extraction
        const apiKey = c.req.query('key') || c.req.header('x-goog-api-key');
        usageRecord.apiKey = apiKey ? apiKey.substring(0, 8) + '...' : null;

        logger.silly('Incoming Gemini Request', body);
        const transformer = new GeminiTransformer();
        const unifiedRequest = await transformer.parseRequest({ ...body, model: modelName });
        unifiedRequest.incomingApiType = 'gemini';
        unifiedRequest.originalBody = body;
        unifiedRequest.requestId = requestId;

        DebugManager.getInstance().startLog(requestId, body);
        
        // Check if streaming based on action
        if (modelWithAction.includes('streamGenerateContent')) {
            unifiedRequest.stream = true;
        }

        const unifiedResponse = await dispatcher.dispatch(unifiedRequest);
        
        return await handleResponse(
            c,
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
        // Gemini error format (simplified)
        return c.json({ error: { message: e.message, code: 500, status: "INTERNAL" } }, 500);
    }
});

// Responses API (OpenAI Responses Style - Placeholder as per plan Step 3.1)
app.post('/v1/responses', async (c) => {
     // TODO: Implement Responses API transformation
     // For now, treat same as Chat Completions?
     return c.json({ error: "Not implemented" }, 501);
});

// Admin Auth Middleware
app.use('/v0/*', async (c, next) => {
    const config = getConfig();
    const authHeader = c.req.header('x-admin-key');

    // Secure comparison: Admin key MUST be present in config and match header
    if (!config.adminKey || !authHeader || authHeader !== config.adminKey) {
        return c.json({ error: { message: "Unauthorized", type: "auth_error" } }, 401);
    }
    await next();
});

// Management API
app.get('/v0/management/config', async (c) => {
    const configPath = getConfigPath();
    if (!configPath) {
        return c.json({ error: "Configuration file path not found" }, 404);
    }
    const file = Bun.file(configPath);
    if (!(await file.exists())) {
        return c.json({ error: "Configuration file not found" }, 404);
    }
    const configContent = await file.text();
    c.header('Content-Type', 'application/x-yaml');
    return c.body(configContent);
});

app.post('/v0/management/config', async (c) => {
    const configPath = getConfigPath();
    if (!configPath) {
         return c.json({ error: "Configuration path not determined" }, 500);
    }

    try {
        const body = await c.req.text();
        
        // Validate YAML
        try {
            validateConfig(body);
        } catch (e) {
            if (e instanceof z.ZodError) {
                return c.json({ error: "Validation failed", details: e.errors }, 400);
            }
             return c.json({ error: "Invalid YAML or Schema", details: String(e) }, 400);
        }

        // Write to file
        await Bun.write(configPath, body);
        logger.info(`Configuration updated via API at ${configPath}`);

        // Force reload
        await loadConfig(configPath);
        
        return c.body(body, 200, { 'Content-Type': 'application/x-yaml' });
    } catch (e: any) {
        logger.error("Failed to update config", e);
        return c.json({ error: e.message }, 500);
    }
});

app.get('/v0/management/usage', (c) => {
    const query = c.req.query();
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
        return c.json(result);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

app.delete('/v0/management/usage', (c) => {
    const olderThanDays = c.req.query('olderThanDays');
    let beforeDate: Date | undefined;

    if (olderThanDays) {
        const days = parseInt(olderThanDays);
        if (!isNaN(days)) {
            beforeDate = new Date();
            beforeDate.setDate(beforeDate.getDate() - days);
        }
    }

    const success = usageStorage.deleteAllUsageLogs(beforeDate);
    if (!success) return c.json({ error: "Failed to delete usage logs" }, 500);
    return c.json({ success: true });
});

app.delete('/v0/management/usage/:requestId', (c) => {
    const requestId = c.req.param('requestId');
    const success = usageStorage.deleteUsageLog(requestId);
    if (!success) return c.json({ error: "Usage log not found or could not be deleted" }, 404);
    return c.json({ success: true });
});

app.get('/v0/management/events', async (c) => {
    return streamSSE(c, async (stream) => {
        const listener = async (record: any) => {
            await stream.writeSSE({
                data: JSON.stringify(record),
                event: 'log',
                id: String(Date.now()),
            });
        };

        usageStorage.on('created', listener);

        stream.onAbort(() => {
            usageStorage.off('created', listener);
        });

        while (true) {
            await stream.sleep(10000);
        }
    });
});

app.get('/v0/management/cooldowns', (c) => {
    const cooldowns = CooldownManager.getInstance().getCooldowns();
    return c.json(cooldowns);
});

app.delete('/v0/management/cooldowns', (c) => {
    CooldownManager.getInstance().clearCooldown();
    return c.json({ success: true });
});

app.delete('/v0/management/cooldowns/:provider', (c) => {
    const provider = c.req.param('provider');
    CooldownManager.getInstance().clearCooldown(provider);
    return c.json({ success: true });
});

// Debug API

// Performance Metrics API
app.get('/v0/management/performance', (c) => {
    const provider = c.req.query('provider');
    const model = c.req.query('model');
    
    const performance = usageStorage.getProviderPerformance(provider, model);
    return c.json(performance);
});


app.get('/v0/management/debug', (c) => {
    return c.json({ enabled: DebugManager.getInstance().isEnabled() });
});

app.post('/v0/management/debug', async (c) => {
    const body = await c.req.json();
    if (typeof body.enabled === 'boolean') {
        DebugManager.getInstance().setEnabled(body.enabled);
        return c.json({ enabled: DebugManager.getInstance().isEnabled() });
    }
    return c.json({ error: "Invalid body. Expected { enabled: boolean }" }, 400);
});

app.get('/v0/management/debug/logs', (c) => {
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');
    return c.json(usageStorage.getDebugLogs(limit, offset));
});

app.delete('/v0/management/debug/logs', (c) => {
    const success = usageStorage.deleteAllDebugLogs();
    if (!success) return c.json({ error: "Failed to delete logs" }, 500);
    return c.json({ success: true });
});

app.get('/v0/management/debug/logs/:requestId', (c) => {
    const requestId = c.req.param('requestId');
    const log = usageStorage.getDebugLog(requestId);
    if (!log) return c.json({ error: "Log not found" }, 404);
    return c.json(log);
});

app.delete('/v0/management/debug/logs/:requestId', (c) => {
    const requestId = c.req.param('requestId');
    const success = usageStorage.deleteDebugLog(requestId);
    if (!success) return c.json({ error: "Log not found or could not be deleted" }, 404);
    return c.json({ success: true });
});

// Error Logs API
app.get('/v0/management/errors', (c) => {
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');
    return c.json(usageStorage.getErrors(limit, offset));
});

app.delete('/v0/management/errors', (c) => {
    const success = usageStorage.deleteAllErrors();
    if (!success) return c.json({ error: "Failed to delete error logs" }, 500);
    return c.json({ success: true });
});

app.delete('/v0/management/errors/:requestId', (c) => {
    const requestId = c.req.param('requestId');
    const success = usageStorage.deleteError(requestId);
    if (!success) return c.json({ error: "Error log not found or could not be deleted" }, 404);
    return c.json({ success: true });
});

// System Logs Stream
app.get('/v0/system/logs/stream', async (c) => {
    return streamSSE(c, async (stream) => {
        const listener = async (log: any) => {
            await stream.writeSSE({
                data: JSON.stringify(log),
                event: 'syslog',
                id: String(Date.now()),
            });
        };

        logEmitter.on('log', listener);

        stream.onAbort(() => {
            logEmitter.off('log', listener);
        });

        // Keep connection alive
        while (true) {
            await stream.sleep(10000);
        }
    });
});

// Health check
app.get('/health', (c) => c.text('OK'));

import { serveStatic } from 'hono/bun';
import { requestLogger } from './middleware/log';

app.use('/*', serveStatic({ root: '../frontend/dist' }));
app.get('*', serveStatic({ path: '../frontend/dist/index.html' }));

const port = parseInt(process.env.PORT || '4000');
logger.info(`Server starting on port ${port}`);

export default {
    port,
    fetch: app.fetch
}
