import { useEffect, useMemo, useState } from 'react';
import type { CustomDateRange } from '../lib/date';
import { useCurrency } from '../lib/CurrencyContext';
import {
  createMetrics,
  parseCustomDateRange,
  parsePresetFromQuery,
} from './detailed-usage/helpers';
import { DetailedUsageBreakdown } from './detailed-usage/DetailedUsageBreakdown';
import { DetailedUsageCharts } from './detailed-usage/DetailedUsageCharts';
import { DetailedUsageControls } from './detailed-usage/DetailedUsageControls';
import { DetailedUsageHeader } from './detailed-usage/DetailedUsageHeader';
import { DetailedUsageRequestLog } from './detailed-usage/DetailedUsageRequestLog';
import { DetailedUsageStats } from './detailed-usage/DetailedUsageStats';
import { useDetailedUsageData } from './detailed-usage/useDetailedUsageData';
import type { DetailedUsageProps, MetricKey } from './detailed-usage/types';

export const DetailedUsage = ({
  embedded = false,
  initialQueryString,
  onBack,
}: DetailedUsageProps) => {
  const { currency, rate, symbol, convert } = useCurrency();

  const resolvedQuery = useMemo(() => {
    if (typeof initialQueryString === 'string') {
      return initialQueryString;
    }
    if (typeof window !== 'undefined') {
      return window.location.search.replace(/^\?/, '');
    }
    return '';
  }, [initialQueryString]);

  const preset = useMemo(() => parsePresetFromQuery(resolvedQuery), [resolvedQuery]);

  const [timeRange, setTimeRange] = useState(preset.timeRange);
  const [customDateRange, setCustomDateRange] = useState<CustomDateRange | null>(() =>
    parseCustomDateRange(preset.customStartDate, preset.customEndDate)
  );
  const [chartType, setChartType] = useState(preset.chartType);
  const [groupBy, setGroupBy] = useState(preset.groupBy);
  const [viewMode, setViewMode] = useState(preset.viewMode);
  const [selectedMetrics, setSelectedMetrics] = useState<MetricKey[]>(preset.selectedMetrics);

  useEffect(() => {
    setTimeRange(preset.timeRange);
    setChartType(preset.chartType);
    setGroupBy(preset.groupBy);
    setViewMode(preset.viewMode);
    setSelectedMetrics(preset.selectedMetrics);
    setCustomDateRange(parseCustomDateRange(preset.customStartDate, preset.customEndDate));
  }, [preset]);

  const { records, summaryResponse, loading, loadError, lastUpdated, loadData, aggregatedData } =
    useDetailedUsageData({ timeRange, customDateRange, groupBy, viewMode });

  const metrics = useMemo(
    () => createMetrics({ currency, rate, symbol }),
    [currency, rate, symbol]
  );
  const chartData = useMemo(
    () => aggregatedData.map((point) => ({ ...point, cost: convert(point.cost) })),
    [aggregatedData, convert]
  );

  const toggleMetric = (key: MetricKey) =>
    setSelectedMetrics((previous) =>
      previous.includes(key) ? previous.filter((metric) => metric !== key) : [...previous, key]
    );

  const currencyDisplay = { currency, rate, symbol };

  return (
    <div
      className={
        embedded
          ? 'h-full p-2 bg-bg-card'
          : 'min-h-screen p-6 transition-all duration-300 bg-linear-to-br from-bg-deep to-bg-surface'
      }
    >
      <DetailedUsageHeader embedded={embedded} onBack={onBack} lastUpdated={lastUpdated} />
      {loadError && (
        <div className="mb-4 text-sm text-red-400" role="alert">
          Unable to load usage analytics for this selection. Try refreshing or choosing a shorter
          range.
        </div>
      )}

      <DetailedUsageStats
        loading={loading}
        summaryResponse={summaryResponse}
        currency={currency}
        rate={rate}
        symbol={symbol}
      />

      <DetailedUsageControls
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
        customDateRange={customDateRange}
        onCustomRangeChange={setCustomDateRange}
        groupBy={groupBy}
        onGroupByChange={setGroupBy}
        chartType={chartType}
        onChartTypeChange={setChartType}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        metrics={metrics}
        selectedMetrics={selectedMetrics}
        onToggleMetric={toggleMetric}
      />

      {viewMode === 'chart' ? (
        <DetailedUsageCharts
          aggregatedData={aggregatedData}
          chartData={chartData}
          chartType={chartType}
          selectedMetrics={selectedMetrics}
          metrics={metrics}
          loading={loading}
          hasSummary={summaryResponse !== null}
          groupBy={groupBy}
          onRefresh={loadData}
        />
      ) : (
        <DetailedUsageRequestLog
          records={records}
          totalRequests={summaryResponse?.stats.totalRequests ?? records.length}
          currency={currencyDisplay}
        />
      )}

      <DetailedUsageBreakdown
        aggregatedData={aggregatedData}
        groupBy={groupBy}
        currency={currencyDisplay}
      />
    </div>
  );
};
