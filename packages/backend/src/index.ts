import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { logger } from './utils/logger';
import { loadConfig } from './config';
import { Dispatcher } from './services/dispatcher';
import { AnthropicTransformer, OpenAITransformer } from './transformers';

const app = new Hono();
const dispatcher = new Dispatcher();

// Load config on startup
try {
    loadConfig();
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
    try {
        const body = await c.req.json();
        logger.debug('Incoming OpenAI Request', body);
        const transformer = new OpenAITransformer();
        const unifiedRequest = await transformer.parseRequest(body);
        
        const unifiedResponse = await dispatcher.dispatch(unifiedRequest);
        
        if (unifiedResponse.stream) {
            return stream(c, async (stream) => {
                c.header('Content-Type', 'text/event-stream');
                c.header('Cache-Control', 'no-cache');
                c.header('Connection', 'keep-alive');
                
                const clientStream = transformer.formatStream ? 
                                   transformer.formatStream(unifiedResponse.stream) : 
                                   unifiedResponse.stream;

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
        logger.debug('Outgoing OpenAI Response', responseBody);
        return c.json(responseBody);
    } catch (e: any) {
        logger.error('Error processing OpenAI request', e);
        return c.json({ error: { message: e.message, type: 'api_error' } }, 500);
    }
});

// Anthropic Compatible Endpoint
app.post('/v1/messages', async (c) => {
    try {
        const body = await c.req.json();
        logger.debug('Incoming Anthropic Request', body);
        const transformer = new AnthropicTransformer();
        const unifiedRequest = await transformer.parseRequest(body);
        
        const unifiedResponse = await dispatcher.dispatch(unifiedRequest);
        
        if (unifiedResponse.stream) {
            return stream(c, async (stream) => {
                c.header('Content-Type', 'text/event-stream');
                c.header('Cache-Control', 'no-cache');
                c.header('Connection', 'keep-alive');
                
                const clientStream = transformer.formatStream ? 
                                   transformer.formatStream(unifiedResponse.stream) : 
                                   unifiedResponse.stream;

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
        logger.debug('Outgoing Anthropic Response', responseBody);
        return c.json(responseBody);
    } catch (e: any) {
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

// Health check
app.get('/health', (c) => c.text('OK'));

const port = parseInt(process.env.PORT || '3000');
logger.info(`Server starting on port ${port}`);

export default {
    port,
    fetch: app.fetch
}
