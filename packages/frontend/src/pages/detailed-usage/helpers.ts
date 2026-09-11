import type { UsageSummaryBreakdown, UsageSummaryGroup } from '../../lib/api';
import { parseISODate, type CustomDateRange } from '../../lib/date';
import { formatCostIn, formatMs, formatNumber, formatTokens } from '../../lib/format';
import type {
  AggregatedPoint,
  ChartType,
  CostDisplay,
  DetailedUsagePreset,
  GroupBy,
  MetricConfig,
  MetricKey,
  TimeRange,
  ViewMode,
} from './types';

export const COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#f97316',
  '#84cc16',
];

export const LIVE_WINDOW_MINUTES = 5;
export const DEFAULT_METRICS: MetricKey[] = ['requests', 'tokens', 'cost'];
export const VALID_METRIC_KEYS: readonly MetricKey[] = [
  'requests',
  'tokens',
  'cost',
  'duration',
  'ttft',
  'tps',
  'errors',
  'velocity',
];

const ALLOWED_TIME_RANGES: TimeRange[] = ['live', 'hour', 'day', 'week', 'month', 'custom'];
const ALLOWED_CHART_TYPES: ChartType[] = ['line', 'bar', 'area', 'pie', 'composed'];
const ALLOWED_GROUP_BY: GroupBy[] = ['time', 'provider', 'model', 'apiKey', 'status'];
const ALLOWED_VIEW_MODES: ViewMode[] = ['chart', 'list'];

export const createMetrics = ({ currency, rate, symbol }: CostDisplay): MetricConfig[] => [
  {
    key: 'requests',
    label: 'Requests',
    color: '#3b82f6',
    yAxisId: 'left',
    format: (value) => formatNumber(value, 0),
  },
  {
    key: 'tokens',
    label: 'Tokens',
    color: '#10b981',
    yAxisId: 'right',
    format: (value) => formatTokens(value),
  },
  {
    key: 'cost',
    label: `Cost (${symbol})`,
    color: '#f59e0b',
    yAxisId: 'right',
    format: (value) => formatCostIn(value / rate, { currency, rate, symbol, decimals: 4 }),
  },
  {
    key: 'duration',
    label: 'Duration',
    color: '#8b5cf6',
    yAxisId: 'right',
    format: (value) => formatMs(value),
  },
  {
    key: 'ttft',
    label: 'TTFT',
    color: '#ec4899',
    yAxisId: 'right',
    format: (value) => formatMs(value),
  },
  {
    key: 'tps',
    label: 'TPS',
    color: '#06b6d4',
    yAxisId: 'right',
    format: (value) => formatNumber(value, 1),
  },
  {
    key: 'errors',
    label: 'Errors',
    color: '#ef4444',
    yAxisId: 'left',
    format: (value) => formatNumber(value, 0),
  },
];

export const parsePresetFromQuery = (query: string): DetailedUsagePreset => {
  const params = new URLSearchParams(query);
  const range = params.get('range');
  const chartType = params.get('chartType');
  const groupBy = params.get('groupBy');
  const viewMode = params.get('viewMode');
  const metrics = params.get('metrics');
  const metric = params.get('metric');
  const startDate = params.get('startDate');
  const endDate = params.get('endDate');

  const requestedMetrics = metrics ? metrics.split(',') : metric ? [metric] : DEFAULT_METRICS;
  const parsedMetrics = requestedMetrics
    .map((value) => value.trim())
    .filter((value): value is MetricKey => VALID_METRIC_KEYS.includes(value as MetricKey));
  const isCustomRange = range === 'custom' && startDate && endDate;

  return {
    timeRange: ALLOWED_TIME_RANGES.includes(range as TimeRange) ? (range as TimeRange) : 'day',
    chartType: ALLOWED_CHART_TYPES.includes(chartType as ChartType)
      ? (chartType as ChartType)
      : 'area',
    groupBy: ALLOWED_GROUP_BY.includes(groupBy as GroupBy) ? (groupBy as GroupBy) : 'time',
    viewMode: ALLOWED_VIEW_MODES.includes(viewMode as ViewMode) ? (viewMode as ViewMode) : 'chart',
    selectedMetrics: parsedMetrics.length > 0 ? parsedMetrics : [...DEFAULT_METRICS],
    customStartDate: isCustomRange ? startDate : undefined,
    customEndDate: isCustomRange ? endDate : undefined,
  };
};

export const parseCustomDateRange = (
  startDate?: string,
  endDate?: string
): CustomDateRange | null => {
  if (!startDate || !endDate) return null;
  const start = parseISODate(startDate);
  const end = parseISODate(endDate);
  if (!start || !end) return null;
  return { start, end };
};

export const getRangeConfig = (
  range: TimeRange,
  customRange?: CustomDateRange | null
): { minutes: number; bucketFn: (timestampMs: number) => number } => {
  if (range === 'custom' && customRange) {
    const durationMs = customRange.end.getTime() - customRange.start.getTime();
    const durationMinutes = durationMs / 60000;
    const useMinuteBuckets = durationMinutes <= 30;
    const use5MinuteBuckets = durationMinutes <= 24 * 60;
    const useHourlyBuckets = durationMinutes <= 7 * 24 * 60;
    let bucketSizeMinutes: number;
    if (useMinuteBuckets) {
      bucketSizeMinutes = 1;
    } else if (use5MinuteBuckets) {
      bucketSizeMinutes = 5;
    } else if (useHourlyBuckets) {
      bucketSizeMinutes = 60;
    } else {
      bucketSizeMinutes = 360;
    }
    const maxBuckets = 100;
    const calculatedBuckets = Math.ceil(durationMinutes / bucketSizeMinutes);
    if (calculatedBuckets > maxBuckets) {
      bucketSizeMinutes = Math.ceil(durationMinutes / maxBuckets);
    }
    return {
      minutes: durationMinutes,
      bucketFn: (timestampMs: number) => {
        const bucketMs = bucketSizeMinutes * 60000;
        return Math.floor(timestampMs / bucketMs) * bucketMs;
      },
    };
  }

  switch (range) {
    case 'live':
      return {
        minutes: LIVE_WINDOW_MINUTES,
        bucketFn: (timestampMs) => Math.floor(timestampMs / 60000) * 60000,
      };
    case 'hour':
      return {
        minutes: 60,
        bucketFn: (timestampMs) => Math.floor(timestampMs / 60000) * 60000,
      };
    case 'day':
      return {
        minutes: 1440,
        bucketFn: (timestampMs) => Math.floor(timestampMs / 3600000) * 3600000,
      };
    case 'week':
    case 'month':
      return {
        minutes: range === 'week' ? 10080 : 43200,
        bucketFn: (timestampMs) => {
          const date = new Date(timestampMs);
          date.setHours(0, 0, 0, 0);
          return date.getTime();
        },
      };
    default:
      return {
        minutes: 1440,
        bucketFn: (timestampMs) => Math.floor(timestampMs / 3600000) * 3600000,
      };
  }
};

export const formatBucketLabel = (
  range: TimeRange,
  milliseconds: number,
  customRange?: CustomDateRange | null
): string => {
  const date = new Date(milliseconds);
  if (range === 'custom' && customRange) {
    const durationMinutes = (customRange.end.getTime() - customRange.start.getTime()) / 60000;
    if (durationMinutes <= 24 * 60) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString();
  }
  return range === 'live' || range === 'hour' || range === 'day'
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString();
};

export const calcVelocity = (data: AggregatedPoint[]): AggregatedPoint[] =>
  data.map((point, index, points) => ({
    ...point,
    velocity: index === 0 ? 0 : point.requests - points[index - 1].requests,
  }));

export const toAggregatedPoint = (group: UsageSummaryGroup): AggregatedPoint => ({
  name: group.name,
  requests: group.requests,
  errors: group.errors,
  tokens: group.totalTokens,
  cost: group.totalCost,
  duration: group.avgDurationMs,
  ttft: group.avgTtftMs,
  tps: group.avgTokensPerSec,
  successRate: group.successRate,
  fill: COLORS[
    Math.abs(group.name.split('').reduce((sum, character) => sum + character.charCodeAt(0), 0)) %
      COLORS.length
  ],
});

export const getSummaryBreakdown = (
  groupBy: GroupBy,
  viewMode: ViewMode
): UsageSummaryBreakdown[] => {
  if (groupBy === 'time' || viewMode === 'list') return [];
  return [groupBy === 'model' ? 'modelAlias' : (groupBy as UsageSummaryBreakdown)];
};
