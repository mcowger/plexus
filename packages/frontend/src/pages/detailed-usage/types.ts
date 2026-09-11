import type { CustomDateRange } from '../../lib/date';
import type { UsageRecord, UsageSummaryResponse } from '../../lib/api';

export type TimeRange = 'live' | 'hour' | 'day' | 'week' | 'month' | 'custom';
export type ChartType = 'line' | 'bar' | 'area' | 'pie' | 'composed';
export type GroupBy = 'time' | 'provider' | 'model' | 'apiKey' | 'status';
export type ViewMode = 'chart' | 'list';

export interface DetailedUsageProps {
  embedded?: boolean;
  initialQueryString?: string;
  onBack?: () => void;
}

export type MetricKey =
  | 'requests'
  | 'tokens'
  | 'cost'
  | 'duration'
  | 'ttft'
  | 'tps'
  | 'errors'
  | 'velocity';

export interface MetricConfig {
  key: MetricKey;
  label: string;
  color: string;
  yAxisId?: 'left' | 'right';
  format: (value: number) => string;
}

export interface AggregatedPoint {
  name: string;
  requests: number;
  errors: number;
  tokens: number;
  cost: number;
  duration: number;
  ttft: number;
  tps: number;
  successRate: number;
  velocity?: number;
  fill?: string;
}

export interface CostDisplay {
  currency: string;
  rate: number;
  symbol: string;
}

export interface DetailedUsagePreset {
  timeRange: TimeRange;
  chartType: ChartType;
  groupBy: GroupBy;
  viewMode: ViewMode;
  selectedMetrics: MetricKey[];
  customStartDate?: string;
  customEndDate?: string;
}

export interface UseDetailedUsageDataOptions {
  timeRange: TimeRange;
  customDateRange: CustomDateRange | null;
  groupBy: GroupBy;
  viewMode: ViewMode;
}

export interface DetailedUsageData {
  records: UsageRecord[];
  summaryResponse: UsageSummaryResponse | null;
  loading: boolean;
  loadError: boolean;
  lastUpdated: Date;
  loadData: () => Promise<void>;
  aggregatedData: AggregatedPoint[];
}
