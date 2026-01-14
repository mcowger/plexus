import { logger } from "./utils/logger";
import { handleHealth, handleReady } from "./routes/health";
import { handleChatCompletions } from "./routes/chat-completions";
import { handleMessages } from "./routes/messages";
import { handleModels } from "./routes/models";
// Phase 8 Management Routes
import { handleConfig } from "./routes/v0/config";
import { handleState } from "./routes/v0/state";
import { handleLogs } from "./routes/v0/logs";
import { handleEvents } from "./routes/v0/events";
import { AdminAuth } from "./middleware/admin-auth";

import type { PlexusConfig } from "./types/config";
import type { ServerContext } from "./types/server";
import { createRequestId } from "./utils/headers";
import { CooldownManager } from "./services/cooldown-manager";
import { HealthMonitor } from "./services/health-monitor";
import { UsageStore } from "./storage/usage-store";
import { ErrorStore } from "./storage/error-store";
import { DebugStore } from "./storage/debug-store";
import { CostCalculator } from "./services/cost-calculator";
import { MetricsCollector } from "./services/metrics-collector";
import { UsageLogger } from "./services/usage-logger";
import { DebugLogger } from "./services/debug-logger";
import { EventEmitter } from "./services/event-emitter";
import { ConfigManager } from "./services/config-manager";
import { LogQueryService } from "./services/log-query";
import { TransformerFactory } from "./services/transformer-factory";

// @ts-ignore - HTML import
import frontendHtml from "../../frontend/src/index.html";

function withCORS(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Request router - maps URLs to handlers
 */
async function router(req: Request, context: ServerContext, adminAuth: AdminAuth, clientIp: string): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // Add request ID for correlation
  const requestId = createRequestId();
  const requestLogger = logger.child({ requestId });

  requestLogger.debug("Incoming request", {
    method: req.method,
    path,
    clientIp,
  });

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return withCORS(new Response(null, { status: 204 }));
  }

  // --- Management API (v0) ---
  if (path.startsWith("/v0/")) {
    // Authenticate Admin
    const authError = await adminAuth.validate(req);
    if (authError) return withCORS(authError);

    if (path === "/v0/config") {
      if (!context.configManager) return withCORS(new Response("Config manager not initialized", { status: 503 }));
      return withCORS(await handleConfig(req, context.configManager));
    }

    if (path === "/v0/state") {
      return withCORS(await handleState(req, context));
    }

    if (path.startsWith("/v0/logs")) {
      if (!context.logQueryService) return withCORS(new Response("Log query service not initialized", { status: 503 }));
      return withCORS(await handleLogs(req, context.logQueryService));
    }

    if (path === "/v0/events") {
      if (!context.eventEmitter) return withCORS(new Response("Event emitter not initialized", { status: 503 }));
      return withCORS(await handleEvents(req, context.eventEmitter));
    }
  }

  // --- Standard API ---

  if (path === "/health" && req.method === "GET") {
    return withCORS(handleHealth(req, context.healthMonitor));
  }

  if (path === "/ready" && req.method === "GET") {
    return withCORS(handleReady(req));
  }

  if (path === "/v1/chat/completions" && req.method === "POST") {

    return withCORS(await handleChatCompletions(req, context, requestId, clientIp));
  }

  if (path === "/v1/messages" && req.method === "POST") {
    return withCORS(await handleMessages(req, context, requestId, clientIp));
  }

  if (path === "/v1/models" && req.method === "GET") {
    return withCORS(await handleModels(req, context.config, requestId));
  }



  // 404 for unknown routes
  requestLogger.debug("Route not found", { path });
  return withCORS(Response.json(
    {
      error: "Not Found",
      message: `Route ${path} not found`,
    },
    { status: 404 }
  ));
}

/**
 * Creates and starts the HTTP server
 */
export async function createServer(config: PlexusConfig): Promise<{ server: any; shutdown: () => Promise<void> }> {
  // Initialize resilience services
  const cooldownManager = new CooldownManager(config);
  const healthMonitor = new HealthMonitor(config, cooldownManager);

  // Initialize Management Services (Phase 8)
  const eventEmitter = new EventEmitter(
    config.events?.maxClients,
    config.events?.heartbeatIntervalMs
  );

  const configManager = new ConfigManager(
    // Assume config file path from existing loader logic if possible, 
    // but here we might need to know where it came from.
    // For now, we'll assume default "./config/plexus.yaml" or env
    // Ideally loadConfig returns path too, but for now:
    "config/plexus.yaml", 
    config,
    eventEmitter
  );

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
      config.logging.usage.retentionDays
    );
    await usageStore.initialize();

    errorStore = new ErrorStore(
      config.logging.errors.storagePath,
      config.logging.errors.retentionDays
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
      eventEmitter // Pass event emitter
    );

    logger.info("Observability services initialized");
  }

  // Initialize debug store (shared between Logger and QueryService)
  // We initialize it even if debug logging is disabled, to allow querying historical logs
  debugStore = new DebugStore(
      config.logging.debug?.storagePath || "./logs/debug",
      config.logging.debug?.retentionDays || 7,
      config.logging.debug?.enabled || false
  );
  
  // Always create transformer factory and debugLogger for stream reconstruction and usage tracking
  // The debugStore.store() method will skip persistence if debug logging is disabled
  const transformerFactory = new TransformerFactory();
  
  debugLogger = new DebugLogger({
    enabled: config.logging.debug?.enabled || false,
    storagePath: config.logging.debug?.storagePath || "./logs/debug",
    retentionDays: config.logging.debug?.retentionDays || 7,
  }, debugStore, transformerFactory, usageLogger);
  
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
    logQueryService
  };

  const server = Bun.serve({
    port: config.server.port,
    hostname: config.server.host,
    idleTimeout: 60, // 60 seconds to allow for 30s keep-alive heatbeats for SSE
    development: process.env.NODE_ENV !== "production" ? {
      hmr: true,
      console: true,
    } : false,
    routes: {
      // Frontend UI routes - serve the HTML app
      "/ui": frontendHtml,
    "/ui/*": frontendHtml,
    },
    fetch: (req: Request, server): Promise<Response> | Response => {
  const clientIp = req.headers.get("x-forwarded-for") || server.requestIP(req)?.address || "0.0.0.0";
      return router(req, context, adminAuth, clientIp);
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
