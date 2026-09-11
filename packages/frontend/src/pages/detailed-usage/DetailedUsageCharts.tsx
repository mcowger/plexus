import { Loader2 } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Skeleton } from '../../components/ui/Skeleton';
import { COLORS } from './helpers';
import type { AggregatedPoint, ChartType, GroupBy, MetricConfig, MetricKey } from './types';

export const renderTimeSeriesChart = (
  data: AggregatedPoint[],
  chartType: ChartType,
  selectedMetrics: MetricKey[],
  metrics: MetricConfig[]
) => {
  const ChartComponent =
    chartType === 'composed'
      ? ComposedChart
      : chartType === 'bar'
        ? BarChart
        : chartType === 'line'
          ? LineChart
          : AreaChart;
  const isComposed = chartType === 'composed';
  const barMetrics = selectedMetrics.slice(0, 2);
  const rightAxisMetrics = metrics.filter(
    (metric) => metric.yAxisId === 'right' && selectedMetrics.includes(metric.key)
  );
  const costMetric = metrics.find((metric) => metric.key === 'cost');
  const rightAxisTickFormatter =
    rightAxisMetrics.length === 1 && rightAxisMetrics[0]?.key === 'cost'
      ? (value: number) => rightAxisMetrics[0].format(value)
      : undefined;

  return (
    <ResponsiveContainer width="100%" height={400}>
      <ChartComponent data={data} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
        <XAxis
          dataKey="name"
          stroke="var(--color-text-secondary)"
          tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }}
        />
        <YAxis
          yAxisId="left"
          stroke="var(--color-text-secondary)"
          tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          stroke="var(--color-text-secondary)"
          tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }}
          tickFormatter={rightAxisTickFormatter}
          label={
            selectedMetrics.includes('cost') && costMetric
              ? {
                  value: costMetric.label,
                  angle: 90,
                  position: 'insideRight',
                  fill: 'var(--color-text-secondary)',
                  fontSize: 12,
                }
              : undefined
          }
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
          }}
          labelStyle={{ color: 'var(--color-text)' }}
          formatter={(value, name) => {
            const metric = metrics.find((candidate) => candidate.label === String(name));
            return [
              metric ? metric.format(Number(value)) : String(value),
              metric?.label ?? String(name),
            ];
          }}
        />
        <Legend />
        {selectedMetrics.map((metricKey) => {
          const metric = metrics.find((candidate) => candidate.key === metricKey);
          if (!metric) return null;
          const isBar = isComposed ? barMetrics.includes(metricKey) : chartType === 'bar';
          const yAxisId = metric.yAxisId || 'left';

          if (isComposed && isBar) {
            return (
              <Bar
                key={metricKey}
                yAxisId={yAxisId}
                dataKey={metricKey}
                name={metric.label}
                fill={metric.color}
                radius={[4, 4, 0, 0]}
              />
            );
          }
          if (isComposed && !isBar) {
            return (
              <Line
                key={metricKey}
                yAxisId={yAxisId}
                type="monotone"
                dataKey={metricKey}
                name={metric.label}
                stroke={metric.color}
                strokeWidth={2}
                dot={false}
              />
            );
          }
          if (chartType === 'area') {
            return (
              <Area
                key={metricKey}
                yAxisId={yAxisId}
                type="monotone"
                dataKey={metricKey}
                name={metric.label}
                stroke={metric.color}
                fill={metric.color}
                fillOpacity={0.3}
              />
            );
          }
          if (chartType === 'line') {
            return (
              <Line
                key={metricKey}
                yAxisId={yAxisId}
                type="monotone"
                dataKey={metricKey}
                name={metric.label}
                stroke={metric.color}
                strokeWidth={2}
                dot={{ r: 4 }}
              />
            );
          }
          return (
            <Bar
              key={metricKey}
              yAxisId={yAxisId}
              dataKey={metricKey}
              name={metric.label}
              fill={metric.color}
              radius={[4, 4, 0, 0]}
            />
          );
        })}
      </ChartComponent>
    </ResponsiveContainer>
  );
};

export const renderPieChart = (
  data: AggregatedPoint[],
  metricKey: MetricKey,
  metrics: MetricConfig[]
) => {
  const metric = metrics.find((candidate) => candidate.key === metricKey);
  const pieData = data
    .map((item, index) => ({
      name: item.name,
      value: item[metricKey] || 0,
      fill: item.fill || COLORS[index % COLORS.length],
    }))
    .filter((item) => item.value > 0);

  return (
    <ResponsiveContainer width="100%" height={400}>
      <PieChart>
        <Pie
          data={pieData}
          cx="50%"
          cy="50%"
          labelLine={false}
          label={({ name, percent }) => `${name}: ${((percent || 0) * 100).toFixed(0)}%`}
          outerRadius={120}
          dataKey="value"
        >
          {pieData.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.fill} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
          }}
          formatter={(value) => [
            metric ? metric.format(Number(value)) : String(value),
            metric?.label ?? metricKey,
          ]}
        />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
};

interface DetailedUsageChartsProps {
  aggregatedData: AggregatedPoint[];
  chartData: AggregatedPoint[];
  chartType: ChartType;
  selectedMetrics: MetricKey[];
  metrics: MetricConfig[];
  loading: boolean;
  hasSummary: boolean;
  groupBy: GroupBy;
  onRefresh: () => void | Promise<void>;
}

export const DetailedUsageCharts = ({
  aggregatedData,
  chartData,
  chartType,
  selectedMetrics,
  metrics,
  loading,
  hasSummary,
  groupBy,
  onRefresh,
}: DetailedUsageChartsProps) => (
  <Card
    title={`Usage by ${groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}`}
    extra={
      <Button size="sm" variant="secondary" onClick={onRefresh} isLoading={loading}>
        Refresh
      </Button>
    }
  >
    {loading && hasSummary && (
      <div
        className="mb-3 inline-flex items-center gap-1 text-xs text-text-secondary"
        role="status"
      >
        <Loader2 size={13} className="animate-spin" aria-hidden="true" />
        Updating analytics…
      </div>
    )}
    {loading && !hasSummary ? (
      <Skeleton height={400} className="w-full" />
    ) : aggregatedData.length === 0 ? (
      <div className="h-96 flex items-center justify-center text-text-secondary">
        No data available
      </div>
    ) : chartType === 'pie' ? (
      renderPieChart(chartData, selectedMetrics[0] || 'requests', metrics)
    ) : (
      renderTimeSeriesChart(chartData, chartType, selectedMetrics, metrics)
    )}
  </Card>
);
