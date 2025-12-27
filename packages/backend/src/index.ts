import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { bearerAuth } from "hono/bearer-auth";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import { configLoader } from "./config/loader.js";
import { registerV1ModelsRoutes } from "./routing/v1/models.js";
import { registerV1ChatCompletionsRoutes } from "./routing/v1/chat/completions.js";
import { registerConfigRoutes } from "./routing/config.js";
import { logger } from "./utils/logger.js";
import { loggingMiddleware, enableDetailedLogging } from "./middleware/logging.js";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = new Hono();
const port = 3000;

// Parse command line arguments with yargs
const argv = yargs(hideBin(process.argv))
  .option("config_dir", {
    type: "string",
    description: "Directory containing configuration files",
  })
  .parseSync();

// Use PLEXUS_CONFIG_DIR environment variable
const configDir = process.env.PLEXUS_CONFIG_DIR;

if (!configDir) {
  logger.error("Config directory not specified. Use --config_dir or PLEXUS_CONFIG_DIR environment variable.");
  process.exit(1);
}

logger.info(`Using config directory: ${path.resolve(process.cwd(), configDir)}`);

async function initializeApp() {
  try {
    // Enable detailed logging if needed
    // Uncomment the following line to see full request/response details
    enableDetailedLogging();

    // Set the config directory on the configLoader instance
    if (configDir) {
      configLoader['configPath'] = configDir;
    }
    
    // Load configuration using the default configLoader instance
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




// Register models routes
registerV1ModelsRoutes(app);

// Register chat completions routes
registerV1ChatCompletionsRoutes(app);

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
