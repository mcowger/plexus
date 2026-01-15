import type { DebugTraceEntry } from "../types/debug";
import type { ApiType } from "./transformer-factory";
import type { TransformerFactory } from "./transformer-factory";
import type { UsageLogger } from "./usage-logger";
import { DebugStore } from "../storage/debug-store";
import { logger } from "../utils/logger";

/**
 * Configuration for debug logging
 */
export interface DebugConfig {
  enabled: boolean;
  storagePath: string;
  retentionDays: number;
}

/**
 * Service for capturing detailed request/response traces for debugging
 */
export class DebugLogger {
  private store: DebugStore;
  private traces: Map<string, Partial<DebugTraceEntry>> = new Map();
  private transformerFactory?: TransformerFactory;
  private usageLogger?: UsageLogger;

  constructor(
    private config: DebugConfig, 
    store?: DebugStore, 
    transformerFactory?: TransformerFactory,
    usageLogger?: UsageLogger
  ) {
    this.store =
      store || new DebugStore(config.storagePath, config.retentionDays, config.enabled);
    this.transformerFactory = transformerFactory;
    this.usageLogger = usageLogger;
  }

  /**
   * Initialize debug storage
   */
  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      logger.info("Debug logging disabled");
      return;
    }

    await this.store.initialize();
    logger.info("Debug logger initialized", {
      storagePath: this.config.storagePath,
      retentionDays: this.config.retentionDays,
    });
  }

  /**
   * Check if debug mode is enabled
   */
  get enabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Dynamically enable or disable debug logging
   * @param enabled - Whether to enable debug logging
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    this.store.setEnabled(enabled);
    logger.info("Debug logging toggled", { enabled });
  }

  /**
   * Helper to analyze object structure and detect non-serializable values
   * @param obj - Object to analyze
   * @returns Info about the object structure and any non-serializable fields
   */
  private getObjectInfo(obj: unknown): Record<string, unknown> {
    if (obj === null || obj === undefined) {
      return { type: String(obj), serializable: true };
    }

    const type = typeof obj;
    const info: Record<string, unknown> = { type };

    if (type === "object") {
      const objInstance = obj as Record<string, unknown>;
      const nonSerializable: string[] = [];
      const keys: string[] = [];

      // Check if it's a special type
      if (obj instanceof Date) {
        return {
          type: "Date",
          serializable: true,
          value: (obj as Date).toISOString(),
        };
      }
      if (obj instanceof Error) {
        return {
          type: "Error",
          serializable: false,
          message: (obj as Error).message,
        };
      }
      if (obj instanceof ReadableStream) {
        return { type: "ReadableStream", serializable: false };
      }
      if (obj instanceof Blob) {
        const blob = obj as Blob;
        return {
          type: "Blob",
          serializable: false,
          blobType: blob.type,
          size: blob.size,
        };
      }
      if (obj instanceof ArrayBuffer) {
        return {
          type: "ArrayBuffer",
          serializable: false,
          byteLength: (obj as ArrayBuffer).byteLength,
        };
      }
      if (ArrayBuffer.isView(obj)) {
        return { type: "TypedArray", serializable: false };
      }
      if (Array.isArray(obj)) {
        // For arrays, check each element for non-serializable types
        for (let i = 0; i < Math.min(obj.length, 10); i++) {
          const elem = obj[i];
          if (
            typeof elem === "function" ||
            elem instanceof ReadableStream ||
            elem instanceof Blob
          ) {
            nonSerializable.push(`[${i}]`);
          }
        }
        info.isArray = true;
        info.length = obj.length;
      } else {
        // For objects, check top-level keys
        for (const key in objInstance) {
          if (Object.prototype.hasOwnProperty.call(objInstance, key)) {
            keys.push(key);
            const value = objInstance[key];
            const valueType = typeof value;
            if (
              valueType === "function" ||
              value instanceof ReadableStream ||
              value instanceof Blob
            ) {
              nonSerializable.push(key);
            }
          }
        }
        info.keys = keys.slice(0, 20); // Limit to first 20 keys
      }

      // Test JSON.stringify
      try {
        JSON.stringify(obj);
        info.serializable = nonSerializable.length === 0;
      } catch {
        info.serializable = false;
      }

      if (nonSerializable.length > 0) {
        info.nonSerializable = nonSerializable;
      }
    } else if (type === "function") {
      info.serializable = false;
    } else {
      info.serializable = true;
    }

    return info;
  }

  /**
   * Start a debug trace for a request
   * @param requestId - Request ID
   * @param clientApiType - Client's API type
   * @param clientRequest - Client's request body
   * @param headers - Request headers
   */
  startTrace(
    requestId: string,
    clientApiType: ApiType,
    clientRequest: any,
    headers?: Record<string, string>
  ): void {
    this.traces.set(requestId, {
      id: requestId,
      timestamp: new Date().toISOString(),
      clientRequest: {
        apiType: clientApiType,
        body: clientRequest,
        headers: headers || {},
      },
    });

    logger.debug("Started debug trace", { requestId });
  }

  /**
   * Capture the provider request
   * @param requestId - Request ID
   * @param providerApiType - Provider's API type
   * @param providerRequest - Request in provider's format
   * @param headers - Request headers
   */
  captureProviderRequest(
    requestId: string,
    providerApiType: ApiType,
    providerRequest: any,
    headers?: Record<string, string>
  ): void {
    logger.silly("captureProviderRequest", {
      requestId,
      providerApiType,
      requestInfo: this.getObjectInfo(providerRequest),
    });

    const trace = this.traces.get(requestId);
    if (trace) {
      trace.providerRequest = {
        apiType: providerApiType,
        body: providerRequest,
        headers: headers || {},
      };
    }
    logger.debug("Captured provider request", { requestId });
  }

  /**
   * Capture the provider response
   * @param requestId - Request ID
   * @param status - HTTP status code
   * @param headers - Response headers
   * @param body - Response body
   */
  captureProviderResponse(
    requestId: string,
    status: number,
    headers: Record<string, string>,
    body: any
  ): void {
    logger.silly("captureProviderResponse", {
      requestId,
      status,
      bodyInfo: this.getObjectInfo(body),
    });

    const trace = this.traces.get(requestId);
    if (trace) {
      trace.providerResponse = {
        status,
        headers,
        body,
        type: "original",
      };
    }
    logger.debug("Captured provider response", { requestId, status });
  }

  /**
   * Capture the final client response
   * @param requestId - Request ID
   * @param status - HTTP status code
   * @param body - Response body in client's format
   */
  captureClientResponse(requestId: string, status: number, body: any): void {
    logger.silly("captureClientResponse", {
      requestId,
      status,
      bodyInfo: this.getObjectInfo(body),
    });

    const trace = this.traces.get(requestId);
    if (trace) {
      trace.clientResponse = {
        status,
        body,
        type: "original",
      };
    }
    logger.debug("Captured client response", { requestId, status });
  }

  /**
   * Capture a stream snapshot (for streaming requests)
   * @param requestId - Request ID
   * @param chunk - Stream chunk
   */
  captureClientStreamChunk(requestId: string, chunk: string): void {
    const trace = this.traces.get(requestId);
    if (trace) {
      if (!trace.clientStreamChunks) {
        trace.clientStreamChunks = [];
      }

      // We store the raw string directly.
      // This will appear as "data: {...}" in your JSON log.
      trace.clientStreamChunks.push({
        timestamp: new Date().toISOString(),
        chunk: chunk,
      });
    }

    // Keep the silly logger informed
    logger.silly("captureClientStreamChunk", {
      requestId,
      length: chunk.length,
    });
  }

  /**
   * Capture a stream snapshot (for streaming requests)
   * @param requestId - Request ID
   * @param chunk - Stream chunk
   */
  captureProviderStreamChunk(requestId: string, chunk: string): void {
    const trace = this.traces.get(requestId);
    if (trace) {
      if (!trace.providerStreamChunks) {
        trace.providerStreamChunks = [];
      }

      // We store the raw string directly.
      
      trace.providerStreamChunks.push({
        timestamp: new Date().toISOString(),
        chunk: chunk,
      });
    }

    // Keep the silly logger informed
    logger.silly("captureClientStreamChunk", {
      requestId,
      length: chunk.length,
    });
  }

  /**
   * Reconstruct provider response from stream chunks
   */
  private reconstructProviderResponse(
    trace: Partial<DebugTraceEntry>,
    requestId: string
  ): void {
    if (
      !trace.providerStreamChunks ||
      trace.providerStreamChunks.length === 0 ||
      trace.providerResponse?.body ||
      !trace.providerRequest?.apiType ||
      !this.transformerFactory
    ) {
      return;
    }

    try {
      const transformer = this.transformerFactory.getTransformer(
        trace.providerRequest.apiType
      );

      if (!transformer.reconstructResponseFromStream) {
        return;
      }

      // Combine all stream chunks into one string
      const rawSSE = trace.providerStreamChunks.map((item) => item.chunk).join("");
      const reconstructed = transformer.reconstructResponseFromStream(rawSSE);

      if (reconstructed) {
        trace.providerResponse = {
          status: trace.providerResponse?.status || 200,
          headers: trace.providerResponse?.headers || {},
          body: reconstructed,
          type: "reconstructed",
        };

        logger.debug("Reconstructed provider response from stream", {
          requestId,
          apiType: trace.providerRequest.apiType,
        });
      }
    } catch (error) {
      logger.warn("Failed to reconstruct provider response from stream", {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Reconstruct client response from stream chunks
   */
  private reconstructClientResponse(
    trace: Partial<DebugTraceEntry>,
    requestId: string
  ): void {
    if (
      !trace.clientStreamChunks ||
      trace.clientStreamChunks.length === 0 ||
      trace.clientResponse?.body ||
      !trace.clientRequest?.apiType ||
      !this.transformerFactory
    ) {
      return;
    }

    try {
      const transformer = this.transformerFactory.getTransformer(
        trace.clientRequest.apiType
      );

      if (!transformer.reconstructResponseFromStream) {
        return;
      }

      // Combine all stream chunks into one string
      const rawSSE = trace.clientStreamChunks.map((item) => item.chunk).join("");
      const reconstructed = transformer.reconstructResponseFromStream(rawSSE);

      if (reconstructed) {
        trace.clientResponse = {
          status: trace.clientResponse?.status || 200,
          body: reconstructed,
          type: "reconstructed",
        };

        logger.debug("Reconstructed client response from stream", {
          requestId,
          apiType: trace.clientRequest.apiType,
        });
      }
    } catch (error) {
      logger.warn("Failed to reconstruct client response from stream", {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Extract usage from reconstructed client response and update usage log
   * We use the CLIENT response because it contains the complete usage data
   * after transformation and aggregation from all stream chunks
   */
  private async updateUsageFromClientResponse(
    trace: Partial<DebugTraceEntry>,
    requestId: string
  ): Promise<void> {
    if (
      !this.usageLogger ||
      !this.transformerFactory ||
      !trace.clientResponse?.body ||
      trace.clientResponse?.type !== "reconstructed" ||
      !trace.clientRequest?.apiType
    ) {
      return;
    }

    try {
      const transformer = this.transformerFactory.getTransformer(
        trace.clientRequest.apiType
      );

      const clientBody = trace.clientResponse.body;

      // Check if response contains usage data
      if (!clientBody?.usage && !clientBody?.usageMetadata) {
        return;
      }

      const rawUsage = clientBody.usage || clientBody.usageMetadata;
      const unifiedUsage = transformer.parseUsage(rawUsage);

      logger.debug("Extracted usage from reconstructed response", {
        requestId,
        usage: unifiedUsage,
      });

      // Update usage log entry with reconstructed usage data
      await this.usageLogger.updateUsageFromReconstructed(requestId, unifiedUsage);
    } catch (error) {
      logger.warn("Failed to extract usage from reconstructed response", {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Log debug metadata about the trace before storing
   */
  private logTraceMetadata(trace: Partial<DebugTraceEntry>, requestId: string): void {
    logger.debug("About to store trace", {
      requestId,
      hasProviderRequest: !!trace.providerRequest,
      hasProviderResponse: !!trace.providerResponse,
      hasClientResponse: !!trace.clientResponse,
      hasProviderStreamChunks: !!(
        trace.providerStreamChunks && trace.providerStreamChunks.length > 0
      ),
      providerStreamChunkCount: trace.providerStreamChunks?.length || 0,
      hasClientStreamChunks: !!(
        trace.clientStreamChunks && trace.clientStreamChunks.length > 0
      ),
      clientStreamChunkCount: trace.clientStreamChunks?.length || 0,
    });
  }

  /**
   * Complete and store a debug trace
   */
  async completeTrace(requestId: string): Promise<void> {
    // Grab the trace and delete it IMMEDIATELY to prevent race conditions
    // This ensures that if a second tap calls this while we are still
    // 'awaiting' the store, the second tap hits this 'return' and exits.
    const trace = this.traces.get(requestId);
    if (!trace) {
      return;
    }
    this.traces.delete(requestId);

    try {
      // Validate required fields
      if (!trace.id || !trace.timestamp) {
        logger.warn("Incomplete debug trace, skipping storage", { requestId });
        return;
      }

      // Reconstruct responses from stream chunks if needed
      this.reconstructProviderResponse(trace, requestId);
      this.reconstructClientResponse(trace, requestId);

      // Extract usage from reconstructed client response
      await this.updateUsageFromClientResponse(trace, requestId);

      // Log debug metadata
      this.logTraceMetadata(trace, requestId);

      // Store the trace
      await this.store.store(trace as DebugTraceEntry);

      logger.debug("Debug trace completed", { requestId });
    } catch (error) {
      logger.error("Failed to complete debug trace", {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  

  /**
   * Clean up old debug traces
   */
  async cleanup(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    await this.store.cleanup();
  }
}
