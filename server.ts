import { logger } from "./server/utils/logger";
import { handleHealth, handleReady } from "./server/routes/health";
import { handleChatCompletions } from "./server/routes/chat-completions";
import { handleMessages } from "./server/routes/messages";
import { handleModels } from "./server/routes/models";
// Phase 8 Management Routes
import { handleConfig } from "./server/routes/v0/config";
import { handleState } from "./server/routes/v0/state";
import { handleLogs } from "./server/routes/v0/logs";
import { handleEvents } from "./server/routes/v0/events";
import { AdminAuth } from "./server/middleware/admin-auth";

import type { PlexusConfig } from "./server/types/config";
import type { ServerContext } from "./server/types/server";
import { createRequestId } from "./server/utils/headers";
import { CooldownManager } from "./server/services/cooldown-manager";
import { HealthMonitor } from "./server/services/health-monitor";
import { UsageStore } from "./server/storage/usage-store";
import { ErrorStore } from "./server/storage/error-store";
import { DebugStore } from "./server/storage/debug-store";
import { CostCalculator } from "./server/services/cost-calculator";
import { MetricsCollector } from "./server/services/metrics-collector";
import { UsageLogger } from "./server/services/usage-logger";
import { DebugLogger } from "./server/services/debug-logger";
import { EventEmitter } from "./server/services/event-emitter";
import { ConfigManager } from "./server/services/config-manager";
import { LogQueryService } from "./server/services/log-query";
import { TransformerFactory } from "./server/services/transformer-factory";

// @ts-ignore - HTML import
import frontendHtml from "index.html";

function withCORS(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS",
  );
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With",
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Helper to get client IP and request ID
 */
function getRequestContext(req: Request, server: any) {
  const clientIp =
    req.headers.get("x-forwarded-for") ||
    server.requestIP(req)?.address ||
    "0.0.0.0";
  const requestId = createRequestId();
  return { clientIp, requestId };
}

/**
 * Creates and starts the HTTP server
 */
export async function createServer(
  config: PlexusConfig,
  configManager: ConfigManager,
  eventEmitter: EventEmitter,
): Promise<{ server: any; shutdown: () => Promise<void> }> {
  // Initialize resilience services
  const cooldownManager = new CooldownManager(config);
  const healthMonitor = new HealthMonitor(config, cooldownManager);

  const adminAuth = new AdminAuth(config);

  // Initialize observability services (Phase 7)
  let usageLogger: UsageLogger | undefined;
  let metricsCollector: MetricsCollector | undefined;
  let costCalculator: CostCalculator | undefined;
  let debugLogger: DebugLogger | undefined;
  let logQueryService: LogQueryService | undefined;

  let usageStore: UsageStore | undefined;
  let errorStore: ErrorStore | undefined;
  let debugStore: DebugStore | undefined;

  if (config.logging.usage?.enabled) {
    // Initialize storage
    usageStore = new UsageStore(
      config.logging.usage.storagePath,
      config.logging.usage.retentionDays,
    );
    await usageStore.initialize();

    errorStore = new ErrorStore(
      config.logging.errors.storagePath,
      config.logging.errors.retentionDays,
    );
    await errorStore.initialize();

    // Initialize cost calculator
    costCalculator = new CostCalculator(config.pricing);

    // Initialize metrics collector (5 minute rolling window)
    metricsCollector = new MetricsCollector(5);

    // Initialize usage logger
    usageLogger = new UsageLogger(
      usageStore,
      errorStore,
      costCalculator,
      metricsCollector,
      true,
      eventEmitter, // Pass event emitter
    );

    logger.info("Observability services initialized");
  }

  // Initialize debug store (shared between Logger and QueryService)
  // We initialize it even if debug logging is disabled, to allow querying historical logs
  debugStore = new DebugStore(
    config.logging.debug?.storagePath || "./logs/debug",
    config.logging.debug?.retentionDays || 7,
    config.logging.debug?.enabled || false,
  );

  // Always create transformer factory and debugLogger for stream reconstruction and usage tracking
  // The debugStore.store() method will skip persistence if debug logging is disabled
  const transformerFactory = new TransformerFactory();

  debugLogger = new DebugLogger(
    {
      enabled: config.logging.debug?.enabled || false,
      storagePath: config.logging.debug?.storagePath || "./logs/debug",
      retentionDays: config.logging.debug?.retentionDays || 7,
    },
    debugStore,
    transformerFactory,
    usageLogger,
  );

  // Only initialize storage if debug logging is enabled
  if (config.logging.debug?.enabled) {
    await debugLogger.initialize();
  }

  // Initialize Log Query Service
  if (usageStore && errorStore && debugStore) {
    logQueryService = new LogQueryService(usageStore, errorStore, debugStore);
  }

  const context: ServerContext = {
    config,
    cooldownManager,
    healthMonitor,
    usageLogger,
    metricsCollector,
    costCalculator,
    debugLogger,
    eventEmitter,
    configManager,
    logQueryService,
  };

  const server = Bun.serve({
    port: config.server.port,
    hostname: config.server.host,
    idleTimeout: 60, // 60 seconds to allow for 30s keep-alive heatbeats for SSE
    development:
      process.env.NODE_ENV !== "production"
        ? {
            hmr: true,
            console: true,
          }
        : false,
    routes: {
      // Health checks
      "/health": {
        GET: (req) => withCORS(handleHealth(req, context.healthMonitor)),
      },
      "/ready": {
        GET: (req) => withCORS(handleReady(req)),
      },

      // V1 API routes
      "/v1/chat/completions": {
        POST: async (req, server) => {
          const { clientIp, requestId } = getRequestContext(req, server);
          return withCORS(
            await handleChatCompletions(req, context, requestId, clientIp),
          );
        },
      },
      "/v1/messages": {
        POST: async (req, server) => {
          const { clientIp, requestId } = getRequestContext(req, server);
          return withCORS(
            await handleMessages(req, context, requestId, clientIp),
          );
        },
      },
      "/v1/models": {
        GET: async (req) => {
          const requestId = createRequestId();
          return withCORS(await handleModels(req, context.config, requestId));
        },
      },

      // V0 Management API routes (admin auth required)
      "/v0/config": async (req) => {
        const authError = await adminAuth.validate(req);
        if (authError) return withCORS(authError);
        if (!context.configManager)
          return withCORS(
            new Response("Config manager not initialized", { status: 503 }),
          );
        return withCORS(await handleConfig(req, context.configManager));
      },
      "/v0/state": async (req) => {
        const authError = await adminAuth.validate(req);
        if (authError) return withCORS(authError);
        return withCORS(await handleState(req, context));
      },
      "/v0/logs": async (req) => {
        const authError = await adminAuth.validate(req);
        if (authError) return withCORS(authError);
        if (!context.logQueryService)
          return withCORS(
            new Response("Log query service not initialized", { status: 503 }),
          );
        return withCORS(await handleLogs(req, context.logQueryService));
      },
      "/v0/events": async (req) => {
        const authError = await adminAuth.validate(req);
        if (authError) return withCORS(authError);
        if (!context.eventEmitter)
          return withCORS(
            new Response("Event emitter not initialized", { status: 503 }),
          );
        return withCORS(await handleEvents(req, context.eventEmitter));
      },

      // Frontend UI - catch-all for client-side routing (lowest priority)
      "/": frontendHtml,
      "/*": frontendHtml,
    },
  });

  logger.info("Server started", {
    host: config.server.host,
    port: config.server.port,
    url: `http://${config.server.host}:${config.server.port}`,
  });

  // Graceful shutdown handler
  const shutdown = async (): Promise<void> => {
    logger.info("Shutting down server...");
    server.stop();
    eventEmitter.shutdown();
    logger.info("Server shutdown complete");
  };

  return { server, shutdown };
}
