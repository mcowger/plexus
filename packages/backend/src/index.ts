import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { logger } from './utils/logger';
import { loadConfig, getConfig, getConfigPath, validateConfig } from './config';
import { Dispatcher } from './services/dispatcher';
import { AnthropicTransformer, OpenAITransformer, GeminiTransformer } from './transformers';
import { UsageStorageService } from './services/usage-storage';
import { UsageRecord } from './types/usage';
import { handleResponse } from './utils/response-handler';
import { getClientIp } from './utils/ip';
import { z } from 'zod';
import { CooldownManager } from './services/cooldown-manager';

const app = new Hono();
const dispatcher = new Dispatcher();
const usageStorage = new UsageStorageService();

// Initialize CooldownManager with storage
CooldownManager.getInstance().setStorage(usageStorage);

// Load config on startup
try {
    await loadConfig();
} catch (e) {
    logger.error('Failed to load config', e);
    process.exit(1);
}

// Middleware for logging
app.use('*', async (c, next) => {
    logger.info(`${c.req.method} ${c.req.path}`);
    await next();
});

// OpenAI Compatible Endpoint
app.post('/v1/chat/completions', async (c) => {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    let usageRecord: Partial<UsageRecord> = {
        requestId,
        date: new Date().toISOString(),
        sourceIp: getClientIp(c),
        incomingApiType: 'openai',
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

        logger.debug('Incoming OpenAI Request', body);
        const transformer = new OpenAITransformer();
        const unifiedRequest = await transformer.parseRequest(body);
        unifiedRequest.incomingApiType = 'openai';
        
        const unifiedResponse = await dispatcher.dispatch(unifiedRequest);
        
        return await handleResponse(
            c,
            unifiedResponse,
            transformer,
            usageRecord,
            usageStorage,
            startTime,
            'openai'
        );
    } catch (e: any) {
        usageRecord.responseStatus = 'error';
        usageRecord.durationMs = Date.now() - startTime;
        usageStorage.saveRequest(usageRecord as UsageRecord);

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
        incomingApiType: 'anthropic',
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

        logger.debug('Incoming Anthropic Request', body);
        const transformer = new AnthropicTransformer();
        const unifiedRequest = await transformer.parseRequest(body);
        unifiedRequest.incomingApiType = 'anthropic';
        
        const unifiedResponse = await dispatcher.dispatch(unifiedRequest);
        
        return await handleResponse(
            c,
            unifiedResponse,
            transformer,
            usageRecord,
            usageStorage,
            startTime,
            'anthropic'
        );
    } catch (e: any) {
        usageRecord.responseStatus = 'error';
        usageRecord.durationMs = Date.now() - startTime;
        usageStorage.saveRequest(usageRecord as UsageRecord);

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

        logger.debug('Incoming Gemini Request', body);
        const transformer = new GeminiTransformer();
        const unifiedRequest = await transformer.parseRequest({ ...body, model: modelName });
        unifiedRequest.incomingApiType = 'gemini';
        
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

// Health check
app.get('/health', (c) => c.text('OK'));

import { serveStatic } from 'hono/bun';

app.use('/*', serveStatic({ root: '../frontend/dist' }));
app.get('*', serveStatic({ path: '../frontend/dist/index.html' }));

const port = parseInt(process.env.PORT || '4000');
logger.info(`Server starting on port ${port}`);

export default {
    port,
    fetch: app.fetch
}
