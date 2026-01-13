import type { ApiType } from "../services/transformer-factory";

/**
 * Usage log entry for a completed request
 */
export interface UsageLogEntry {
  id: string; // Unique request ID
  timestamp: string; // ISO timestamp

  // Request info
  clientIp: string;
  apiKey: string; // Key name (not secret)
  apiType: ApiType; // Incoming API format

  // Routing info
  aliasUsed: string; // Requested model/alias
  actualProvider: string; // Resolved provider
  actualModel: string; // Resolved model
  targetApiType: ApiType; // Provider's API format
  passthrough: boolean; // Was transformation skipped?

  // Token usage
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    reasoningTokens: number;
    totalTokens: number;
  };

  // Cost breakdown
  cost: {
    inputCost: number;
    outputCost: number;
    cachedCost: number;
    reasoningCost: number;
    totalCost: number;
    currency: "USD";
    source: "config" | "openrouter" | "estimated";
  };

  // Performance metrics
  metrics: {
    durationMs: number;
    ttftMs: number | null; // Time to first token (streaming)
    tokensPerSecond: number | null;
  };

  // Status
  success: boolean;
  streaming: boolean;
  errorType?: string;
  errorMessage?: string;
}

/**
 * Query parameters for filtering usage logs
 */
export interface UsageQuery {
  startDate?: string;
  endDate?: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  success?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Aggregated usage summary for a time period
 */
export interface UsageSummary {
  period: {
    start: string;
    end: string;
  };
  requests: {
    total: number;
    successful: number;
    failed: number;
  };
  tokens: {
    input: number;
    output: number;
    cachedRead: number;
    cacheCreation: number;
    reasoning: number;
    total: number;
  };
  cost: {
    total: number;
    byProvider: Record<string, number>;
    byModel: Record<string, number>;
  };
  performance: {
    avgDuration: number;
    avgTtft: number;
    p50Duration: number;
    p95Duration: number;
  };
}

/**
 * Error log entry for failed requests
 */
export interface ErrorLogEntry {
  id: string; // Unique request ID
  timestamp: string; // ISO timestamp

  // Request info
  clientIp: string;
  apiKey: string;
  apiType: ApiType;
  requestedModel: string;

  // Routing info (if resolved)
  provider?: string;
  model?: string;

  // Error details
  errorType: string;
  errorMessage: string;
  httpStatus?: number;
  stackTrace?: string;

  // Debug data (if enabled)
  requestBody?: any;
  providerResponse?: any;
}

/**
 * Debug trace entry for detailed request/response capture
 */
export interface DebugTraceEntry {
  id: string; // Request ID
  timestamp: string;

  // Request details
  clientRequest: {
    apiType: ApiType;
    body: any;
    headers: Record<string, string>;
  };

  // Transformation steps
  unifiedRequest: any;
  providerRequest: {
    apiType: ApiType;
    body: any;
    headers: Record<string, string>;
  };

  // Provider response
  providerResponse?: {
    status: number;
    headers: Record<string, string>;
    body: any;
  };

  // Transformed response
  clientResponse?: {
    status: number;
    body: any;
  };

  // Stream snapshots (for streaming requests)
  streamSnapshots?: Array<{
    timestamp: string;
    chunk: any;
  }>;
}
