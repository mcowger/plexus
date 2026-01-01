import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { logger } from './utils/logger';
import { loadConfig, getConfig, getConfigPath, validateConfig } from './config';
import { Dispatcher } from './services/dispatcher';
import { AnthropicTransformer, OpenAITransformer } from './transformers';
import { UsageStorageService } from './services/usage-storage';
import { UsageRecord } from './types/usage';
import fs from 'node:fs';
import { z } from 'zod';

const app = new Hono();
const dispatcher = new Dispatcher();
const usageStorage = new UsageStorageService();

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
        sourceIp: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
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
        
        const unifiedResponse = await dispatcher.dispatch(unifiedRequest);
        
        // Update record with selected model info if available
        usageRecord.selectedModelName = unifiedResponse.model;
        usageRecord.provider = unifiedResponse.model.split(':')[0]; // rudimentary provider extraction if model is provider:name
        usageRecord.isStreamed = !!unifiedResponse.stream;

        if (unifiedResponse.stream) {
            // Tee the stream to track usage
            const [logStream, clientStreamSource] = unifiedResponse.stream.tee();

            // Background processing of the stream for logging
            (async () => {
                const reader = logStream.getReader();
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        
                        // Extract usage if present in the chunk
                        if (value && value.usage) {
                            usageRecord.tokensInput = value.usage.prompt_tokens;
                            usageRecord.tokensOutput = value.usage.completion_tokens;
                            usageRecord.tokensCached = value.usage.prompt_tokens_details?.cached_tokens;
                            usageRecord.tokensReasoning = value.usage.completion_tokens_details?.reasoning_tokens;
                        }
                    }
                    usageRecord.responseStatus = 'success';
                } catch (e) {
                    usageRecord.responseStatus = 'error_stream';
                } finally {
                    usageRecord.durationMs = Date.now() - startTime;
                    // Save record
                    usageStorage.saveRequest(usageRecord as UsageRecord);
                }
            })();

            return stream(c, async (stream) => {
                c.header('Content-Type', 'text/event-stream');
                c.header('Cache-Control', 'no-cache');
                c.header('Connection', 'keep-alive');
                
                const clientStream = transformer.formatStream ? 
                                   transformer.formatStream(clientStreamSource) : 
                                   clientStreamSource;

                const reader = clientStream.getReader();
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        await stream.write(value);
                    }
                } finally {
                    reader.releaseLock();
                }
            });
        }

        const responseBody = await transformer.formatResponse(unifiedResponse);
        
        // Populate usage stats
        if (unifiedResponse.usage) {
            usageRecord.tokensInput = unifiedResponse.usage.prompt_tokens;
            usageRecord.tokensOutput = unifiedResponse.usage.completion_tokens;
            usageRecord.tokensCached = unifiedResponse.usage.prompt_tokens_details?.cached_tokens;
            usageRecord.tokensReasoning = unifiedResponse.usage.completion_tokens_details?.reasoning_tokens;
        }

        usageRecord.responseStatus = 'success';
        usageRecord.durationMs = Date.now() - startTime;
        usageStorage.saveRequest(usageRecord as UsageRecord);

        logger.debug('Outgoing OpenAI Response', responseBody);
        return c.json(responseBody);
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
        sourceIp: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
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
        
        const unifiedResponse = await dispatcher.dispatch(unifiedRequest);
        
        // Update record
        usageRecord.selectedModelName = unifiedResponse.model;
        usageRecord.provider = unifiedResponse.model.split(':')[0];
        usageRecord.isStreamed = !!unifiedResponse.stream;

        if (unifiedResponse.stream) {
            const [logStream, clientStreamSource] = unifiedResponse.stream.tee();

            // Background processing of the stream for logging
            (async () => {
                const reader = logStream.getReader();
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        
                        // Extract usage if present in the chunk
                        if (value && value.usage) {
                            usageRecord.tokensInput = value.usage.prompt_tokens;
                            usageRecord.tokensOutput = value.usage.completion_tokens;
                            usageRecord.tokensCached = value.usage.prompt_tokens_details?.cached_tokens;
                            usageRecord.tokensReasoning = value.usage.completion_tokens_details?.reasoning_tokens;
                        }
                    }
                    usageRecord.responseStatus = 'success';
                } catch (e) {
                    usageRecord.responseStatus = 'error_stream';
                } finally {
                    usageRecord.durationMs = Date.now() - startTime;
                    usageStorage.saveRequest(usageRecord as UsageRecord);
                }
            })();

            return stream(c, async (stream) => {
                c.header('Content-Type', 'text/event-stream');
                c.header('Cache-Control', 'no-cache');
                c.header('Connection', 'keep-alive');
                
                const clientStream = transformer.formatStream ? 
                                   transformer.formatStream(clientStreamSource) : 
                                   clientStreamSource;

                const reader = clientStream.getReader();
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        await stream.write(value);
                    }
                } finally {
                    reader.releaseLock();
                }
            });
        }

        const responseBody = await transformer.formatResponse(unifiedResponse);
        
        if (unifiedResponse.usage) {
            usageRecord.tokensInput = unifiedResponse.usage.prompt_tokens;
            usageRecord.tokensOutput = unifiedResponse.usage.completion_tokens;
            usageRecord.tokensCached = unifiedResponse.usage.prompt_tokens_details?.cached_tokens;
            usageRecord.tokensReasoning = unifiedResponse.usage.completion_tokens_details?.reasoning_tokens;
        }

        usageRecord.responseStatus = 'success';
        usageRecord.durationMs = Date.now() - startTime;
        usageStorage.saveRequest(usageRecord as UsageRecord);

        logger.debug('Outgoing Anthropic Response', responseBody);
        return c.json(responseBody);
    } catch (e: any) {
        usageRecord.responseStatus = 'error';
        usageRecord.durationMs = Date.now() - startTime;
        usageStorage.saveRequest(usageRecord as UsageRecord);

        logger.error('Error processing Anthropic request', e);
        // Anthropic error format
        return c.json({ type: 'error', error: { type: 'api_error', message: e.message } }, 500);
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

// Health check
app.get('/health', (c) => c.text('OK'));

const port = parseInt(process.env.PORT || '3000');
logger.info(`Server starting on port ${port}`);

export default {
    port,
    fetch: app.fetch
}
