import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
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
import { QuotaScheduler } from './services/quota/quota-scheduler';
import { ResponsesStorageService } from './services/responses-storage';
import { OAuthAuthManager } from './services/oauth-auth-manager';
import { requestLogger } from './middleware/log';
import { registerManagementRoutes } from './routes/management';
import { registerInferenceRoutes } from './routes/inference';
import { registerMcpRoutes } from './routes/mcp';
import { McpUsageStorageService } from './services/mcp-proxy/mcp-usage-storage';
import { QuotaEnforcer } from './services/quota/quota-enforcer';
import { initializeDatabase } from './db/client';
import { runMigrations } from './db/migrate';
import { getBuildInfo } from './utils/build-info';

/**
 * Plexus Backend Server
 * 
 * Powered by Fastify and Bun.
 * This server acts as a unified gateway for various LLM providers,
 * handling request transformation, load balancing, and usage tracking.
 */

const fastify = Fastify({
    logger: false, // We use a custom winston-based logger
    bodyLimit: 30 * 1024 * 1024 // 30MB to accommodate 25MB audio files + metadata
});

// --- Plugin Registration ---

// Enable CORS for all origins to support dashboard and external client access
fastify.register(cors, {
    origin: '*', 
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-admin-key', 'x-goog-api-key'],
    exposedHeaders: ['Content-Type']
});

// Enable multipart/form-data support for file uploads (audio transcriptions)
fastify.register(multipart, {
    limits: {
        fileSize: 25 * 1024 * 1024, // 25MB limit (OpenAI's limit)
    },
    attachFieldsToBody: true, // Makes form fields accessible via request.body
});

// --- Service Initialization ---

const dispatcher = new Dispatcher();
const usageStorage = new UsageStorageService();
const mcpUsageStorage = new McpUsageStorageService();
const quotaScheduler = QuotaScheduler.getInstance();

// Initialize singletons with storage dependencies
dispatcher.setUsageStorage(usageStorage);
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
    // Eagerly initialize OAuth auth manager so auth.json schema migration
    // runs during startup (instead of waiting for first OAuth request).
    OAuthAuthManager.getInstance();
    await PricingManager.getInstance().loadPricing();
} catch (e) {
    logger.error('Failed to load config or pricing', e);
    process.exit(1);
}

const buildInfo = getBuildInfo();
logger.info(`Build info: ${buildInfo.displayVersion}${buildInfo.buildTime ? ` (${buildInfo.buildTime})` : ''}`);

// --- Database Initialization ---
// Initialize database before quota checkers (which need DB access)
try {
  initializeDatabase();
  await runMigrations();
  await CooldownManager.getInstance().loadFromStorage();
} catch (e) {
  logger.error('Failed to initialize database or run migrations', e);
  process.exit(1);
}

// Initialize quota checkers (requires DB to be ready)
try {
    const config = getConfig();
    if (config.quotas && config.quotas.length > 0) {
        await quotaScheduler.initialize(config.quotas);
    }
} catch (e) {
    logger.error('Failed to initialize quota checkers', e);
}

// Initialize user quota enforcer (requires DB to be ready)
let quotaEnforcer: QuotaEnforcer | undefined;
try {
    quotaEnforcer = new QuotaEnforcer();
    logger.info('User quota enforcer initialized');
} catch (e) {
    logger.error('Failed to initialize user quota enforcer', e);
}

// --- Hooks & Global Logic ---

// Global Unhandled Rejection Handler
// Prevents application crashes from unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Promise Rejection', { reason, promise });
});

// Global Uncaught Exception Handler
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception', error);
});

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
await registerInferenceRoutes(fastify, dispatcher, usageStorage, quotaEnforcer);

// --- Routes: MCP Proxy ---
await registerMcpRoutes(fastify, mcpUsageStorage);

// --- Response Storage Cleanup ---
// Start cleanup job (runs every hour, deletes responses older than 7 days)
const responsesStorage = new ResponsesStorageService();
responsesStorage.startCleanupJob(1, 7);

// --- Management API (v0) ---
await registerManagementRoutes(fastify, usageStorage, dispatcher, quotaScheduler, mcpUsageStorage, quotaEnforcer);

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

        const shutdown = async (signal: string) => {
            logger.info(`Received ${signal}, shutting down gracefully...`);
            quotaScheduler.stop();
            await fastify.close();
            const { closeDatabase } = await import('./db/client');
            await closeDatabase();
            logger.info('Shutdown complete');
            process.exit(0);
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
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
