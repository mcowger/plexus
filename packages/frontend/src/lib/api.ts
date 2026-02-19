import { parse, stringify } from 'yaml';
import { formatNumber } from './format';
import { toBoolean, toIsoString } from './normalize';
import type { QuotaCheckerInfo, QuotaSnapshot, QuotaCheckResult } from '../types/quota';

const API_BASE = ''; // Proxied via server.ts

/**
 * Extract supported API types from the provider configuration.
 * Infers types from api_base_url field: if it's a record/map, the keys are the supported types.
 * If it's a string, we infer the type from the URL pattern.
 * @param apiBaseUrl The api_base_url from provider configuration
 * @returns Array of supported API types (e.g., ["chat"], ["messages"], ["chat", "messages"])
 */
function inferProviderTypes(apiBaseUrl?: string | Record<string, string>): string[] {
  if (!apiBaseUrl) {
    return ['chat']; // Default fallback
  }

  if (typeof apiBaseUrl === 'string') {
    // Single URL - infer type from URL pattern
    const url = apiBaseUrl.toLowerCase();

    if (url.startsWith('oauth://')) {
      return ['oauth'];
    }

    // Check for known patterns
    if (url.includes('anthropic.com')) {
      return ['messages'];
    } else if (url.includes('generativelanguage.googleapis.com')) {
      return ['gemini'];
    } else {
      // Default to 'chat' for OpenAI-compatible APIs
      return ['chat'];
    }
  } else {
    // Record/map format - keys are the supported types
    return Object.keys(apiBaseUrl).filter(key => {
      const value = apiBaseUrl[key];
      return typeof value === 'string' && value.length > 0;
    });
  }
}

const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
  const headers = new Headers(options.headers || {});
  const adminKey = localStorage.getItem('plexus_admin_key');
  if (adminKey) {
    headers.set('x-admin-key', adminKey);
  }
  
  const res = await fetch(url, { ...options, headers });
  
  if (res.status === 401) {
    // If unauthorized, clear key to trigger re-login
    localStorage.removeItem('plexus_admin_key');
    // Optional: Dispatch event or reload. 
    // Usually the React Context will catch this on next refresh, or we can reload here.
    if (window.location.pathname !== '/ui/login') {
       window.location.href = '/ui/login';
    }
  }
  return res;
};

function normalizeQuotaSnapshot(snapshot: QuotaSnapshot): QuotaSnapshot {
  return {
    ...snapshot,
    checkedAt: toIsoString(snapshot.checkedAt) ?? new Date(0).toISOString(),
    resetsAt: toIsoString(snapshot.resetsAt),
    createdAt: toIsoString(snapshot.createdAt) ?? new Date(0).toISOString(),
    success: toBoolean(snapshot.success),
  };
}

function normalizeQuotaCheckerInfo(checker: QuotaCheckerInfo): QuotaCheckerInfo {
  return {
    ...checker,
    latest: Array.isArray(checker.latest) ? checker.latest.map(normalizeQuotaSnapshot) : [],
  };
}

function normalizeQuotaCheckResult(result: QuotaCheckResult): QuotaCheckResult {
  return {
    ...result,
    checkedAt: toIsoString(result.checkedAt) ?? new Date(0).toISOString(),
    success: toBoolean(result.success),
    windows: result.windows?.map((window) => ({
      ...window,
      resetsAt: window.resetsAt ? (toIsoString(window.resetsAt) ?? undefined) : undefined,
    })),
  };
}

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

export interface DashboardData {
    stats: Stat[];
    usageData: UsageData[];
    cooldowns: Cooldown[];
    todayMetrics: TodayMetrics;
}

export interface LiveRequestSnapshot {
    requestId: string;
    date: string;
    provider: string;
    model: string;
    responseStatus: string;
    totalTokens: number;
    costTotal: number;
    durationMs: number;
    ttftMs: number;
    tokensPerSec: number;
}

export interface LiveProviderSnapshot {
    provider: string;
    requests: number;
    successes: number;
    errors: number;
    successRate: number;
    totalTokens: number;
    totalCost: number;
    avgDurationMs: number;
    avgTtftMs: number;
    avgTokensPerSec: number;
}

export interface LiveDashboardSnapshot {
    windowMinutes: number;
    requestCount: number;
    successCount: number;
    errorCount: number;
    successRate: number;
    totalTokens: number;
    totalCost: number;
    tokensPerMinute: number;
    costPerMinute: number;
    avgDurationMs: number;
    avgTtftMs: number;
    avgTokensPerSec: number;
    providers: LiveProviderSnapshot[];
    recentRequests: LiveRequestSnapshot[];
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
  sample_count: number;
  last_updated: number;
}

export interface Provider {
  id: string;
  name: string;
  type: string | string[];
  apiBaseUrl?: string | Record<string, string>;
  apiKey: string;
  oauthProvider?: string;
  oauthAccount?: string;
  enabled: boolean;
  estimateTokens?: boolean;
  discount?: number;
  headers?: Record<string, string>;
  extraBody?: Record<string, any>;
  models?: string[] | Record<string, any>;
  quotaChecker?: {
    type?: string;
    enabled: boolean;
    intervalMinutes: number;
    options?: Record<string, unknown>;
  };
}

export interface McpServer {
  upstream_url: string;
  enabled: boolean;
  headers?: Record<string, string>;
}

export interface McpLogRecord {
  request_id: string;
  created_at: string;
  start_time: number;
  duration_ms: number | null;
  server_name: string;
  upstream_url: string;
  method: 'POST' | 'GET' | 'DELETE';
  jsonrpc_method: string | null;
  tool_name: string | null;
  api_key: string | null;
  attribution: string | null;
  source_ip: string | null;
  response_status: number | null;
  is_streamed: boolean;
  has_debug: boolean;
  error_code: string | null;
  error_message: string | null;
}

export interface Model {
  id: string;
  name: string;
  providerId: string;
  pricingSource?: string;
    type?: 'chat' | 'embeddings' | 'transcriptions' | 'speech' | 'image' | 'responses';
}

export interface Alias {
    id: string;
    aliases?: string[];
    selector?: string;
    priority?: 'selector' | 'api_match';
  type?: 'chat' | 'embeddings' | 'transcriptions' | 'speech' | 'image' | 'responses';
    targets: Array<{ provider: string; model: string; apiType?: string[]; enabled?: boolean }>;
}

export interface InferenceError {
    id: number;
    requestId: string;
    date: string;
    errorMessage: string;
    errorStack?: string;
    details?: string | {
        apiType?: string;
        provider?: string;
        targetModel?: string;
        targetApiType?: string;
        url?: string;
        headers?: Record<string, string>;
        statusCode?: number;
        providerResponse?: string;
    };
    createdAt: number;
}

export interface Cooldown {
    provider: string;
    model: string;
    accountId?: string | null;
    expiry: number;
    timeRemainingMs: number;
}

// Backend Types
export interface UsageRecord {
    requestId: string;
    date: string;
    sourceIp?: string;
    apiKey?: string;
    attribution?: string;
    incomingApiType?: string;
    provider?: string;
    incomingModelAlias?: string;
    selectedModelName?: string;
    outgoingApiType?: string;
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
    durationMs: number;
    isStreamed: boolean;
    responseStatus: string;
    ttftMs?: number;
    tokensPerSec?: number;
    hasDebug?: boolean;
    hasError?: boolean;
    isPassthrough?: boolean;
    // Request metadata
    toolsDefined?: number;
    messageCount?: number;
    parallelToolCallsEnabled?: boolean;
    // Response metadata
    toolCallsCount?: number;
    finishReason?: string;
    // Retry metadata
    attemptCount?: number;
}

interface BackendResponse<T> {
    data: T;
    total: number;
    error?: string;
}

export interface UsageSummarySeriesPoint {
    bucketStartMs: number;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    cacheWriteTokens: number;
    tokens: number;
    totalCost: number;
    avgDurationMs: number;
    avgTtftMs: number;
}

export interface UsageSummaryResponse {
    range: 'hour' | 'day' | 'week' | 'month';
    series: UsageSummarySeriesPoint[];
    stats: {
        totalRequests: number;
        totalTokens: number;
        totalCost: number;
        avgDurationMs: number;
    };
    today: TodayMetrics;
}

type UsageRecordField = keyof UsageRecord;

interface UsageQueryParams<T extends UsageRecordField> {
    limit?: number;
    offset?: number;
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
    /** Filter out records with null/unknown provider */
    excludeUnknownProvider?: boolean;
    /** Comma-separated list of enabled provider names to include */
    enabledProviders?: string;
}

const USAGE_CACHE_TTL_MS = 20000;
const usageRequestCache = new Map<string, { expiresAt: number; promise: Promise<BackendResponse<any>> }>();
const summaryRequestCache = new Map<string, { expiresAt: number; promise: Promise<UsageSummaryResponse> }>();

const CONFIG_CACHE_TTL_MS = 20000;
const configRequestCache = new Map<string, { expiresAt: number; promise: Promise<PlexusConfig | null> }>();

const VALID_QUOTA_CHECKER_TYPES = new Set(['synthetic', 'naga', 'nanogpt', 'openai-codex', 'claude-code', 'zai', 'moonshot', 'minimax', 'openrouter', 'kilo']);

const normalizeProviderQuotaChecker = (
    checker?: { type?: string; enabled?: boolean; intervalMinutes?: number; options?: Record<string, unknown> }
): Provider['quotaChecker'] | undefined => {
    if (!checker) return undefined;

    const type = checker.type?.trim();
    if (!type) return undefined;

    const isValidType = VALID_QUOTA_CHECKER_TYPES.has(type);
    return {
        type,
        enabled: isValidType ? checker.enabled !== false : false,
        intervalMinutes: Math.max(1, Number(checker.intervalMinutes || 30)),
        options: checker.options
    };
};

const USAGE_PAGE_FIELDS: UsageRecordField[] = [
    'date',
    'tokensInput',
    'tokensOutput',
    'tokensCached',
    'tokensCacheWrite',
    'incomingModelAlias',
    'provider',
    'apiKey'
];

const LIVE_DASHBOARD_FIELDS: UsageRecordField[] = [
    'requestId',
    'date',
    'provider',
    'incomingModelAlias',
    'selectedModelName',
    'responseStatus',
    'tokensInput',
    'tokensOutput',
    'tokensReasoning',
    'tokensCached',
    'costTotal',
    'durationMs',
    'ttftMs',
    'tokensPerSec'
];


const normalizeNow = (): Date => {
    const now = new Date();
    now.setSeconds(0, 0);
    return now;
};

const getUsageRangeConfig = (range: 'hour' | 'day' | 'week' | 'month', now: Date) => {
    const startDate = new Date(now);
    let bucketFormat: (d: Date) => string;
    let buckets = 0;
    let step = 0;

    switch (range) {
        case 'hour':
            startDate.setHours(startDate.getHours() - 1);
            bucketFormat = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            buckets = 60;
            step = 60 * 1000;
            break;
        case 'day':
            startDate.setHours(startDate.getHours() - 24);
            bucketFormat = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            buckets = 24;
            step = 60 * 60 * 1000;
            break;
        case 'month':
            startDate.setDate(startDate.getDate() - 30);
            bucketFormat = (d) => d.toLocaleDateString();
            buckets = 30;
            step = 24 * 60 * 60 * 1000;
            break;
        case 'week':
        default:
            startDate.setDate(startDate.getDate() - 7);
            bucketFormat = (d) => d.toLocaleDateString();
            buckets = 7;
            step = 24 * 60 * 60 * 1000;
            break;
    }

    return { startDate, bucketFormat, buckets, step };
};

const buildUsageSeries = (
    records: Array<Partial<UsageRecord>>,
    range: 'hour' | 'day' | 'week' | 'month',
    now: Date
): UsageData[] => {
    const { startDate, bucketFormat, buckets, step } = getUsageRangeConfig(range, now);
    const grouped: Record<string, UsageData> = {};
    const nowMs = now.getTime();

    for (let i = buckets; i >= 0; i--) {
        const t = new Date(nowMs - (i * step));
        if (range === 'day') t.setMinutes(0, 0, 0);
        if (range === 'week' || range === 'month') t.setHours(0, 0, 0, 0);

        const key = bucketFormat(t);
        if (!grouped[key]) {
            grouped[key] = {
                timestamp: key,
                requests: 0,
                tokens: 0,
                inputTokens: 0,
                outputTokens: 0,
                cachedTokens: 0,
                cacheWriteTokens: 0
            };
        }
    }

    records.forEach((record) => {
        if (!record.date) return;
        const d = new Date(record.date);
        if (d < startDate) return;

        if (range === 'day') d.setMinutes(0, 0, 0);
        if (range === 'week' || range === 'month') d.setHours(0, 0, 0, 0);

        const key = bucketFormat(d);
        if (!grouped[key]) {
            grouped[key] = {
                timestamp: key,
                requests: 0,
                tokens: 0,
                inputTokens: 0,
                outputTokens: 0,
                cachedTokens: 0,
                cacheWriteTokens: 0
            };
        }

        const inputTokens = record.tokensInput || 0;
        const outputTokens = record.tokensOutput || 0;
        const cachedTokens = record.tokensCached || 0;
        const cacheWriteTokens = record.tokensCacheWrite || 0;

        grouped[key].requests++;
        grouped[key].tokens += inputTokens + outputTokens + cachedTokens + cacheWriteTokens;
        grouped[key].inputTokens += inputTokens;
        grouped[key].outputTokens += outputTokens;
        grouped[key].cachedTokens += cachedTokens;
        grouped[key].cacheWriteTokens += cacheWriteTokens;
    });

    return Object.values(grouped);
};

const formatBucketLabel = (range: 'hour' | 'day' | 'week' | 'month', date: Date) => {
    if (range === 'hour' || range === 'day') {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString();
};

const buildSummarySeries = (
    summary: UsageSummaryResponse,
    now: Date
): UsageData[] => {
    const { buckets, step } = getUsageRangeConfig(summary.range, now);
    const grouped: Record<string, UsageData> = {};
    const stepMs = step;
    const alignedNowMs = Math.floor(now.getTime() / stepMs) * stepMs;
    const startMs = alignedNowMs - (buckets * stepMs);
    const byBucket = new Map(summary.series.map(point => [point.bucketStartMs, point]));

    for (let i = 0; i <= buckets; i++) {
        const bucketStartMs = startMs + (i * stepMs);
        const bucketDate = new Date(bucketStartMs);
        const label = formatBucketLabel(summary.range, bucketDate);
        const point = byBucket.get(bucketStartMs);
        const inputTokens = point?.inputTokens || 0;
        const outputTokens = point?.outputTokens || 0;
        const cachedTokens = point?.cachedTokens || 0;
        const cacheWriteTokens = point?.cacheWriteTokens || 0;

        grouped[label] = {
            timestamp: label,
            requests: point?.requests || 0,
            tokens: point?.tokens || inputTokens + outputTokens + cachedTokens + cacheWriteTokens,
            inputTokens,
            outputTokens,
            cachedTokens,
            cacheWriteTokens
        };
    }

    return Object.values(grouped);
};

const buildUsageQuery = <T extends UsageRecordField>(params: UsageQueryParams<T>) => {
    const searchParams = new URLSearchParams();

    if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
    if (params.offset !== undefined) searchParams.set('offset', String(params.offset));
    if (params.startDate) searchParams.set('startDate', params.startDate);
    if (params.endDate) searchParams.set('endDate', params.endDate);
    if (params.incomingApiType) searchParams.set('incomingApiType', params.incomingApiType);
    if (params.provider) searchParams.set('provider', params.provider);
    if (params.incomingModelAlias) searchParams.set('incomingModelAlias', params.incomingModelAlias);
    if (params.selectedModelName) searchParams.set('selectedModelName', params.selectedModelName);
    if (params.outgoingApiType) searchParams.set('outgoingApiType', params.outgoingApiType);
    if (params.responseStatus) searchParams.set('responseStatus', params.responseStatus);
    if (params.minDurationMs !== undefined) searchParams.set('minDurationMs', String(params.minDurationMs));
    if (params.maxDurationMs !== undefined) searchParams.set('maxDurationMs', String(params.maxDurationMs));

    // Provider filtering - exclude unknown/null providers
    if (params.excludeUnknownProvider) searchParams.set('excludeUnknownProvider', 'true');

    // Provider filtering - only include enabled providers
    if (params.enabledProviders) searchParams.set('enabledProviders', params.enabledProviders);

    if (params.fields && params.fields.length > 0) {
        const fieldsValue = [...params.fields].sort().join(',');
        searchParams.set('fields', fieldsValue);
    }

    return searchParams;
};

const fetchUsageRecords = async <T extends UsageRecordField>(
    params: UsageQueryParams<T>
): Promise<BackendResponse<Pick<UsageRecord, T>[]>> => {
    const searchParams = buildUsageQuery(params);
    const queryString = searchParams.toString();
    const url = queryString ? `${API_BASE}/v0/management/usage?${queryString}` : `${API_BASE}/v0/management/usage`;

    if (params.cache) {
        const cached = usageRequestCache.get(queryString);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.promise as Promise<BackendResponse<Pick<UsageRecord, T>[]>>;
        }

        const promise = (async () => {
            const res = await fetchWithAuth(url);
            if (!res.ok) throw new Error('Failed to fetch usage');
            return await res.json() as BackendResponse<Pick<UsageRecord, T>[]>;
        })();

        usageRequestCache.set(queryString, { expiresAt: Date.now() + USAGE_CACHE_TTL_MS, promise });
        promise.catch(() => usageRequestCache.delete(queryString));
        return promise;
    }

    const res = await fetchWithAuth(url);
    if (!res.ok) throw new Error('Failed to fetch usage');
    return await res.json() as BackendResponse<Pick<UsageRecord, T>[]>;
};

const fetchUsageSummary = async (
    range: 'hour' | 'day' | 'week' | 'month',
    cache = true,
    filters?: { excludeUnknownProvider?: boolean; enabledProviders?: string }
) => {
    const params = new URLSearchParams();
    params.set('range', range);
    if (filters?.excludeUnknownProvider) params.set('excludeUnknownProvider', 'true');
    if (filters?.enabledProviders) params.set('enabledProviders', filters.enabledProviders);

    const queryString = params.toString();
    const url = `${API_BASE}/v0/management/usage/summary?${queryString}`;

    if (cache) {
        const cached = summaryRequestCache.get(queryString);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.promise;
        }

        const promise = (async () => {
            const res = await fetchWithAuth(url);
            if (!res.ok) throw new Error('Failed to fetch usage summary');
            return await res.json() as UsageSummaryResponse;
        })();

        summaryRequestCache.set(queryString, { expiresAt: Date.now() + USAGE_CACHE_TTL_MS, promise });
        promise.catch(() => summaryRequestCache.delete(queryString));
        return promise;
    }

    const res = await fetchWithAuth(url);
    if (!res.ok) throw new Error('Failed to fetch usage summary');
    return await res.json() as UsageSummaryResponse;
};

const fetchConfigCached = async (): Promise<PlexusConfig | null> => {
    const cached = configRequestCache.get('config');
    if (cached && cached.expiresAt > Date.now()) {
        return cached.promise;
    }

    const promise = (async () => {
        const res = await fetchWithAuth(`${API_BASE}/v0/management/config`);
        if (!res.ok) throw new Error('Failed to fetch config');
        const configText = await res.text();
        try {
            return parse(configText) as PlexusConfig;
        } catch {
            return null;
        }
    })();

    configRequestCache.set('config', { expiresAt: Date.now() + CONFIG_CACHE_TTL_MS, promise });
    promise.catch(() => configRequestCache.delete('config'));
    return promise;
};

/**
 * Get comma-separated list of enabled provider names from config
 * This is used for filtering dashboards to only show enabled providers
 */
const getEnabledProvidersList = async (): Promise<string | undefined> => {
    const config = await fetchConfigCached();
    if (!config?.providers) return undefined;

    const enabled = Object.entries(config.providers)
        .filter(([_, p]) => p.enabled !== false) // Default to enabled if not specified
        .map(([name, _]) => name);

    return enabled.length > 0 ? enabled.join(',') : undefined;
};

interface PlexusConfig {
    providers: Record<string, {
        type?: string | string[]; // Optional for backward compatibility, but will be inferred from api_base_url
        api_key?: string;
        oauth_provider?: string;
        oauth_account?: string;
        api_base_url?: string | Record<string, string>;
        display_name?: string;
        models?: string[] | Record<string, any>;
        enabled?: boolean; // Custom field we might want to preserve if we could
        estimateTokens?: boolean;
        discount?: number;
        headers?: Record<string, string>;
        extraBody?: Record<string, any>;
        quota_checker?: {
            type?: string;
            enabled?: boolean;
            intervalMinutes?: number;
            options?: Record<string, unknown>;
        };
    }>;
    models?: Record<string, any>;
    keys?: Record<string, KeyConfig>;
    quotas?: QuotaConfig[];
}

export interface KeyConfig {
    key: string; // The user-facing alias/name for the key (e.g. 'my-app')
    secret: string; // The actual sk-uuid
    comment?: string;
    quota?: string; // Optional quota assignment
}

export interface UserQuota {
    type: 'rolling' | 'daily' | 'weekly';
    limitType: 'requests' | 'tokens';
    limit: number;
    duration?: string; // Required for rolling type
}

export interface QuotaConfig {
  id: string;
  type: 'synthetic' | 'naga' | 'nanogpt' | 'codex' | 'claude-code' | 'zai' | 'moonshot' | 'minimax' | 'openrouter' | 'kilo';
    provider: string;
    enabled: boolean;
    intervalMinutes: number;
    options: {
        apiKey?: string;
        endpoint?: string;
        max?: number;
        oauthProvider?: string;
        oauthAccountId?: string;
    };
    implicit?: boolean;
}

export interface OAuthProviderInfo {
    id: string;
    name: string;
    usesCallbackServer: boolean;
}

export interface OAuthAuthInfo {
    url: string;
    instructions?: string;
}

export interface OAuthPrompt {
    message: string;
    placeholder?: string;
    allowEmpty?: boolean;
}

export interface OAuthSession {
    id: string;
    providerId: string;
    accountId: string;
    status: string;
    authInfo?: OAuthAuthInfo;
    prompt?: OAuthPrompt;
    progress: string[];
    error?: string;
    createdAt: number;
    updatedAt: number;
}

export interface OAuthCredentialStatus {
    ready: boolean;
}

export const formatLargeNumber = formatNumber;

export const STAT_LABELS = {
    REQUESTS: 'Total Requests',
    PROVIDERS: 'Active Providers',
    TOKENS: 'Total Tokens',
    DURATION: 'Avg. Duration'
} as const;

export const api = {
  getCooldowns: async (): Promise<Cooldown[]> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/cooldowns`);
          if (!res.ok) throw new Error('Failed to fetch cooldowns');
          return await res.json();
      } catch (e) {
          console.error("API Error getCooldowns", e);
          return [];
      }
  },

  clearCooldown: async (provider?: string, model?: string): Promise<void> => {
      let url: string;
      if (provider) {
          url = `${API_BASE}/v0/management/cooldowns/${provider}`;
          if (model) {
              url += `?model=${encodeURIComponent(model)}`;
          }
      } else {
          url = `${API_BASE}/v0/management/cooldowns`;
      }

      const res = await fetchWithAuth(url, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to clear cooldown');
  },

  getStats: async (): Promise<Stat[]> => {
    try {
        const now = normalizeNow();
        const startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 7);
        const enabledProviders = await getEnabledProvidersList();
        const usageResponse = await fetchUsageRecords({
            limit: 1000,
            startDate: startDate.toISOString(),
            fields: ['tokensInput', 'tokensOutput', 'tokensCached', 'tokensCacheWrite', 'durationMs'],
            cache: true,
            excludeUnknownProvider: true,
            enabledProviders
        });

        const config = await fetchConfigCached();
        const activeProviders = config ? Object.keys(config.providers || {}).length : '-';

        const records = usageResponse.data || [];
        const totalRequests = usageResponse.total;
        const totalTokens = records.reduce(
            (acc, r) => acc + (r.tokensInput || 0) + (r.tokensOutput || 0) + (r.tokensCached || 0) + (r.tokensCacheWrite || 0),
            0
        );
        const avgLatency = records.length
            ? Math.round(records.reduce((acc, r) => acc + (r.durationMs || 0), 0) / records.length)
            : 0;

        return [
            { label: STAT_LABELS.REQUESTS, value: formatNumber(totalRequests, 0) },
            { label: STAT_LABELS.PROVIDERS, value: activeProviders },
            { label: STAT_LABELS.TOKENS, value: formatLargeNumber(totalTokens) },
            { label: STAT_LABELS.DURATION, value: avgLatency + 'ms' },
        ];
    } catch (e) {
        console.error("API Error getStats", e);
        return [
            { label: STAT_LABELS.REQUESTS, value: '-' },
            { label: STAT_LABELS.PROVIDERS, value: '-' },
            { label: STAT_LABELS.TOKENS, value: '-' },
            { label: STAT_LABELS.DURATION, value: '-' },
        ];
    }
  },

  getDashboardData: async (range: 'hour' | 'day' | 'week' | 'month' = 'day'): Promise<DashboardData> => {
    try {
        const now = normalizeNow();
        const [summary, cooldowns, config] = await Promise.all([
            fetchUsageSummary(range, true, { excludeUnknownProvider: true, enabledProviders: await getEnabledProvidersList() }),
            api.getCooldowns(),
            fetchConfigCached()
        ]);

        const usageData = buildSummarySeries(summary, now);
        const totalRequests = summary.stats.totalRequests || 0;
        const totalTokens = summary.stats.totalTokens || 0;
        const avgLatency = Math.round(summary.stats.avgDurationMs || 0);
        const activeProviders = config ? Object.keys(config.providers || {}).length : '-';

        const stats: Stat[] = [
            { label: STAT_LABELS.REQUESTS, value: formatNumber(totalRequests, 0) },
            { label: STAT_LABELS.PROVIDERS, value: activeProviders },
            { label: STAT_LABELS.TOKENS, value: formatLargeNumber(totalTokens) },
            { label: STAT_LABELS.DURATION, value: avgLatency + 'ms' },
        ];

        return {
            stats,
            usageData,
            cooldowns,
            todayMetrics: summary.today
        };
    } catch (e) {
        console.error('API Error getDashboardData', e);
        return {
            stats: [
                { label: STAT_LABELS.REQUESTS, value: '-' },
                { label: STAT_LABELS.PROVIDERS, value: '-' },
                { label: STAT_LABELS.TOKENS, value: '-' },
                { label: STAT_LABELS.DURATION, value: '-' },
            ],
            usageData: [],
            cooldowns: [],
            todayMetrics: {
                requests: 0,
                inputTokens: 0,
                outputTokens: 0,
                reasoningTokens: 0,
                cachedTokens: 0,
                cacheWriteTokens: 0,
                totalCost: 0
            }
        };
    }
  },

  getUsageSummary: async (
    range: 'hour' | 'day' | 'week' | 'month' = 'day',
    filters?: { excludeUnknownProvider?: boolean; enabledProviders?: string }
  ): Promise<UsageSummaryResponse> => {
    return fetchUsageSummary(range, true, {
      excludeUnknownProvider: filters?.excludeUnknownProvider,
      enabledProviders: filters?.enabledProviders
    });
  },

  getLiveDashboardSnapshot: async (windowMinutes: number = 5, limit: number = 500): Promise<LiveDashboardSnapshot> => {
    const safeWindowMinutes = Math.max(1, Math.floor(windowMinutes));
    const safeLimit = Math.max(50, Math.min(5000, Math.floor(limit)));
    const emptySnapshot: LiveDashboardSnapshot = {
      windowMinutes: safeWindowMinutes,
      requestCount: 0,
      successCount: 0,
      errorCount: 0,
      successRate: 1,
      totalTokens: 0,
      totalCost: 0,
      tokensPerMinute: 0,
      costPerMinute: 0,
      avgDurationMs: 0,
      avgTtftMs: 0,
      avgTokensPerSec: 0,
      providers: [],
      recentRequests: []
    };

    try {
      const windowStartMs = Date.now() - (safeWindowMinutes * 60 * 1000);
      const startDate = new Date(windowStartMs).toISOString();
      const enabledProviders = await getEnabledProvidersList();
      const usageResponse = await fetchUsageRecords({
        limit: safeLimit,
        startDate,
        fields: LIVE_DASHBOARD_FIELDS,
        cache: false,
        excludeUnknownProvider: true,
        enabledProviders
      });

      const toNumber = (value: unknown) => {
        const parsed = Number(value ?? 0);
        return Number.isFinite(parsed) ? parsed : 0;
      };

      const records = (usageResponse.data || [])
        .filter((record) => {
          const timestamp = Date.parse(record.date || '');
          return Number.isFinite(timestamp) && timestamp >= windowStartMs;
        })
        .sort((a, b) => Date.parse(b.date || '') - Date.parse(a.date || ''));

      let requestCount = 0;
      let successCount = 0;
      let errorCount = 0;
      let totalTokens = 0;
      let totalCost = 0;
      let durationSum = 0;
      let durationSamples = 0;
      let ttftSum = 0;
      let ttftSamples = 0;
      let tokensPerSecSum = 0;
      let tokensPerSecSamples = 0;

      const providerStats = new Map<string, {
        requests: number;
        successes: number;
        errors: number;
        totalTokens: number;
        totalCost: number;
        durationSum: number;
        durationSamples: number;
        ttftSum: number;
        ttftSamples: number;
        tokensPerSecSum: number;
        tokensPerSecSamples: number;
      }>();

      for (const record of records) {
        requestCount += 1;

        const provider = record.provider?.trim() || 'unknown';
        const status = (record.responseStatus || 'unknown').toLowerCase();
        const isSuccess = status === 'success';

        if (isSuccess) {
          successCount += 1;
        } else {
          errorCount += 1;
        }

        const inputTokens = toNumber(record.tokensInput);
        const outputTokens = toNumber(record.tokensOutput);
        const reasoningTokens = toNumber(record.tokensReasoning);
        const cachedTokens = toNumber(record.tokensCached);
        const requestTokens = inputTokens + outputTokens + reasoningTokens + cachedTokens;
        const requestCost = toNumber(record.costTotal);
        const durationMs = toNumber(record.durationMs);
        const ttftMs = toNumber(record.ttftMs);
        const tokensPerSec = toNumber(record.tokensPerSec);

        totalTokens += requestTokens;
        totalCost += requestCost;

        if (durationMs > 0) {
          durationSum += durationMs;
          durationSamples += 1;
        }
        if (ttftMs > 0) {
          ttftSum += ttftMs;
          ttftSamples += 1;
        }
        if (tokensPerSec > 0) {
          tokensPerSecSum += tokensPerSec;
          tokensPerSecSamples += 1;
        }

        const existingProvider = providerStats.get(provider) ?? {
          requests: 0,
          successes: 0,
          errors: 0,
          totalTokens: 0,
          totalCost: 0,
          durationSum: 0,
          durationSamples: 0,
          ttftSum: 0,
          ttftSamples: 0,
          tokensPerSecSum: 0,
          tokensPerSecSamples: 0
        };

        existingProvider.requests += 1;
        existingProvider.successes += isSuccess ? 1 : 0;
        existingProvider.errors += isSuccess ? 0 : 1;
        existingProvider.totalTokens += requestTokens;
        existingProvider.totalCost += requestCost;

        if (durationMs > 0) {
          existingProvider.durationSum += durationMs;
          existingProvider.durationSamples += 1;
        }
        if (ttftMs > 0) {
          existingProvider.ttftSum += ttftMs;
          existingProvider.ttftSamples += 1;
        }
        if (tokensPerSec > 0) {
          existingProvider.tokensPerSecSum += tokensPerSec;
          existingProvider.tokensPerSecSamples += 1;
        }

        providerStats.set(provider, existingProvider);
      }

      const providers: LiveProviderSnapshot[] = Array.from(providerStats.entries())
        .map(([provider, stats]) => ({
          provider,
          requests: stats.requests,
          successes: stats.successes,
          errors: stats.errors,
          successRate: stats.requests > 0 ? stats.successes / stats.requests : 1,
          totalTokens: stats.totalTokens,
          totalCost: stats.totalCost,
          avgDurationMs: stats.durationSamples > 0 ? stats.durationSum / stats.durationSamples : 0,
          avgTtftMs: stats.ttftSamples > 0 ? stats.ttftSum / stats.ttftSamples : 0,
          avgTokensPerSec: stats.tokensPerSecSamples > 0 ? stats.tokensPerSecSum / stats.tokensPerSecSamples : 0
        }))
        .sort((a, b) => b.requests - a.requests);

      const recentRequests: LiveRequestSnapshot[] = records.slice(0, 20).map((record) => {
        const inputTokens = toNumber(record.tokensInput);
        const outputTokens = toNumber(record.tokensOutput);
        const reasoningTokens = toNumber(record.tokensReasoning);
        const cachedTokens = toNumber(record.tokensCached);

        return {
          requestId: String(record.requestId || ''),
          date: String(record.date || new Date().toISOString()),
          provider: String(record.provider || 'unknown'),
          model: String(record.selectedModelName || record.incomingModelAlias || 'unknown'),
          responseStatus: String(record.responseStatus || 'unknown'),
          totalTokens: inputTokens + outputTokens + reasoningTokens + cachedTokens,
          costTotal: toNumber(record.costTotal),
          durationMs: toNumber(record.durationMs),
          ttftMs: toNumber(record.ttftMs),
          tokensPerSec: toNumber(record.tokensPerSec)
        };
      });

      return {
        windowMinutes: safeWindowMinutes,
        requestCount,
        successCount,
        errorCount,
        successRate: requestCount > 0 ? successCount / requestCount : 1,
        totalTokens,
        totalCost,
        tokensPerMinute: totalTokens / safeWindowMinutes,
        costPerMinute: totalCost / safeWindowMinutes,
        avgDurationMs: durationSamples > 0 ? durationSum / durationSamples : 0,
        avgTtftMs: ttftSamples > 0 ? ttftSum / ttftSamples : 0,
        avgTokensPerSec: tokensPerSecSamples > 0 ? tokensPerSecSum / tokensPerSecSamples : 0,
        providers,
        recentRequests
      };
    } catch (e) {
      console.error('API Error getLiveDashboardSnapshot', e);
      return emptySnapshot;
    }
  },

  subscribeToUsageEvents: (handlers: {
    onLog: (record: UsageRecord) => void;
    onError?: (event: Event) => void;
  }, filters?: {
    excludeUnknownProvider?: boolean;
    enabledProviders?: string;
  }): (() => void) => {
    const params = new URLSearchParams();
    if (filters?.excludeUnknownProvider) params.set('excludeUnknownProvider', 'true');
    if (filters?.enabledProviders) params.set('enabledProviders', filters.enabledProviders);

    const queryString = params.toString();
    const streamUrl = `${API_BASE}/v0/management/events${queryString ? `?${queryString}` : ''}`;
    const source = new EventSource(streamUrl);

    const onLogEvent: EventListener = (event) => {
      try {
        const messageEvent = event as MessageEvent<string>;
        if (!messageEvent.data) {
          return;
        }

        const parsed = JSON.parse(messageEvent.data) as UsageRecord;
        handlers.onLog(parsed);
      } catch (error) {
        console.error('Failed to parse usage stream event', error);
      }
    };

    source.addEventListener('log', onLogEvent);
    source.onerror = (event) => {
      handlers.onError?.(event);
    };

    return () => {
      source.removeEventListener('log', onLogEvent);
      source.close();
    };
  },

  getUsageData: async (range: 'hour' | 'day' | 'week' | 'month' = 'week'): Promise<UsageData[]> => {
    try {
        const now = normalizeNow();
        const { startDate } = getUsageRangeConfig(range, now);
        const enabledProviders = await getEnabledProvidersList();
        const usageResponse = await fetchUsageRecords({
            limit: 5000,
            startDate: startDate.toISOString(),
            fields: USAGE_PAGE_FIELDS,
            cache: true,
            excludeUnknownProvider: true,
            enabledProviders
        });

        return buildUsageSeries(usageResponse.data || [], range, now);
    } catch (e) {
        console.error("API Error getUsageData", e);
        return [];
    }
  },

  getTodayMetrics: async (): Promise<TodayMetrics> => {
    try {
        const now = normalizeNow();
        const startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        const enabledProviders = await getEnabledProvidersList();

        const usageResponse = await fetchUsageRecords({
            limit: 5000,
            startDate: startDate.toISOString(),
            fields: ['date', 'tokensInput', 'tokensOutput', 'tokensReasoning', 'tokensCached', 'tokensCacheWrite', 'costTotal'],
            cache: true,
            excludeUnknownProvider: true,
            enabledProviders
        });

        const metrics: TodayMetrics = {
            requests: 0,
            inputTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            cachedTokens: 0,
            cacheWriteTokens: 0,
            totalCost: 0
        };

        (usageResponse.data || []).forEach(r => {
            metrics.requests++;
            metrics.inputTokens += r.tokensInput || 0;
            metrics.outputTokens += r.tokensOutput || 0;
            metrics.reasoningTokens += r.tokensReasoning || 0;
            metrics.cachedTokens += r.tokensCached || 0;
            metrics.cacheWriteTokens += r.tokensCacheWrite || 0;
            metrics.totalCost += r.costTotal || 0;
        });

        return metrics;
    } catch (e) {
        console.error("API Error getTodayMetrics", e);
        return {
            requests: 0,
            inputTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            cachedTokens: 0,
            cacheWriteTokens: 0,
            totalCost: 0
        };
    }
  },

  getUsageByModel: async (range: 'hour' | 'day' | 'week' | 'month' = 'week'): Promise<PieChartDataPoint[]> => {
    try {
        const now = normalizeNow();
        const { startDate } = getUsageRangeConfig(range, now);
        const usageResponse = await fetchUsageRecords({
            limit: 5000,
            startDate: startDate.toISOString(),
            fields: USAGE_PAGE_FIELDS,
            cache: true
        });

        const records = usageResponse.data || [];

        const aggregated: Record<string, PieChartDataPoint> = {};

        records.forEach(r => {
            const name = r.incomingModelAlias || 'Unknown';
            if (!aggregated[name]) {
                aggregated[name] = { name, requests: 0, tokens: 0 };
            }
            aggregated[name].requests++;
            aggregated[name].tokens += (r.tokensInput || 0) + (r.tokensOutput || 0) + (r.tokensCached || 0) + (r.tokensCacheWrite || 0);
        });

        return Object.values(aggregated).sort((a, b) => b.requests - a.requests);
    } catch (e) {
        console.error("API Error getUsageByModel", e);
        return [];
    }
  },

  getUsageByProvider: async (range: 'hour' | 'day' | 'week' | 'month' = 'week'): Promise<PieChartDataPoint[]> => {
    try {
        const now = normalizeNow();
        const { startDate } = getUsageRangeConfig(range, now);
        const usageResponse = await fetchUsageRecords({
            limit: 5000,
            startDate: startDate.toISOString(),
            fields: USAGE_PAGE_FIELDS,
            cache: true
        });

        const records = usageResponse.data || [];

        const aggregated: Record<string, PieChartDataPoint> = {};

        records.forEach(r => {
            const name = r.provider || 'Unknown';
            if (!aggregated[name]) {
                aggregated[name] = { name, requests: 0, tokens: 0 };
            }
            aggregated[name].requests++;
            aggregated[name].tokens += (r.tokensInput || 0) + (r.tokensOutput || 0) + (r.tokensCached || 0) + (r.tokensCacheWrite || 0);
        });

        return Object.values(aggregated).sort((a, b) => b.requests - a.requests);
    } catch (e) {
        console.error("API Error getUsageByProvider", e);
        return [];
    }
  },

  getUsageByKey: async (range: 'hour' | 'day' | 'week' | 'month' = 'week'): Promise<PieChartDataPoint[]> => {
    try {
        const now = normalizeNow();
        const { startDate } = getUsageRangeConfig(range, now);
        const usageResponse = await fetchUsageRecords({
            limit: 5000,
            startDate: startDate.toISOString(),
            fields: USAGE_PAGE_FIELDS,
            cache: true
        });

        const records = usageResponse.data || [];

        const aggregated: Record<string, PieChartDataPoint> = {};

        records.forEach(r => {
            const name = r.apiKey ? `${r.apiKey.slice(0, 8)}...` : 'Unknown';
            if (!aggregated[name]) {
                aggregated[name] = { name, requests: 0, tokens: 0 };
            }
            aggregated[name].requests++;
            aggregated[name].tokens += (r.tokensInput || 0) + (r.tokensOutput || 0) + (r.tokensCached || 0) + (r.tokensCacheWrite || 0);
        });

        return Object.values(aggregated).sort((a, b) => b.requests - a.requests);
    } catch (e) {
        console.error("API Error getUsageByKey", e);
        return [];
    }
  },

  getProviderPerformance: async (
    model?: string,
    provider?: string,
    filters?: { excludeUnknownProvider?: boolean; enabledProviders?: string }
  ): Promise<ProviderPerformanceData[]> => {
    try {
      const params = new URLSearchParams();
      if (model) params.set('model', model);
      if (provider) params.set('provider', provider);
      if (filters?.excludeUnknownProvider) params.set('excludeUnknownProvider', 'true');
      if (filters?.enabledProviders) params.set('enabledProviders', filters.enabledProviders);

      const query = params.toString();
      const url = `${API_BASE}/v0/management/performance${query ? `?${query}` : ''}`;

      const res = await fetchWithAuth(url);
      if (!res.ok) throw new Error('Failed to fetch provider performance');

      const rawRows = await res.json() as Array<Record<string, unknown>>;

      const toNumber = (value: unknown): number => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
      };

      return rawRows.map((row) => ({
        provider: String(row.provider ?? ''),
        model: String(row.model ?? ''),
        target_model: row.target_model ? String(row.target_model) : undefined,
        avg_ttft_ms: toNumber(row.avg_ttft_ms),
        min_ttft_ms: toNumber(row.min_ttft_ms),
        max_ttft_ms: toNumber(row.max_ttft_ms),
        avg_tokens_per_sec: toNumber(row.avg_tokens_per_sec),
        min_tokens_per_sec: toNumber(row.min_tokens_per_sec),
        max_tokens_per_sec: toNumber(row.max_tokens_per_sec),
        sample_count: toNumber(row.sample_count),
        last_updated: toNumber(row.last_updated)
      }));
    } catch (e) {
      console.error('API Error getProviderPerformance', e);
      return [];
    }
  },

  clearProviderPerformance: async (model: string): Promise<boolean> => {
    try {
      const url = `${API_BASE}/v0/management/performance?model=${encodeURIComponent(model)}`;
      const res = await fetchWithAuth(url, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to clear provider performance');
      return true;
    } catch (e) {
      console.error('API Error clearProviderPerformance', e);
      return false;
    }
  },

  getLogs: async (limit: number = 50, offset: number = 0, filters: Record<string, any> = {}): Promise<{ data: UsageRecord[], total: number }> => {
      const params = new URLSearchParams({
          limit: limit.toString(),
          offset: offset.toString(),
          ...filters
      });

      const res = await fetchWithAuth(`${API_BASE}/v0/management/usage?${params}`);
      if (!res.ok) throw new Error('Failed to fetch logs');
      return await res.json() as BackendResponse<UsageRecord[]>;
  },

  getConfig: async (): Promise<string> => {
    const res = await fetchWithAuth(`${API_BASE}/v0/management/config`);
    if (!res.ok) throw new Error('Failed to fetch config');
    return await res.text();
  },

  saveConfig: async (config: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_BASE}/v0/management/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/yaml' }, // or application/x-yaml
        body: config
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to save config');
    }
  },

  getKeys: async (): Promise<KeyConfig[]> => {
      try {
          const yamlStr = await api.getConfig();
          const config = parse(yamlStr) as PlexusConfig;
          if (!config.keys) return [];
          
          return Object.entries(config.keys).map(([key, val]) => ({
              key,
              secret: val.secret,
              comment: val.comment,
              quota: val.quota
          }));
      } catch (e) {
          console.error("API Error getKeys", e);
          return [];
      }
  },

  saveKey: async (keyConfig: KeyConfig, oldKeyName?: string): Promise<void> => {
      const yamlStr = await api.getConfig();
      let config: any;
      try {
          config = parse(yamlStr);
      } catch (e) {
          config = { providers: {}, models: {}, keys: {} };
      }

      if (!config) config = {};
      if (!config.keys) config.keys = {};

      // If key name changed, delete old key
      if (oldKeyName && oldKeyName !== keyConfig.key && config.keys[oldKeyName]) {
          delete config.keys[oldKeyName];
      }

      config.keys[keyConfig.key] = {
          secret: keyConfig.secret,
          comment: keyConfig.comment,
          ...(keyConfig.quota ? { quota: keyConfig.quota } : {})
      };

      const newYaml = stringify(config);
      await api.saveConfig(newYaml);
  },

  deleteKey: async (keyName: string): Promise<void> => {
      const yamlStr = await api.getConfig();
      let config: any;
      try {
          config = parse(yamlStr);
      } catch (e) {
          return; // Nothing to delete
      }

      if (config && config.keys && config.keys[keyName]) {
          delete config.keys[keyName];
          const newYaml = stringify(config);
          await api.saveConfig(newYaml);
      }
  },

  getProviders: async (): Promise<Provider[]> => {
    try {
        const yamlStr = await api.getConfig();
        const config = parse(yamlStr) as PlexusConfig;

        if (!config.providers) return [];

        return Object.entries(config.providers).map(([key, val]) => {
            // Normalize models array format to object format
            let normalizedModels = val.models;
            if (Array.isArray(val.models)) {
                normalizedModels = val.models.reduce((acc, modelName) => {
                    acc[modelName] = {};
                    return acc;
                }, {} as Record<string, any>);
            }

            // Infer type from api_base_url if not explicitly provided
            const inferredTypes = val.type || inferProviderTypes(val.api_base_url);

            return {
                id: key,
                name: val.display_name || key,
                type: inferredTypes,
                apiBaseUrl: val.api_base_url,
                apiKey: val.api_key || '',
                oauthProvider: val.oauth_provider,
                oauthAccount: val.oauth_account,
                enabled: val.enabled !== false, // Default to true if not present
                estimateTokens: val.estimateTokens || false,
                discount: val.discount,
                headers: val.headers,
                extraBody: val.extraBody,
                models: normalizedModels,
                quotaChecker: normalizeProviderQuotaChecker(val.quota_checker)
            };
        });
    } catch (e) {
        console.error("API Error getProviders", e);
        return [];
    }
  },

  saveProviders: async (providers: Provider[]): Promise<void> => {
      // 1. Get current config to preserve other sections (like models)
      const yamlStr = await api.getConfig();
      let config: any;
      try {
          config = parse(yamlStr);
      } catch (e) {
          config = { providers: {}, models: {} };
      }

      if (!config) config = {};
      if (!config.providers) config.providers = {};

      // 2. Reconstruct providers object
      // We need to be careful not to lose existing fields if the Provider interface is a subset
      // But here we are assuming the Provider interface is the source of truth for the keys we manage.
      // However, to be safe, we should merge.
      
      // Strategy: Create a new providers object based on input
      const newProvidersObj: Record<string, any> = {};
      
      for (const p of providers) {
          const existing = config.providers[p.id] || {};
          newProvidersObj[p.id] = {
              ...existing, // Keep existing fields like models list if any
              type: p.type,
              api_key: p.apiKey,
              ...(p.oauthProvider && { oauth_provider: p.oauthProvider }),
              ...(p.oauthAccount && { oauth_account: p.oauthAccount }),
              api_base_url: p.apiBaseUrl,
              display_name: p.name,
              discount: p.discount,
              headers: p.headers,
              extraBody: p.extraBody,
               models: p.models,
               quota_checker: p.quotaChecker?.type
                 ? {
                     type: p.quotaChecker.type,
                     enabled: p.quotaChecker.enabled,
                     intervalMinutes: Math.max(1, p.quotaChecker.intervalMinutes || 30)
                   }
                 : undefined
          };
      }
      
      config.providers = newProvidersObj;

      // 3. Save
      const newYaml = stringify(config);
      await api.saveConfig(newYaml);
  },

  saveProvider: async (provider: Provider, oldId?: string): Promise<void> => {
      const yamlStr = await api.getConfig();
      let config: any;
      try {
          config = parse(yamlStr);
      } catch (e) {
          config = { providers: {}, models: {} };
      }

      if (!config) config = {};
      if (!config.providers) config.providers = {};

      // If ID changed, delete old key
      if (oldId && oldId !== provider.id && config.providers[oldId]) {
          delete config.providers[oldId];
      }

      // Don't save type field - it will be inferred from api_base_url
      // Only include it if it's explicitly different from what would be inferred
      const inferredTypes = inferProviderTypes(provider.apiBaseUrl);
      const shouldIncludeType = JSON.stringify(inferredTypes) !== JSON.stringify(
        Array.isArray(provider.type) ? provider.type : [provider.type]
      );

      config.providers[provider.id] = {
          ...(shouldIncludeType && { type: provider.type }),
          api_key: provider.apiKey,
          ...(provider.oauthProvider && { oauth_provider: provider.oauthProvider }),
          ...(provider.oauthAccount && { oauth_account: provider.oauthAccount }),
          api_base_url: provider.apiBaseUrl,
          display_name: provider.name,
          estimateTokens: provider.estimateTokens,
          discount: provider.discount,
          headers: provider.headers,
          extraBody: provider.extraBody,
          models: provider.models,
          enabled: provider.enabled,
quota_checker: provider.quotaChecker?.type
              ? {
                  type: provider.quotaChecker.type,
                  enabled: provider.quotaChecker.enabled,
                  intervalMinutes: Math.max(1, provider.quotaChecker.intervalMinutes || 30),
                  options: provider.quotaChecker.options
                }
              : undefined
      };

      const newYaml = stringify(config);
      await api.saveConfig(newYaml);
  },

  deleteProvider: async (providerId: string, cascade?: boolean): Promise<{
    success: boolean;
    provider: string;
    removedTargets?: number;
    affectedAliases?: string[];
  }> => {
    try {
      const url = `/v0/management/providers/${encodeURIComponent(providerId)}${cascade ? '?cascade=true' : ''}`;
      
      const response = await fetchWithAuth(url, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to delete provider' }));
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (e) {
      console.error('API Error deleteProvider', e);
      throw e;
    }
  },

  getAffectedAliases: async (providerId: string): Promise<{ aliasId: string; targetsCount: number }[]> => {
    try {
      const aliases = await api.getAliases();
      const affected: { aliasId: string; targetsCount: number }[] = [];
      
      for (const alias of aliases) {
        const targetsCount = alias.targets.filter(t => t.provider === providerId).length;
        if (targetsCount > 0) {
          affected.push({ aliasId: alias.id, targetsCount });
        }
      }
      
      return affected;
    } catch (e) {
      console.error('API Error getAffectedAliases', e);
      return [];
    }
  },

  saveAlias: async (alias: Alias, oldId?: string): Promise<void> => {
      const yamlStr = await api.getConfig();
      let config: any;
      try {
          config = parse(yamlStr);
      } catch (e) {
          config = { providers: {}, models: {} };
      }

      if (!config) config = {};
      if (!config.models) config.models = {};

      // If ID changed, delete old key
      if (oldId && oldId !== alias.id && config.models[oldId]) {
          delete config.models[oldId];
      }

      config.models[alias.id] = {
          selector: alias.selector,
          priority: alias.priority || 'selector',
          additional_aliases: alias.aliases,
          ...(alias.type && { type: alias.type }),
          targets: alias.targets.map(t => ({
              provider: t.provider,
              model: t.model,
              ...(t.enabled === false && { enabled: false })
          }))
      };

      const newYaml = stringify(config);
      await api.saveConfig(newYaml);
  },

  getModels: async (): Promise<Model[]> => {
    try {
        const yamlStr = await api.getConfig();
        const config = parse(yamlStr) as PlexusConfig;
        const models: Model[] = [];

        // Extract models from providers
        if (config.providers) {
            Object.entries(config.providers).forEach(([pKey, pVal]) => {
                if (pVal.models) {
                    if (Array.isArray(pVal.models)) {
                        pVal.models.forEach(m => {
                            models.push({
                                id: m,
                                name: m,
                                providerId: pKey
                            });
                        });
                    } else if (typeof pVal.models === 'object') {
                        Object.entries(pVal.models).forEach(([mKey, mVal]) => {
                            models.push({
                                id: mKey,
                                name: mKey,
                                providerId: pKey,
                                pricingSource: mVal.pricing?.source,
                                type: mVal.type
                            });
                        });
                    }
                }
            });
        }
        return models;
    } catch (e) {
        console.error("API Error getModels", e);
        return [];
    }
  },

  getAliases: async (): Promise<Alias[]> => {
    try {
        const yamlStr = await api.getConfig();
        const config = parse(yamlStr) as PlexusConfig;
        const aliases: Alias[] = [];
        const providers = config.providers || {};

        if (config.models) {
            Object.entries(config.models).forEach(([key, val]) => {
                const targets = (val.targets || []).map((t: { provider: string; model: string; enabled?: boolean }) => {
                    const providerConfig = providers[t.provider];

                    // Infer type from api_base_url if not explicitly provided
                    const inferredTypes = providerConfig?.type || inferProviderTypes(providerConfig?.api_base_url);
                    let apiType: string | string[] = inferredTypes;

                    // Check for specific model config overrides (access_via)
                    if (providerConfig?.models && !Array.isArray(providerConfig.models)) {
                        const modelConfig = providerConfig.models[t.model];
                        // Only use access_via if it exists AND is non-empty
                        if (modelConfig && modelConfig.access_via && modelConfig.access_via.length > 0) {
                            apiType = modelConfig.access_via;
                        }
                    }

                    return {
                        provider: t.provider,
                        model: t.model,
                        apiType: Array.isArray(apiType) ? apiType : [apiType],
                        enabled: t.enabled !== false // Default to true if not specified
                    };
                });

                aliases.push({
                    id: key,
                    aliases: val.additional_aliases || [],
                    selector: val.selector,
                    priority: val.priority,
                    type: val.type,
                    targets
                });
            });
        }
        return aliases;
    } catch (e) {
        console.error("API Error getAliases", e);
        return [];
    }
  },

  getDebugLogs: async (limit: number = 50, offset: number = 0): Promise<{ requestId: string, createdAt: number }[]> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/debug/logs?limit=${limit}&offset=${offset}`);
          if (!res.ok) throw new Error('Failed to fetch debug logs');
          return await res.json();
      } catch (e) {
          console.error("API Error getDebugLogs", e);
          return [];
      }
  },

  getDebugLogDetail: async (requestId: string): Promise<any> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/debug/logs/${requestId}`);
          if (!res.ok) throw new Error('Failed to fetch debug log detail');
          return await res.json();
      } catch (e) {
          console.error("API Error getDebugLogDetail", e);
          return null;
      }
  },

  deleteDebugLog: async (requestId: string): Promise<boolean> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/debug/logs/${requestId}`, {
              method: 'DELETE'
          });
          return res.ok;
      } catch (e) {
          console.error("API Error deleteDebugLog", e);
          return false;
      }
  },

  deleteAllDebugLogs: async (): Promise<boolean> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/debug/logs`, {
              method: 'DELETE'
          });
          return res.ok;
      } catch (e) {
          console.error("API Error deleteAllDebugLogs", e);
          return false;
      }
  },

  getErrors: async (limit: number = 50, offset: number = 0): Promise<InferenceError[]> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/errors?limit=${limit}&offset=${offset}`);
          if (!res.ok) throw new Error('Failed to fetch error logs');
          return await res.json();
      } catch (e) {
          console.error("API Error getErrors", e);
          return [];
      }
  },

  deleteError: async (requestId: string): Promise<boolean> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/errors/${requestId}`, {
              method: 'DELETE'
          });
          return res.ok;
      } catch (e) {
          console.error("API Error deleteError", e);
          return false;
      }
  },

  deleteAllErrors: async (): Promise<boolean> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/errors`, {
              method: 'DELETE'
          });
          return res.ok;
      } catch (e) {
          console.error("API Error deleteAllErrors", e);
          return false;
      }
  },

  deleteUsageLog: async (requestId: string): Promise<boolean> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/usage/${requestId}`, {
              method: 'DELETE'
          });
          return res.ok;
      } catch (e) {
          console.error("API Error deleteUsageLog", e);
          return false;
      }
  },

  deleteAllUsageLogs: async (olderThanDays?: number): Promise<boolean> => {
      try {
          let url = `${API_BASE}/v0/management/usage`;
          if (olderThanDays !== undefined) {
              url += `?olderThanDays=${olderThanDays}`;
          }
          const res = await fetchWithAuth(url, {
              method: 'DELETE'
          });
          return res.ok;
      } catch (e) {
          console.error("API Error deleteAllUsageLogs", e);
          return false;
      }
  },

  getDebugMode: async (): Promise<boolean> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/debug`);
          if (!res.ok) throw new Error('Failed to fetch debug status');
          const json = await res.json();
          return !!json.enabled;
      } catch (e) {
          console.error("API Error getDebugMode", e);
          return false;
      }
  },

  setDebugMode: async (enabled: boolean): Promise<boolean> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/debug`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ enabled })
          });
          if (!res.ok) throw new Error('Failed to set debug status');
          const json = await res.json();
          return !!json.enabled;
      } catch (e) {
          console.error("API Error setDebugMode", e);
          throw e;
      }
  },

  testModel: async (provider: string, model: string, apiType?: string): Promise<{ success: boolean; error?: string; durationMs: number; response?: string; apiType?: string }> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/test`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ provider, model, apiType })
          });
          if (!res.ok) throw new Error('Failed to test model');
          return await res.json();
      } catch (e) {
          console.error("API Error testModel", e);
          throw e;
      }
  },

  getQuotas: async (): Promise<QuotaCheckerInfo[]> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/quotas`);
          if (!res.ok) throw new Error('Failed to fetch quotas');
          const json = await res.json() as QuotaCheckerInfo[];
          return Array.isArray(json) ? json.map(normalizeQuotaCheckerInfo) : [];
      } catch (e) {
          console.error("API Error getQuotas", e);
          return [];
      }
  },

  getQuota: async (checkerId: string): Promise<QuotaCheckerInfo | null> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/quotas/${checkerId}`);
          if (!res.ok) throw new Error('Failed to fetch quota');
          const json = await res.json() as QuotaCheckerInfo;
          return normalizeQuotaCheckerInfo(json);
      } catch (e) {
          console.error("API Error getQuota", e);
          return null;
      }
  },

  getQuotaHistory: async (checkerId: string, windowType?: string, since?: string): Promise<{ checkerId: string; windowType?: string; since?: string; history: QuotaSnapshot[] } | null> => {
      try {
          const params = new URLSearchParams();
          if (windowType) params.set('windowType', windowType);
          if (since) params.set('since', since);
          const res = await fetchWithAuth(`${API_BASE}/v0/management/quotas/${checkerId}/history?${params}`);
          if (!res.ok) throw new Error('Failed to fetch quota history');
          const json = await res.json() as { checkerId: string; windowType?: string; since?: string; history: QuotaSnapshot[] };
          return {
            ...json,
            history: Array.isArray(json.history) ? json.history.map(normalizeQuotaSnapshot) : [],
          };
      } catch (e) {
          console.error("API Error getQuotaHistory", e);
          return null;
      }
  },

  triggerQuotaCheck: async (checkerId: string): Promise<QuotaCheckResult | null> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/quotas/${checkerId}/check`, {
              method: 'POST'
          });
          if (!res.ok) throw new Error('Failed to trigger quota check');
          const json = await res.json() as QuotaCheckResult;
          return normalizeQuotaCheckResult(json);
      } catch (e) {
          console.error("API Error triggerQuotaCheck", e);
          return null;
      }
  },

  deleteAlias: async (aliasId: string): Promise<void> => {
      const res = await fetchWithAuth(`${API_BASE}/v0/management/models/${encodeURIComponent(aliasId)}`, {
          method: 'DELETE'
      });

      if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to delete alias');
      }
  },

  deleteAllAliases: async (): Promise<void> => {
      const res = await fetchWithAuth(`${API_BASE}/v0/management/models`, {
          method: 'DELETE'
      });

      if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to delete all aliases');
      }
  },

  getOAuthProviders: async (): Promise<OAuthProviderInfo[]> => {
      const res = await fetchWithAuth(`${API_BASE}/v0/management/oauth/providers`);
      if (!res.ok) throw new Error('Failed to fetch OAuth providers');
      const json = await res.json() as BackendResponse<OAuthProviderInfo[]>;
      return json.data || [];
  },

  startOAuthSession: async (providerId: string, accountId: string): Promise<OAuthSession> => {
      const res = await fetchWithAuth(`${API_BASE}/v0/management/oauth/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providerId, accountId })
      });
      if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to start OAuth session');
      }
      const json = await res.json() as { data: OAuthSession };
      return json.data;
  },

  deleteOAuthCredentials: async (providerId: string, accountId: string): Promise<void> => {
      const res = await fetchWithAuth(`${API_BASE}/v0/management/oauth/credentials`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providerId, accountId })
      });
      if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to delete OAuth credentials');
      }
  },

  getOAuthCredentialStatus: async (providerId: string, accountId: string): Promise<OAuthCredentialStatus> => {
      const query = new URLSearchParams({ providerId, accountId }).toString();
      const res = await fetchWithAuth(`${API_BASE}/v0/management/oauth/credentials/status?${query}`);
      if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to fetch OAuth credential status');
      }
      const json = await res.json() as { data: OAuthCredentialStatus };
      return json.data;
  },

  getOAuthSession: async (sessionId: string): Promise<OAuthSession> => {
      const res = await fetchWithAuth(`${API_BASE}/v0/management/oauth/sessions/${sessionId}`);
      if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to fetch OAuth session');
      }
      const json = await res.json() as { data: OAuthSession };
      return json.data;
  },

  submitOAuthPrompt: async (sessionId: string, value: string): Promise<OAuthSession> => {
      const res = await fetchWithAuth(`${API_BASE}/v0/management/oauth/sessions/${sessionId}/prompt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value })
      });
      if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to submit OAuth prompt');
      }
      const json = await res.json() as { data: OAuthSession };
      return json.data;
  },

  submitOAuthManualCode: async (sessionId: string, value: string): Promise<OAuthSession> => {
      const res = await fetchWithAuth(`${API_BASE}/v0/management/oauth/sessions/${sessionId}/manual-code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value })
      });
      if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to submit OAuth code');
      }
      const json = await res.json() as { data: OAuthSession };
      return json.data;
  },

  cancelOAuthSession: async (sessionId: string): Promise<OAuthSession> => {
      const res = await fetchWithAuth(`${API_BASE}/v0/management/oauth/sessions/${sessionId}/cancel`, {
          method: 'POST'
      });
      if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to cancel OAuth session');
      }
      const json = await res.json() as { data: OAuthSession };
      return json.data;
  },

  getConfigQuotas: async (): Promise<QuotaConfig[]> => {
      try {
          const yamlStr = await api.getConfig();
          const config = parse(yamlStr) as PlexusConfig;
          return config.quotas || [];
      } catch (e) {
          console.error("API Error getConfigQuotas", e);
          return [];
      }
  },

  saveConfigQuota: async (quota: QuotaConfig, oldId?: string): Promise<void> => {
      const yamlStr = await api.getConfig();
      let config: any;
      try {
          config = parse(yamlStr);
      } catch (e) {
          config = { providers: {}, models: {} };
      }

      if (!config) config = {};
      if (!config.quotas) config.quotas = [];

      if (oldId && oldId !== quota.id) {
          config.quotas = config.quotas.filter((q: QuotaConfig) => q.id !== oldId);
      }

      const existingIdx = config.quotas.findIndex((q: QuotaConfig) => q.id === quota.id);
      if (existingIdx >= 0) {
          config.quotas[existingIdx] = quota;
      } else {
          config.quotas.push(quota);
      }

      const newYaml = stringify(config);
      await api.saveConfig(newYaml);
  },

  deleteConfigQuota: async (quotaId: string): Promise<void> => {
      const yamlStr = await api.getConfig();
      let config: any;
      try {
          config = parse(yamlStr);
      } catch (e) {
          return;
      }

      if (config && config.quotas) {
          config.quotas = config.quotas.filter((q: QuotaConfig) => q.id !== quotaId);
          const newYaml = stringify(config);
          await api.saveConfig(newYaml);
      }
  },

  getMcpServers: async (): Promise<Record<string, { upstream_url: string; enabled: boolean; headers?: Record<string, string> }>> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/mcp-servers`);
          if (!res.ok) throw new Error('Failed to fetch MCP servers');
          return await res.json();
      } catch (e) {
          console.error("API Error getMcpServers", e);
          return {};
      }
  },

  saveMcpServer: async (serverName: string, server: { upstream_url: string; enabled?: boolean; headers?: Record<string, string> }): Promise<void> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/mcp-servers/${encodeURIComponent(serverName)}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(server)
          });
          if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.error || 'Failed to save MCP server');
          }
      } catch (e) {
          console.error("API Error saveMcpServer", e);
          throw e;
      }
  },

  deleteMcpServer: async (serverName: string): Promise<void> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/mcp-servers/${encodeURIComponent(serverName)}`, {
              method: 'DELETE'
          });
          if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.error || 'Failed to delete MCP server');
          }
      } catch (e) {
          console.error("API Error deleteMcpServer", e);
          throw e;
      }
  },

  getMcpLogs: async (limit: number = 20, offset: number = 0, filters: { serverName?: string; apiKey?: string } = {}): Promise<{ data: McpLogRecord[]; total: number }> => {
      try {
          const params = new URLSearchParams({
              limit: limit.toString(),
              offset: offset.toString(),
              ...(filters.serverName ? { serverName: filters.serverName } : {}),
              ...(filters.apiKey ? { apiKey: filters.apiKey } : {}),
          });
          const res = await fetchWithAuth(`${API_BASE}/v0/management/mcp-logs?${params}`);
          if (!res.ok) throw new Error('Failed to fetch MCP logs');
          return await res.json();
      } catch (e) {
          console.error("API Error getMcpLogs", e);
          return { data: [], total: 0 };
      }
  },

  deleteMcpLog: async (requestId: string): Promise<boolean> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/mcp-logs/${encodeURIComponent(requestId)}`, {
              method: 'DELETE'
          });
          return res.ok;
      } catch (e) {
          console.error("API Error deleteMcpLog", e);
          return false;
      }
  },

  deleteAllMcpLogs: async (olderThanDays?: number): Promise<boolean> => {
      try {
          const params = olderThanDays != null ? `?olderThanDays=${olderThanDays}` : '';
          const res = await fetchWithAuth(`${API_BASE}/v0/management/mcp-logs${params}`, {
              method: 'DELETE'
          });
          return res.ok;
      } catch (e) {
          console.error("API Error deleteAllMcpLogs", e);
          return false;
      }
  },

  // User Quota Management
  getUserQuotas: async (): Promise<Record<string, UserQuota>> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/user-quotas`);
          if (!res.ok) throw new Error('Failed to fetch user quotas');
          return await res.json();
      } catch (e) {
          console.error("API Error getUserQuotas", e);
          return {};
      }
  },

  getUserQuota: async (name: string): Promise<UserQuota | null> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/user-quotas/${encodeURIComponent(name)}`);
          if (!res.ok) {
              if (res.status === 404) return null;
              throw new Error('Failed to fetch user quota');
          }
          return await res.json();
      } catch (e) {
          console.error("API Error getUserQuota", e);
          return null;
      }
  },

  saveUserQuota: async (name: string, quota: UserQuota): Promise<void> => {
      const res = await fetchWithAuth(`${API_BASE}/v0/management/user-quotas/${encodeURIComponent(name)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(quota)
      });
      if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(err.error?.message || err.error || 'Failed to save quota');
      }
  },

  updateUserQuota: async (name: string, updates: Partial<UserQuota>): Promise<void> => {
      const res = await fetchWithAuth(`${API_BASE}/v0/management/user-quotas/${encodeURIComponent(name)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates)
      });
      if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(err.error?.message || err.error || 'Failed to update quota');
      }
  },

  deleteUserQuota: async (name: string): Promise<void> => {
      const res = await fetchWithAuth(`${API_BASE}/v0/management/user-quotas/${encodeURIComponent(name)}`, {
          method: 'DELETE'
      });
      if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(err.error?.message || err.error || 'Failed to delete quota');
      }
  },

  getQuotaStatus: async (key: string): Promise<{
      key: string;
      quota_name: string | null;
      allowed: boolean;
      current_usage: number;
      limit: number | null;
      remaining: number | null;
      resets_at: string | null;
  } | null> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/quota/status/${encodeURIComponent(key)}`);
          if (!res.ok) {
              if (res.status === 404) return null;
              throw new Error('Failed to fetch quota status');
          }
          return await res.json();
      } catch (e) {
          console.error("API Error getQuotaStatus", e);
          return null;
      }
  },

  clearQuota: async (key: string): Promise<void> => {
      const res = await fetchWithAuth(`${API_BASE}/v0/management/quota/clear`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key })
      });
      if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(err.error?.message || err.error || 'Failed to clear quota');
      }
  },

  /**
   * Get comma-separated list of enabled provider names from config
   * Used for filtering dashboards to only show enabled providers
   */
  getEnabledProviders: async (): Promise<string | undefined> => {
      return await getEnabledProvidersList();
  }
};
