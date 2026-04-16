// Check for subcommands (e.g. `./plexus rekey`) before starting the server.
// This allows Docker users to run CLI tools without needing the source code.
const subcommand = process.argv[2];
if (subcommand === 'rekey') {
  const { rekeyMain } = await import('./cli/rekey');
  rekeyMain()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Re-key failed:', err);
      process.exit(1);
    });
  // Prevent the rest of the server from initializing
  await new Promise(() => {}); // Block forever; process.exit above will terminate
}

import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import path from 'path';
import indexHtmlPath from '../../frontend/dist/index.html' with { type: 'file' };
import mainJsPath from '../../frontend/dist/main.js' with { type: 'file' };
import mainCssPath from '../../frontend/dist/main.css' with { type: 'file' };
import fs from 'fs';
import yaml from 'yaml';
import { logger } from './utils/logger';
import { getConfig } from './config';
import { ConfigService } from './services/config-service';
import { Dispatcher } from './services/dispatcher';
import { UsageStorageService } from './services/usage-storage';
import { CooldownManager } from './services/cooldown-manager';
import { DebugManager } from './services/debug-manager';
import { PricingManager } from './services/pricing-manager';
import { ModelMetadataManager } from './services/model-metadata-manager';
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
import { runEncryptionMigration } from './db/encrypt-migration';
import { isEncryptionEnabled } from './utils/encryption';

/**
 * Plexus Backend Server
 *
 * Powered by Fastify and Bun.
 * This server acts as a unified gateway for various LLM providers,
 * handling request transformation, load balancing, and usage tracking.
 */

// --- Required Environment Variables ---
// Check for ADMIN_KEY - if not set, try to read from plexus.yaml for backward compatibility
export let adminKeyFromYaml: string | undefined = undefined;
if (!process.env.ADMIN_KEY) {
  // Try to read adminKey from plexus.yaml for backward compatibility
  const configLocations = [
    path.resolve(__dirname, '../../../config/plexus.yaml'),
    path.resolve(__dirname, '../../config/plexus.yaml'),
    path.resolve(process.cwd(), 'config/plexus.yaml'),
    path.resolve(process.cwd(), '../../config/plexus.yaml'),
  ];
  const configPath = [
    ...(process.env.CONFIG_FILE ? [process.env.CONFIG_FILE] : []),
    ...configLocations,
  ].find((p) => fs.existsSync(p));

  if (configPath) {
    try {
      const yamlContent = fs.readFileSync(configPath, 'utf-8');
      const parsed = yaml.parse(yamlContent);
      if (parsed?.adminKey) {
        adminKeyFromYaml = parsed.adminKey;
        process.env.ADMIN_KEY = adminKeyFromYaml;
        process.env.ADMIN_KEY_FROM_YAML = 'true';

        // Print large ASCII banner warning
        logger.error('');
        logger.error(
          '╔════════════════════════════════════════════════════════════════════════════════╗'
        );
        logger.error(
          '║                                                                                ║'
        );
        logger.error(
          '║   ⚠️  DEPRECATION WARNING: ADMIN_KEY FROM YAML FILE                            ║'
        );
        logger.error(
          '║                                                                                ║'
        );
        logger.error(
          '║   Plexus has migrated to database-backed configuration.                        ║'
        );
        logger.error(
          '║   Your adminKey was read from plexus.yaml for backward compatibility.          ║'
        );
        logger.error(
          '║                                                                                ║'
        );
        logger.error(
          '║   ⚠️  ACTION REQUIRED:                                                         ║'
        );
        logger.error(
          '║   Set ADMIN_KEY as an environment variable before the next restart:            ║'
        );
        logger.error(
          '║                                                                                ║'
        );
        logger.error(
          '║       export ADMIN_KEY="your-admin-key"                                        ║'
        );
        logger.error(
          '║                                                                                ║'
        );
        logger.error(
          '║   Note: The rest of your plexus.yaml configuration has been imported           ║'
        );
        logger.error(
          '║   into the database and will NOT be re-read from the YAML file.                ║'
        );
        logger.error(
          '║   Future changes must be made via the web UI or management API.                ║'
        );
        logger.error(
          '║                                                                                ║'
        );
        logger.error(
          '╚════════════════════════════════════════════════════════════════════════════════╝'
        );
        logger.error('');
      }
    } catch (e) {
      // Ignore errors reading YAML file
    }
  }
}

if (!process.env.ADMIN_KEY) {
  logger.error(
    'ADMIN_KEY environment variable is required. Set it to a secure password for admin access.'
  );
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  const dataDir = process.env.DATA_DIR || '/app/data';
  process.env.DATABASE_URL = `sqlite://${dataDir}/plexus.db`;
}

// Log startup configuration
logger.info(`DATABASE_URL: ${process.env.DATABASE_URL}`);
logger.info(`PORT: ${process.env.PORT || '4000'}`);

const fastify = Fastify({
  logger: false, // We use a custom winston-based logger
  bodyLimit: 30 * 1024 * 1024, // 30MB to accommodate 25MB audio files + metadata
});

// --- Plugin Registration ---

// Enable CORS for all origins to support dashboard and external client access
fastify.register(cors, {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-admin-key', 'x-goog-api-key'],
  exposedHeaders: ['Content-Type'],
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

// --- Database Initialization ---
// Database must be initialized BEFORE config loading (config is now DB-backed)
try {
  initializeDatabase();
  await runMigrations();
  await runEncryptionMigration();
} catch (e) {
  logger.error('Failed to initialize database or run migrations', e);
  process.exit(1);
}

if (!isEncryptionEnabled()) {
  logger.warn(
    'ENCRYPTION_KEY not set — sensitive data will be stored in plaintext. Set ENCRYPTION_KEY for encryption at rest.'
  );
}

// --- Configuration Initialization ---
// Use ConfigService (database-backed) with auto-import from YAML on first launch
try {
  const configService = ConfigService.getInstance();

  if (await configService.isFirstLaunch()) {
    logger.info('First launch detected — checking for existing config files to import');

    // Import from plexus.yaml if it exists
    // Try CONFIG_FILE env var first, then check common locations
    const configLocations = [
      path.resolve(__dirname, '../../../config/plexus.yaml'), // from packages/backend/src or dist
      path.resolve(__dirname, '../../config/plexus.yaml'), // alternate depth
      path.resolve(process.cwd(), 'config/plexus.yaml'), // from repo root
      path.resolve(process.cwd(), '../../config/plexus.yaml'), // from packages/backend
    ];
    const configPath = [process.env.CONFIG_FILE, ...configLocations].find(
      (p): p is string => typeof p === 'string' && fs.existsSync(p)
    );

    try {
      if (configPath && fs.existsSync(configPath)) {
        const yamlContent = fs.readFileSync(configPath, 'utf-8');
        await configService.importFromYaml(yamlContent);
        logger.info(`Imported configuration from ${configPath} into database`);
      } else {
        logger.info('No plexus.yaml found — starting with empty configuration');
      }

      // Import from auth.json if it exists
      const authJsonPath = process.env.AUTH_JSON || './auth.json';
      if (fs.existsSync(authJsonPath)) {
        const authContent = fs.readFileSync(authJsonPath, 'utf-8');
        await configService.importFromAuthJson(authContent);
        logger.info(`Imported OAuth credentials from ${authJsonPath} into database`);
      }

      // Mark bootstrap as complete so a future restart (even with an empty
      // providers table) does not re-import from the YAML file.
      await configService.getRepository().markBootstrapped();
      logger.info('Bootstrap complete — marked database as bootstrapped');
    } catch (importError) {
      logger.error(
        'Failed to import config — clearing partial data for clean retry on next launch',
        importError
      );
      await configService.clearAllData();
      throw importError;
    }
  }

  await configService.initialize();
  logger.info('Configuration loaded from database');

  // Eagerly initialize OAuth auth manager so auth.json schema migration
  // runs during startup (instead of waiting for first OAuth request).
  await OAuthAuthManager.getInstance().initialize();
  await PricingManager.getInstance().loadPricing();
  // Load model metadata from all configured sources (non-fatal on failure)
  ModelMetadataManager.getInstance()
    .loadAll()
    .catch((e) => {
      logger.error('Failed to load model metadata', e);
    });
} catch (e) {
  logger.error('Failed to load config or pricing', e);
  process.exit(1);
}

// Load cooldowns from storage (requires DB to be ready)
try {
  await CooldownManager.getInstance().loadFromStorage();
} catch (e) {
  logger.error('Failed to load cooldowns from storage', e);
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
        message: 'Validation Error',
        details: (error as any).validation,
      },
    });
  }

  const err = error as any;
  reply.code(err.statusCode || 500).send({
    error: {
      message: err.message || 'Internal Server Error',
      type: 'api_error',
    },
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
await registerManagementRoutes(
  fastify,
  usageStorage,
  dispatcher,
  quotaScheduler,
  mcpUsageStorage,
  quotaEnforcer
);

// Health check endpoint for container orchestration
fastify.get('/health', (request, reply) => reply.send('OK'));

// --- Static File Serving ---
// `indexHtmlPath` is a string path — the filesystem path in dev, or a $bunfs/ path in a
// compiled binary. Bun embeds index.html and all assets it references (JS, CSS, images, SVGs)
// automatically when compiled. `Bun.file()` resolves both path forms transparently.

const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

// Map of known frontend assets to their embedded paths.
// These are explicitly referenced here so Bun's bundler does not tree-shake
// the `with { type: 'file' }` imports away during --compile.
const frontendDistDir = path.dirname(indexHtmlPath);
const frontendAssetPaths: Record<string, string> = {
  'index.html': indexHtmlPath,
  'main.js': mainJsPath,
  'main.css': mainCssPath,
};

// For any other assets in the dist dir (favicons, images, etc.), fall back to
// Bun.embeddedFiles (populated from CLI args with --asset-naming="[name].[ext]")
// or the filesystem path in dev mode.
type EmbeddedFile = Blob & { name: string };
const embeddedByName = new Map<string, EmbeddedFile>(
  (Bun.embeddedFiles as EmbeddedFile[]).map((f) => [f.name, f])
);

logger.info(`Serving frontend from: ${frontendDistDir}`);

const serveAsset = async (reply: FastifyReply, filePath: string, ext: string) => {
  const mimeType = mimeTypes[ext] ?? 'application/octet-stream';
  return reply
    .header('Cache-Control', 'no-store')
    .type(mimeType)
    .send(Buffer.from(await Bun.file(filePath).arrayBuffer()));
};

fastify.get('/ui/', async (request, reply) => serveAsset(reply, indexHtmlPath, '.html'));
fastify.get('/ui/index.html', async (request, reply) => serveAsset(reply, indexHtmlPath, '.html'));
fastify.get('/ui/:filename', async (request, reply) => {
  const { filename } = request.params as { filename: string };
  const ext = path.extname(filename);
  // SPA routes like /ui/logs should resolve to the frontend shell.
  if (!ext) {
    return serveAsset(reply, indexHtmlPath, '.html');
  }
  // Known asset with an explicit embedded path
  const knownPath = frontendAssetPaths[filename];
  if (knownPath) return serveAsset(reply, knownPath, ext);
  // Asset embedded via CLI args (favicons, images, SVGs, etc.)
  const embedded = embeddedByName.get(filename);
  if (embedded) {
    const mimeType = mimeTypes[ext] ?? 'application/octet-stream';
    return reply
      .header('Cache-Control', 'no-store')
      .type(mimeType)
      .send(Buffer.from(await embedded.arrayBuffer()));
  }
  // Dev mode: serve from the dist directory on disk
  const fsPath = path.join(frontendDistDir, filename);
  const fsFile = Bun.file(fsPath);
  if (await fsFile.exists()) return serveAsset(reply, fsPath, ext);
  return reply.code(404).send('Not Found');
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
fastify.setNotFoundHandler(async (request, reply) => {
  if (request.url.startsWith('/v1') || request.url.startsWith('/v0')) {
    reply.code(404).send({ error: 'Not Found' });
  } else if (request.url.startsWith('/ui/') || request.url === '/ui') {
    return serveAsset(reply, indexHtmlPath, '.html');
  } else {
    reply.code(404).send({ error: 'Not Found' });
  }
});

const port = parseInt(process.env.PORT || '4000');
const host = process.env.HOST || '0.0.0.0';

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
    logger.error('Fatal error during server startup', err);
    process.exit(1);
  }
};

// Only start the server if this file is being executed directly by Bun
if (import.meta.main) {
  start();
}

export default {
  port,
  server: fastify,
};
