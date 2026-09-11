import { formatNumber } from '../format';
import { API_BASE, fetchWithAuth, fetchConfigCached, formatLargeNumber, STAT_LABELS } from './core';
import { getCooldowns } from './settings';
import type {
  BackendResponse,
  ConcurrencyData,
  DashboardData,
  ProviderPerformanceData,
  Stat,
  TodayMetrics,
  UsageData,
  UsageQueryParams,
  UsageRecord,
  UsageRecordField,
  UsageSortDirection,
  UsageSortField,
  UsageSummaryBreakdown,
  UsageSummaryExclusion,
  UsageSummaryResponse,
} from '../../types/usage';

export const USAGE_CACHE_TTL_MS = 20000;
export const usageRequestCache = new Map<
  string,
  { expiresAt: number; promise: Promise<BackendResponse<any>> }
>();
export const summaryRequestCache = new Map<
  string,
  { expiresAt: number; promise: Promise<UsageSummaryResponse> }
>();
const getAuthCacheKey = (queryString: string): string => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('plexus_admin_key') || '' : '';
  return `${token}:${queryString}`;
};

export const USAGE_PAGE_FIELDS: UsageRecordField[] = [
  'date',
  'tokensInput',
  'tokensOutput',
  'tokensCached',
  'tokensCacheWrite',
  'incomingModelAlias',
  'provider',
  'apiKey',
];

export const normalizeNow = (): Date => {
  const now = new Date();
  now.setSeconds(0, 0);
  return now;
};

export const getUsageRangeConfig = (
  range: 'hour' | 'day' | 'week' | 'month' | 'custom',
  now: Date
) => {
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

export const buildUsageSeries = (
  records: Array<Partial<UsageRecord>>,
  range: 'hour' | 'day' | 'week' | 'month',
  now: Date
): UsageData[] => {
  const { startDate, bucketFormat, buckets, step } = getUsageRangeConfig(range, now);
  const grouped: Record<string, UsageData> = {};
  const nowMs = now.getTime();

  for (let i = buckets; i >= 0; i--) {
    const t = new Date(nowMs - i * step);
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
        cacheWriteTokens: 0,
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
        cacheWriteTokens: 0,
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

export const formatBucketLabel = (
  range: 'hour' | 'day' | 'week' | 'month' | 'custom',
  date: Date
) => {
  if (range === 'hour' || range === 'day') {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString();
};

export const buildSummarySeries = (summary: UsageSummaryResponse, now: Date): UsageData[] => {
  const { buckets, step } = getUsageRangeConfig(summary.range, now);
  const grouped: Record<string, UsageData> = {};
  const stepMs = step;
  const alignedNowMs = Math.floor(now.getTime() / stepMs) * stepMs;
  const startMs = alignedNowMs - buckets * stepMs;
  const byBucket = new Map(summary.series.map((point) => [point.bucketStartMs, point]));

  for (let i = 0; i <= buckets; i++) {
    const bucketStartMs = startMs + i * stepMs;
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
      cacheWriteTokens,
    };
  }

  return Object.values(grouped);
};

export const buildUsageQuery = <T extends UsageRecordField>(params: UsageQueryParams<T>) => {
  const searchParams = new URLSearchParams();

  if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
  if (params.offset !== undefined) searchParams.set('offset', String(params.offset));
  if (params.requestId) searchParams.set('requestId', params.requestId);
  if (params.clientRequestId) searchParams.set('clientRequestId', params.clientRequestId);
  if (params.startDate) searchParams.set('startDate', params.startDate);
  if (params.endDate) searchParams.set('endDate', params.endDate);
  if (params.incomingApiType) searchParams.set('incomingApiType', params.incomingApiType);
  if (params.provider) searchParams.set('provider', params.provider);
  if (params.incomingModelAlias) searchParams.set('incomingModelAlias', params.incomingModelAlias);
  if (params.selectedModelName) searchParams.set('selectedModelName', params.selectedModelName);
  if (params.outgoingApiType) searchParams.set('outgoingApiType', params.outgoingApiType);
  if (params.responseStatus) searchParams.set('responseStatus', params.responseStatus);
  if (params.minDurationMs !== undefined)
    searchParams.set('minDurationMs', String(params.minDurationMs));
  if (params.maxDurationMs !== undefined)
    searchParams.set('maxDurationMs', String(params.maxDurationMs));

  if (params.fields && params.fields.length > 0) {
    const fieldsValue = [...params.fields].sort().join(',');
    searchParams.set('fields', fieldsValue);
  }

  return searchParams;
};

export const fetchUsageRecords = async <T extends UsageRecordField>(
  params: UsageQueryParams<T>
): Promise<BackendResponse<Pick<UsageRecord, T>[]>> => {
  const searchParams = buildUsageQuery(params);
  const queryString = searchParams.toString();
  const url = queryString
    ? `${API_BASE}/v0/management/usage?${queryString}`
    : `${API_BASE}/v0/management/usage`;

  if (params.cache) {
    const cacheKey = getAuthCacheKey(queryString);
    const cached = usageRequestCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.promise as Promise<BackendResponse<Pick<UsageRecord, T>[]>>;
    }

    const promise = (async () => {
      const res = await fetchWithAuth(url);
      if (!res.ok) throw new Error('Failed to fetch usage');
      return (await res.json()) as BackendResponse<Pick<UsageRecord, T>[]>;
    })();

    usageRequestCache.set(cacheKey, { expiresAt: Date.now() + USAGE_CACHE_TTL_MS, promise });
    promise.catch(() => usageRequestCache.delete(cacheKey));
    return promise;
  }

  const res = await fetchWithAuth(url);
  if (!res.ok) throw new Error('Failed to fetch usage');
  return (await res.json()) as BackendResponse<Pick<UsageRecord, T>[]>;
};

export const fetchUsageSummary = async (
  range: 'hour' | 'day' | 'week' | 'month' | 'custom',
  cache = true,
  startDate?: string,
  endDate?: string,
  breakdowns: UsageSummaryBreakdown[] = [],
  breakdownLimit = 10,
  exclusions: UsageSummaryExclusion[] = []
) => {
  const searchParams = new URLSearchParams();
  searchParams.set('range', range);

  if (range === 'custom' && startDate && endDate) {
    searchParams.set('startDate', startDate);
    searchParams.set('endDate', endDate);
  }

  const normalizedBreakdowns = Array.from(new Set(breakdowns)).sort();
  if (normalizedBreakdowns.length > 0) {
    searchParams.set('breakdowns', normalizedBreakdowns.join(','));
    searchParams.set('breakdownLimit', String(breakdownLimit));
  }
  const normalizedExclusions = Array.from(new Set(exclusions)).sort();
  if (normalizedExclusions.length > 0) {
    searchParams.set('exclude', normalizedExclusions.join(','));
  }

  const queryString = searchParams.toString();
  const url = `${API_BASE}/v0/management/usage/summary?${queryString}`;

  if (cache) {
    const cacheKey = getAuthCacheKey(queryString);
    const cached = summaryRequestCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.promise;
    }

    const promise = (async () => {
      const res = await fetchWithAuth(url);
      if (!res.ok) throw new Error('Failed to fetch usage summary');
      return (await res.json()) as UsageSummaryResponse;
    })();

    summaryRequestCache.set(cacheKey, { expiresAt: Date.now() + USAGE_CACHE_TTL_MS, promise });
    promise.catch(() => summaryRequestCache.delete(cacheKey));
    return promise;
  }

  const res = await fetchWithAuth(url);
  if (!res.ok) throw new Error('Failed to fetch usage summary');
  return (await res.json()) as UsageSummaryResponse;
};

export const getStats = async (): Promise<Stat[]> => {
  try {
    const [summary, config] = await Promise.all([
      fetchUsageSummary('week', true),
      fetchConfigCached(),
    ]);
    const configObj = config as { providers?: Record<string, unknown> } | null;
    const activeProviders = configObj ? Object.keys(configObj.providers || {}).length : '-';

    const totalRequests = summary.stats.totalRequests || 0;
    const totalTokens = summary.stats.totalTokens || 0;
    const avgLatency = Math.round(summary.stats.avgDurationMs || 0);

    return [
      { label: STAT_LABELS.REQUESTS, value: formatNumber(totalRequests, 0) },
      { label: STAT_LABELS.PROVIDERS, value: activeProviders },
      { label: STAT_LABELS.TOKENS, value: formatLargeNumber(totalTokens) },
      { label: STAT_LABELS.DURATION, value: avgLatency + 'ms' },
    ];
  } catch (e) {
    console.error('API Error getStats', e);
    return [
      { label: STAT_LABELS.REQUESTS, value: '-' },
      { label: STAT_LABELS.PROVIDERS, value: '-' },
      { label: STAT_LABELS.TOKENS, value: '-' },
      { label: STAT_LABELS.DURATION, value: '-' },
    ];
  }
};

export const getDashboardData = async (
  range: 'hour' | 'day' | 'week' | 'month' | 'custom' = 'day',
  cache = true,
  startDate?: string,
  endDate?: string
): Promise<DashboardData> => {
  try {
    const now = normalizeNow();
    const [summary, cooldowns, config] = await Promise.all([
      fetchUsageSummary(range, cache, startDate, endDate),
      getCooldowns(),
      fetchConfigCached(),
    ]);

    const usageData = buildSummarySeries(summary, now);
    const totalRequests = summary.stats.totalRequests || 0;
    const totalTokens = summary.stats.totalTokens || 0;
    const avgLatency = Math.round(summary.stats.avgDurationMs || 0);
    const configObj = config as { providers?: Record<string, unknown> } | null;
    const activeProviders = configObj ? Object.keys(configObj.providers || {}).length : '-';

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
      todayMetrics: summary.today,
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
        totalCost: 0,
      },
    };
  }
};

export const getUsageSummary = async (
  range: 'hour' | 'day' | 'week' | 'month' | 'custom' = 'day',
  cache = true,
  startDate?: string,
  endDate?: string,
  breakdowns: UsageSummaryBreakdown[] = [],
  breakdownLimit = 10,
  exclusions: UsageSummaryExclusion[] = []
): Promise<UsageSummaryResponse | null> => {
  try {
    return await fetchUsageSummary(
      range,
      cache,
      startDate,
      endDate,
      breakdowns,
      breakdownLimit,
      exclusions
    );
  } catch (e) {
    console.error('API Error getUsageSummary', e);
    return null;
  }
};

export interface FormattedSummaryPoint {
  timestamp: string;
  requests: number;
  errors: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  cost: number;
  duration: number;
  ttft: number;
  tps: number;
}

export const getSummaryData = async (
  range: 'hour' | 'day' | 'week' | 'month' | 'custom' = 'week',
  cache = true,
  startDate?: string,
  endDate?: string,
  breakdowns: UsageSummaryBreakdown[] = [],
  breakdownLimit = 10,
  exclusions: UsageSummaryExclusion[] = []
): Promise<FormattedSummaryPoint[]> => {
  try {
    const summaryResponse = await fetchUsageSummary(
      range,
      cache,
      startDate,
      endDate,
      breakdowns,
      breakdownLimit,
      exclusions
    );
    const series = summaryResponse.series || [];

    // Return raw data with minimal transformation
    return series.map((point) => ({
      timestamp: String(point.bucketStartMs),
      requests: point.requests,
      errors: point.errors,
      tokens: point.tokens,
      inputTokens: point.inputTokens,
      outputTokens: point.outputTokens,
      reasoningTokens: point.reasoningTokens,
      cachedTokens: point.cachedTokens,
      cacheWriteTokens: point.cacheWriteTokens,
      cost: point.totalCost,
      duration: point.avgDurationMs,
      ttft: point.avgTtftMs,
      tps: point.avgTokensPerSec,
    }));
  } catch (e) {
    console.error('API Error getSummaryData', e);
    return [];
  }
};

export const getUsageData = async (
  range: 'hour' | 'day' | 'week' | 'month' | 'custom' = 'week',
  cache = true,
  startDate?: string,
  endDate?: string
): Promise<UsageData[]> => {
  try {
    const now = normalizeNow();

    let queryStartDate: Date;
    let queryEndDate: Date;

    if (range === 'custom' && startDate && endDate) {
      queryStartDate = new Date(startDate);
      queryEndDate = new Date(endDate);
    } else {
      const { startDate: configStart } = getUsageRangeConfig(
        range as 'hour' | 'day' | 'week' | 'month',
        now
      );
      queryStartDate = configStart;
      queryEndDate = now;
    }

    const usageResponse = await fetchUsageRecords({
      limit: 5000,
      startDate: queryStartDate.toISOString(),
      endDate: queryEndDate.toISOString(),
      fields: USAGE_PAGE_FIELDS,
      cache,
    });

    return buildUsageSeries(usageResponse.data || [], range === 'custom' ? 'day' : range, now);
  } catch (e) {
    console.error('API Error getUsageData', e);
    return [];
  }
};

export const getTodayMetrics = async (): Promise<TodayMetrics> => {
  try {
    const now = normalizeNow();
    const startDate = new Date(now);
    startDate.setHours(0, 0, 0, 0);

    const usageResponse = await fetchUsageRecords({
      limit: 5000,
      startDate: startDate.toISOString(),
      fields: [
        'date',
        'tokensInput',
        'tokensOutput',
        'tokensReasoning',
        'tokensCached',
        'tokensCacheWrite',
        'costTotal',
      ],
      cache: true,
    });

    const metrics: TodayMetrics = {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedTokens: 0,
      cacheWriteTokens: 0,
      totalCost: 0,
    };

    (usageResponse.data || []).forEach((r) => {
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
    console.error('API Error getTodayMetrics', e);
    return {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedTokens: 0,
      cacheWriteTokens: 0,
      totalCost: 0,
    };
  }
};

export const getProviderPerformance = async (
  model?: string,
  provider?: string
): Promise<ProviderPerformanceData[]> => {
  try {
    const params = new URLSearchParams();
    if (model) params.set('model', model);
    if (provider) params.set('provider', provider);

    const query = params.toString();
    const url = `${API_BASE}/v0/management/performance${query ? `?${query}` : ''}`;

    const res = await fetchWithAuth(url);
    if (!res.ok) throw new Error('Failed to fetch provider performance');

    const rawRows = (await res.json()) as Array<Record<string, unknown>>;

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
      avg_e2e_tokens_per_sec: toNumber(row.avg_e2e_tokens_per_sec),
      min_e2e_tokens_per_sec: toNumber(row.min_e2e_tokens_per_sec),
      max_e2e_tokens_per_sec: toNumber(row.max_e2e_tokens_per_sec),
      sample_count: toNumber(row.sample_count),
      last_updated: toNumber(row.last_updated),
    }));
  } catch (e) {
    console.error('API Error getProviderPerformance', e);
    return [];
  }
};

export const clearProviderPerformance = async (model: string): Promise<boolean> => {
  try {
    const url = `${API_BASE}/v0/management/performance?model=${encodeURIComponent(model)}`;
    const res = await fetchWithAuth(url, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to clear provider performance');
    return true;
  } catch (e) {
    console.error('API Error clearProviderPerformance', e);
    return false;
  }
};

export const getLogs = async (
  limit: number = 50,
  offset: number = 0,
  filters: Record<string, unknown> = {},
  sortBy: UsageSortField = 'date',
  sortDir: UsageSortDirection = 'desc'
): Promise<{ data: UsageRecord[]; total: number }> => {
  const stringFilters: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null) {
      stringFilters[key] = String(value);
    }
  }

  const params = new URLSearchParams({
    limit: limit.toString(),
    offset: offset.toString(),
    sortBy,
    sortDir,
    ...stringFilters,
  });

  const res = await fetchWithAuth(`${API_BASE}/v0/management/usage?${params}`);
  if (!res.ok) throw new Error('Failed to fetch logs');
  return (await res.json()) as BackendResponse<UsageRecord[]>;
};

export const getUsageRecords = fetchUsageRecords;

export const deleteUsageLog = async (requestId: string): Promise<boolean> => {
  try {
    const res = await fetchWithAuth(`${API_BASE}/v0/management/usage/${requestId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete usage log');
    return true;
  } catch (e) {
    console.error('API Error deleteUsageLog', e);
    return false;
  }
};

export const deleteAllUsageLogs = async (olderThanDays?: number): Promise<boolean> => {
  try {
    let url = `${API_BASE}/v0/management/usage`;
    if (olderThanDays !== undefined) {
      url += `?olderThanDays=${olderThanDays}`;
    }
    const res = await fetchWithAuth(url, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete usage logs');
    return true;
  } catch (e) {
    console.error('API Error deleteAllUsageLogs', e);
    return false;
  }
};

export const getConcurrencyData = async (
  timeRange: 'hour' | 'day' | 'week' | 'month' | 'custom' = 'hour',
  mode: 'live' | 'timeline' = 'live',
  groupBy: 'provider' | 'model' = 'provider',
  startDate?: string,
  endDate?: string
): Promise<ConcurrencyData[]> => {
  try {
    const params = new URLSearchParams({ mode, groupBy, timeRange });
    if (timeRange === 'custom' && startDate && endDate) {
      params.set('startDate', startDate);
      params.set('endDate', endDate);
    }
    const res = await fetchWithAuth(`${API_BASE}/v0/management/concurrency?${params}`);
    if (!res.ok) throw new Error('Failed to fetch concurrency data');
    const json = await res.json();
    return json.data || [];
  } catch (e) {
    console.error('API Error getConcurrencyData', e);
    return [];
  }
};
