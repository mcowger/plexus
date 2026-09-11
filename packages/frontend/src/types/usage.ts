import type { Cooldown } from './settings';

export interface Stat {
  label: string;
  value: string | number;
  change?: number;
  icon?: string;
}

export interface UsageData {
  timestamp: string;
  requests: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
}

export interface TodayMetrics {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  totalCost: number;
}

/**
 * Represents one concurrency point returned by the backend.
 *
 * Semantics depend on query mode:
 * - mode='timeline': count is bucketed per provider+model in 1-minute buckets.
 * - mode='live': count is a current in-flight snapshot per provider+model.
 *
 * Used by the Live Metrics concurrency card and usage analytics views.
 */
export interface ConcurrencyData {
  /** The LLM provider name, e.g., "anthropic", "openai", "google" */
  provider: string;
  /** The canonical model name as resolved by the router, e.g., "claude-sonnet-4-20250514" */
  model: string;
  /** Number of requests that started within this 1-minute bucket */
  count: number;
  /** Start of the 1-minute bucket as epoch milliseconds (floored to nearest 60000ms) */
  timestamp: number;
}

export interface DashboardData {
  stats: Stat[];
  usageData: UsageData[];
  cooldowns: Cooldown[];
  todayMetrics: TodayMetrics;
}

export interface PieChartDataPoint {
  name: string;
  requests: number;
  tokens: number;
  [key: string]: string | number; // Index signature for recharts compatibility
}

export interface ProviderPerformanceData {
  provider: string;
  model: string;
  target_model?: string;
  avg_ttft_ms: number;
  min_ttft_ms: number;
  max_ttft_ms: number;
  avg_tokens_per_sec: number;
  min_tokens_per_sec: number;
  max_tokens_per_sec: number;
  avg_e2e_tokens_per_sec: number;
  min_e2e_tokens_per_sec: number;
  max_e2e_tokens_per_sec: number;
  sample_count: number;
  last_updated: number;
}

// Backend Types
export interface UsageRecord {
  requestId: string;
  clientRequestId?: string | null;
  date: string;
  sourceIp?: string;
  apiKey?: string;
  attribution?: string;
  incomingApiType?: string;
  provider?: string;
  incomingModelAlias?: string;
  canonicalModelName?: string | null;
  selectedModelName?: string;
  finalAttemptProvider?: string | null;
  finalAttemptModel?: string | null;
  allAttemptedProviders?: string | null;
  outgoingApiType?: string;
  reasoningEffort?: string | null;
  tokensInput?: number;
  tokensOutput?: number;
  tokensReasoning?: number;
  tokensCached?: number;
  tokensCacheWrite?: number;
  tokensEstimated?: number;
  costInput?: number;
  costOutput?: number;
  costCached?: number;
  costCacheWrite?: number;
  costTotal?: number;
  costSource?: string;
  costMetadata?: string;
  startTime: number;
  durationMs: number | null;
  isStreamed: boolean;
  responseStatus: string;
  ttftMs?: number;
  tokensPerSec?: number;
  hasDebug?: boolean;
  hasError?: boolean;
  isPassthrough?: boolean;
  isRaw?: boolean;
  requestMethod?: string | null;
  requestPath?: string | null;
  // Request metadata
  toolsDefined?: number;
  messageCount?: number;
  parallelToolCallsEnabled?: boolean;
  // Response metadata
  toolCallsCount?: number;
  finishReason?: string;
  // Retry metadata
  attemptCount?: number;
  retryHistory?: string | null;
  // Vision Fallthrough metadata
  isVisionFallthrough?: boolean;
  isDescriptorRequest?: boolean;
  visionFallthroughModel?: string | null;
  // Provider-reported cost
  providerReportedCost?: number;
}

export interface BackendResponse<T> {
  data: T;
  total: number;
  error?: string;
}

export interface UsageSummarySeriesPoint {
  bucketStartMs: number;
  requests: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  tokens: number;
  totalCost: number;
  avgDurationMs: number;
  avgTtftMs: number;
  avgTokensPerSec: number;
}

export type UsageSummaryBreakdown = 'provider' | 'modelAlias' | 'apiKey' | 'status';
export type UsageSummaryExclusion = 'directModels' | 'probe';

export interface UsageSummaryGroup {
  name: string;
  requests: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  totalCost: number;
  avgDurationMs: number;
  totalDurationMs: number;
  avgTtftMs: number;
  avgTokensPerSec: number;
  successRate: number;
}

export interface UsageSummaryBreakdownResult {
  items: UsageSummaryGroup[];
  totalDimensions: number;
  truncated: boolean;
}

export interface UsageSummaryResponse {
  range: 'hour' | 'day' | 'week' | 'month' | 'custom';
  series: UsageSummarySeriesPoint[];
  stats: {
    totalRequests: number;
    totalErrors: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedTokens: number;
    cacheWriteTokens: number;
    totalCost: number;
    avgDurationMs: number;
    totalDurationMs: number;
    avgTtftMs: number;
    avgTokensPerSec: number;
    successRate: number;
  };
  today: TodayMetrics;
  grouped?: Partial<Record<UsageSummaryBreakdown, UsageSummaryBreakdownResult>>;
}

export type UsageRecordField = keyof UsageRecord;

export interface UsageQueryParams<T extends UsageRecordField> {
  limit?: number;
  offset?: number;
  requestId?: string;
  clientRequestId?: string;
  startDate?: string;
  endDate?: string;
  incomingApiType?: string;
  provider?: string;
  incomingModelAlias?: string;
  selectedModelName?: string;
  outgoingApiType?: string;
  responseStatus?: string;
  minDurationMs?: number;
  maxDurationMs?: number;
  fields?: T[];
  cache?: boolean;
}

export type UsageSortField =
  | 'date'
  | 'apiKey'
  | 'provider'
  | 'incomingModelAlias'
  | 'costTotal'
  | 'durationMs';

export type UsageSortDirection = 'asc' | 'desc';
