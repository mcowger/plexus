import type { Context, Next } from "hono";
import { logger } from "../utils/logger.js";
import type { Hono } from "hono";

/**
 * Hono middleware for logging requests and responses using Winston.
 * 
 * When the logger level is set to "silly", it will log the full contents
 * of both the request and response (headers, body, etc.).
 * 
 * Usage:
 * app.use("*", loggingMiddleware());
 * 
 * @param options - Optional configuration for the middleware
 * @returns Hono middleware function
 */
export function loggingMiddleware(options?: {
  /**
   * Skip logging for specific paths
   */
  skipPaths?: string[];
  /**
   * Include request body in logs (only at silly level)
   */
  includeBody?: boolean;
  /**
   * Include response body in logs (only at silly level)
   */
  includeResponseBody?: boolean;
}) {
  const {
    skipPaths = [],
    includeBody = true,
    includeResponseBody = true,
  } = options || {};

  return async (c: Context, next: Next) => {
    const startTime = Date.now();
    const method = c.req.method;
    const path = c.req.path;
    const query = c.req.query();

    // Skip logging for specified paths
    if (skipPaths.some((skipPath) => path.startsWith(skipPath))) {
      return next();
    }

    // Check if logger is at silly level
    const isSillyLevel = logger.level === 'silly';

    // Log request details
    if (isSillyLevel) {
      // Detailed request logging at silly level
      const headers: Record<string, string> = {};
      for (const [key, value] of c.req.raw.headers.entries()) {
        headers[key] = value;
      }

      const requestLog: any = {
        method,
        path,
        query: Object.keys(query).length > 0 ? query : undefined,
        headers,
      };

      // Include request body if available and enabled
      if (includeBody) {
        try {
          const contentType = c.req.header("content-type");
          if (contentType && contentType.includes("application/json")) {
            const body = await c.req.json();
            requestLog.body = body;
          }
        } catch {
          // If body parsing fails or not JSON, skip it
        }
      }

      logger.silly("Incoming request:", requestLog);
    } else {
      // Basic request logging at normal levels
      const logMessage = query
        ? `${method} ${path}?${new URLSearchParams(query).toString()}`
        : `${method} ${path}`;
      logger.debug(logMessage);
    }

    // Proceed to next middleware
    await next();

    // Calculate request duration
    const duration = Date.now() - startTime;

    // Capture response body at silly level if enabled
    let responseBody: any = undefined;
    if (isSillyLevel && includeResponseBody) {
      try {
        const contentType = c.res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          // Clone the response to read the body without consuming it
          const bodyText = await c.res.clone().text();
          try {
            responseBody = JSON.parse(bodyText);
          } catch {
            responseBody = bodyText;
          }
        }
      } catch {
        // If we can't parse the body, skip it
      }
    }

    // Log response details
    const status = c.res.status;
    const statusEmoji = status >= 500 ? "🔴" : status >= 400 ? "🟡" : "🟢";

    if (isSillyLevel) {
      // Detailed response logging at silly level
      const responseHeaders: Record<string, string> = {};
      for (const [key, value] of c.res.headers.entries()) {
        responseHeaders[key] = value;
      }

      const logData: any = {
        method,
        path,
        status,
        duration: `${duration}ms`,
        headers: responseHeaders,
      };

      // Add response body if captured
      if (responseBody !== undefined) {
        logData.body = responseBody;
      }

      logger.silly(`${statusEmoji} Response sent:`, logData);
    } else {
      // Basic response logging at normal levels
      const statusMessage = `${status} ${statusEmoji}`;
      logger.info(`${method} ${path} ${statusMessage} ${duration}ms`);
    }
  };
}

/**
 * A simplified logging middleware that logs basic request/response info.
 * Use this in production or when you don't need detailed logging.
 */
export function simpleLoggingMiddleware(options?: {
  skipPaths?: string[];
}) {
  const { skipPaths = [] } = options || {};

  return async (c: Context, next: Next) => {
    const startTime = Date.now();
    const method = c.req.method;
    const path = c.req.path;

    // Skip logging for specified paths
    if (skipPaths.some((skipPath) => path.startsWith(skipPath))) {
      return next();
    }

    await next();

    const duration = Date.now() - startTime;
    const status = c.res.status;

    logger.info(`${method} ${path} ${status} ${duration}ms`);
  };
}

/**
 * Configure the logger to use the silly level for detailed logging.
 * Call this at application startup if you want detailed request/response logging.
 */
export function enableDetailedLogging() {
  logger.level = 'silly';
  logger.info("Detailed logging enabled - full request/response details will be logged");
}

/**
 * Configure the logger to use the debug level for normal logging.
 */
export function enableDebugLogging() {
  logger.level = 'debug';
  logger.info("Debug logging enabled");
}

/**
 * Configure the logger to use the info level for minimal logging.
 */
export function enableInfoLogging() {
  logger.level = 'info';
  logger.info("Info logging enabled");
}
