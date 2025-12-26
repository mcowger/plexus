import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { bearerAuth } from "hono/bearer-auth";
import path from "path";
import { fileURLToPath } from "url";
import {
  chatCompletionRequestSchema,
  errorResponseSchema,
  VirtualKeyConfig,
  ProviderType,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelConfig,
} from "@plexus/types";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { configLoader } from "./config/loader.js";
import { registerV1ModelsRoutes } from "./routing/v1models.js";
import { registerConfigRoutes } from "./routing/config.js";
import { logger } from "./utils/logger.js";
import { loggingMiddleware, enableDetailedLogging } from "./middleware/logging.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = new Hono();
const port = 3000;


async function initializeApp() {
  try {
    // Enable detailed logging if needed
    // Uncomment the following line to see full request/response details
    enableDetailedLogging();

    // Load configuration
    const configSnapshot = await configLoader.loadConfiguration();

    logger.info("Configuration loaded successfully");
    logger.info(`Loaded ${configSnapshot.providers.size} providers`);
    logger.info(`Loaded ${configSnapshot.virtualKeys.size} virtual keys`);
    logger.info(`Loaded ${configSnapshot.models.size} models`);
  } catch (error) {
    logger.error("Failed to initialize application:", error);
  }
}

// Error handling middleware (must be first)
app.onError((err, c) => {
  logger.error("Unhandled error:", err);

  // Handle Zod validation errors
  if (err instanceof z.ZodError) {
    return c.json({ error: "Invalid request", details: err.issues }, 400);
  }

  // Handle Hono's HTTPException from bearer auth
  if (err.name === "HTTPException") {
    return c.json({ error: "Unauthorized" }, 401);
  }

  return c.json({ error: "Internal Server Error" }, 500);
});

// Logging middleware
app.use("*", loggingMiddleware({
  skipPaths: ["/favicon.ico", "/__vite_ping__"],
}));

// Authentication middleware for /v1/chat/completions
const authMiddleware = bearerAuth({ token: "virtual-key" });

// Chat Completion Endpoint
app.post(
  "/v1/chat/completions",
  authMiddleware,
  zValidator("json", chatCompletionRequestSchema),
  async (c) => {
    const { messages, model, temperature } = c.req.valid("json");
  }
);



// Register models routes
registerV1ModelsRoutes(app);

// Register config routes
registerConfigRoutes(app);

// Serve frontend
const frontendPath = path.join(__dirname, "../../frontend/dist");
app.use("/*", serveStatic({ root: frontendPath }));
app.get("/*", serveStatic({ path: path.join(frontendPath, "index.html") }));

// Initialize the application
initializeApp()
  .then(() => {
    serve({
      fetch: app.fetch,
      port,
    });

    logger.info(`Server is running on http://localhost:${port}`);
  })
  .catch((error) => {
    logger.error("Failed to start server:", error);
    process.exit(1);
  });
