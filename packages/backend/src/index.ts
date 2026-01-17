import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { logger } from './utils/logger';
import { loadConfig, getConfig } from './config';
import { Dispatcher } from './services/dispatcher';
import { UsageStorageService } from './services/usage-storage';
import { CooldownManager } from './services/cooldown-manager';
import { DebugManager } from './services/debug-manager';
import { PricingManager } from './services/pricing-manager';
import { SelectorFactory } from './services/selectors/factory';
import { requestLogger } from './middleware/log';
import { registerManagementRoutes } from './routes/management';
import { registerInferenceRoutes } from './routes/inference';

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
dispatcher.setUsageStorage(usageStorage);
CooldownManager.getInstance().setStorage(usageStorage);
DebugManager.getInstance().setStorage(usageStorage);
SelectorFactory.setUsageStorage(usageStorage);

// Enable debug mode if DEBUG=true environment variable is set
if (process.env.DEBUG === 'true') {
    DebugManager.getInstance().setEnabled(true);
    logger.info('Debug mode auto-enabled via DEBUG=true environment variable');
}

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
    
    if (error instanceof Error && 'validation' in error) {
        return reply.code(400).send({
            error: {
                message: "Validation Error",
                details: (error as any).validation
            }
        });
    }

    const err = error as any;
    reply.code(err.statusCode || 500).send({
        error: {
            message: err.message || "Internal Server Error",
            type: "api_error"
        }
    });
});

// --- Routes: v1 (Inference API) ---
await registerInferenceRoutes(fastify, dispatcher, usageStorage);

// --- Management API (v0) ---
await registerManagementRoutes(fastify, usageStorage);

// Health check endpoint for container orchestration
fastify.get('/health', (request, reply) => reply.send('OK'));

// --- Static File Serving ---

// Serve the production React build from packages/frontend/dist
// This is used for dev as well.
const staticRoot = path.join(process.cwd(), '../frontend/dist');
logger.info(`Serving static files from: ${staticRoot} (CWD: ${process.cwd()})`);

fastify.register(fastifyStatic, {
    root: staticRoot,
    prefix: '/ui/',
    // Disable caching to ensure frontend updates are seen immediately
    cacheControl: false,
    etag: false, 
    lastModified: false,
    setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
});

// Root Redirect to UI
fastify.get('/', (request, reply) => {
    reply.redirect('/ui/');
});

fastify.get('/ui', (request, reply) => {
    reply.redirect('/ui/');
});

// Single Page Application (SPA) Fallback
// Redirects all non-API routes to index.html so React Router can take over
fastify.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/v1') || request.url.startsWith('/v0')) {
        reply.code(404).send({ error: "Not Found" });
    } else if (request.url.startsWith('/ui/') || request.url === '/ui') {
        reply.sendFile('index.html');
    } else {
        reply.code(404).send({ error: "Not Found" });
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
