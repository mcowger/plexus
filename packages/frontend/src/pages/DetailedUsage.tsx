import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { api, type UsageRecord, type UsageSummaryResponse } from '../lib/api';
import { formatCost, formatMs, formatNumber, formatTokens, formatTimeAgo } from '../lib/format';
import { Activity, BarChart3, LineChart as LineChartIcon, PieChart as PieChartIcon, TrendingUp, Clock, DollarSign, Database } from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Area,
  AreaChart
} from 'recharts';

type TimeRange = 'hour' | 'day' | 'week' | 'month';
type ChartType = 'line' | 'bar' | 'area' | 'pie';
type GroupBy = 'time' | 'provider' | 'model' | 'apiKey' | 'status';

interface MetricConfig {
  key: string;
  label: string;
  color: string;
  format: (value: number) => string;
}

const METRICS: MetricConfig[] = [
  { key: 'requests', label: 'Requests', color: '#3b82f6', format: (v) => formatNumber(v, 0) },
  { key: 'tokens', label: 'Tokens', color: '#10b981', format: (v) => formatTokens(v) },
  { key: 'cost', label: 'Cost', color: '#f59e0b', format: (v) => formatCost(v, 4) },
  { key: 'duration', label: 'Duration', color: '#8b5cf6', format: (v) => formatMs(v) },
  { key: 'ttft', label: 'TTFT', color: '#ec4899', format: (v) => formatMs(v) }
];

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#84cc16'];

const getRangeStartDate = (range: TimeRange, now: Date) => {
  const startDate = new Date(now);

  switch (range) {
    case 'hour':
      startDate.setHours(startDate.getHours() - 1);
      break;
    case 'day':
      startDate.setHours(startDate.getHours() - 24);
      break;
    case 'week':
      startDate.setDate(startDate.getDate() - 7);
      break;
    case 'month':
      startDate.setDate(startDate.getDate() - 30);
      break;
  }

  return startDate;
};

const formatBucketLabel = (range: TimeRange, bucketStartMs: number) => {
  const date = new Date(bucketStartMs);
  if (range === 'hour' || range === 'day') {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString();
};

export const DetailedUsage = () => {
  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [summary, setSummary] = useState<UsageSummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>('day');
  const [chartType, setChartType] = useState<ChartType>('area');
  const [groupBy, setGroupBy] = useState<GroupBy>('time');
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(['requests', 'tokens', 'cost']);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const now = new Date();
      const startDate = getRangeStartDate(timeRange, now);

      const [summaryResponse, logsResponse] = await Promise.all([
        api.getUsageSummary(timeRange),
        api.getLogs(5000, 0, {
          startDate: startDate.toISOString(),
        })
      ]);

      setSummary(summaryResponse);
      setRecords(logsResponse.data || []);
      setLastUpdated(new Date());
    } catch (e) {
      console.error('Failed to load usage data', e);
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  const aggregatedData = useMemo(() => {
    if (groupBy === 'time' && summary?.range === timeRange) {
      return summary.series
        .map((point) => ({
          bucketStartMs: point.bucketStartMs,
          name: formatBucketLabel(timeRange, point.bucketStartMs),
          requests: point.requests,
          tokens: point.tokens,
          cost: point.totalCost || 0,
          duration: point.avgDurationMs || 0,
          ttft: point.avgTtftMs || 0
        }))
        .sort((a, b) => a.bucketStartMs - b.bucketStartMs)
        .map(({ bucketStartMs: _bucketStartMs, ...point }) => point);
    }

    if (groupBy === 'time') {
      const grouped = new Map<number, { requests: number; tokens: number; cost: number; duration: number; ttft: number; count: number }>();

      records.forEach((record) => {
        const date = new Date(record.date);
        if (Number.isNaN(date.getTime())) {
          return;
        }

        if (timeRange === 'hour') {
          date.setSeconds(0, 0);
        } else if (timeRange === 'day') {
          date.setMinutes(0, 0, 0);
        } else {
          date.setHours(0, 0, 0, 0);
        }

        const bucketStartMs = date.getTime();
        const existing = grouped.get(bucketStartMs) || { requests: 0, tokens: 0, cost: 0, duration: 0, ttft: 0, count: 0 };
        existing.requests += 1;
        existing.tokens += (record.tokensInput || 0) + (record.tokensOutput || 0) + (record.tokensReasoning || 0) + (record.tokensCached || 0);
        existing.cost += record.costTotal || 0;
        existing.duration += record.durationMs || 0;
        existing.ttft += record.ttftMs || 0;
        existing.count += 1;
        grouped.set(bucketStartMs, existing);
      });

      return Array.from(grouped.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([bucketStartMs, value]) => ({
          name: formatBucketLabel(timeRange, bucketStartMs),
          requests: value.requests,
          tokens: value.tokens,
          cost: value.cost,
          duration: value.count > 0 ? value.duration / value.count : 0,
          ttft: value.count > 0 ? value.ttft / value.count : 0
        }));
    } else {
      const grouped = new Map<string, { requests: number; tokens: number; cost: number; duration: number; ttft: number; count: number }>();
      
      records.forEach((record) => {
        let key: string;
        switch (groupBy) {
          case 'provider':
            key = record.provider || 'unknown';
            break;
          case 'model':
            key = record.incomingModelAlias || record.selectedModelName || 'unknown';
            break;
          case 'apiKey':
            key = record.apiKey ? `${record.apiKey.slice(0, 8)}...` : 'unknown';
            break;
          case 'status':
            key = record.responseStatus || 'unknown';
            break;
          default:
            key = 'unknown';
        }

        const existing = grouped.get(key) || { requests: 0, tokens: 0, cost: 0, duration: 0, ttft: 0, count: 0 };
        existing.requests += 1;
        existing.tokens += (record.tokensInput || 0) + (record.tokensOutput || 0) + (record.tokensReasoning || 0) + (record.tokensCached || 0);
        existing.cost += record.costTotal || 0;
        existing.duration += record.durationMs || 0;
        existing.ttft += record.ttftMs || 0;
        existing.count += 1;
        grouped.set(key, existing);
      });

      return Array.from(grouped.entries())
        .map(([key, value]) => ({
          name: key,
          requests: value.requests,
          tokens: value.tokens,
          cost: value.cost,
          duration: value.count > 0 ? value.duration / value.count : 0,
          ttft: value.count > 0 ? value.ttft / value.count : 0,
          fill: COLORS[Math.abs(key.split('').reduce((a, b) => a + b.charCodeAt(0), 0)) % COLORS.length]
        }))
        .sort((a, b) => b.requests - a.requests)
        .slice(0, 10);
    }
  }, [records, summary, groupBy, timeRange]);

  const stats = useMemo(() => {
    const total = summary?.stats.totalRequests ?? records.length;
    const tokens = summary?.stats.totalTokens
      ?? records.reduce((acc, r) => acc + (r.tokensInput || 0) + (r.tokensOutput || 0) + (r.tokensReasoning || 0) + (r.tokensCached || 0), 0);
    const cost = summary?.stats.totalCost
      ?? records.reduce((acc, r) => acc + (r.costTotal || 0), 0);
    const avgDuration = summary?.stats.avgDurationMs
      ?? (total > 0 ? records.reduce((acc, r) => acc + (r.durationMs || 0), 0) / total : 0);
    const successCount = records.filter(r => r.responseStatus === 'success').length;
    const successRateBase = records.length;
    const successRate = successRateBase > 0 ? (successCount / successRateBase) * 100 : 0;

    return [
      { label: 'Total Requests', value: formatNumber(total, 0), icon: Activity },
      { label: 'Total Tokens', value: formatTokens(tokens), icon: Database },
      { label: 'Total Cost', value: formatCost(cost, 4), icon: DollarSign },
      { label: 'Avg Duration', value: formatMs(avgDuration), icon: Clock },
      { label: 'Success Rate', value: `${successRate.toFixed(1)}%`, icon: TrendingUp }
    ];
  }, [records, summary]);

  const toggleMetric = (metricKey: string) => {
    setSelectedMetrics(prev => 
      prev.includes(metricKey) 
        ? prev.filter(m => m !== metricKey)
        : [...prev, metricKey]
    );
  };

  const renderChart = () => {
    if (groupBy === 'time') {
      const ChartComponent = chartType === 'line' ? LineChart : chartType === 'bar' ? BarChart : AreaChart;
      
      return (
        <ResponsiveContainer width="100%" height={400}>
          <ChartComponent data={aggregatedData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
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
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: 'var(--color-bg-card)', 
                border: '1px solid var(--color-border)',
                borderRadius: '8px'
              }}
              labelStyle={{ color: 'var(--color-text)' }}
            />
            <Legend />
            {selectedMetrics.includes('requests') && (
              chartType === 'area' ? (
                <Area 
                  yAxisId="left"
                  type="monotone" 
                  dataKey="requests" 
                  name="Requests"
                  stroke={METRICS[0].color}
                  fill={METRICS[0].color}
                  fillOpacity={0.3}
                />
              ) : chartType === 'line' ? (
                <Line 
                  yAxisId="left"
                  type="monotone" 
                  dataKey="requests" 
                  name="Requests"
                  stroke={METRICS[0].color}
                  strokeWidth={2}
                  dot={{ r: 4 }}
                />
              ) : (
                <Bar 
                  yAxisId="left"
                  dataKey="requests" 
                  name="Requests"
                  fill={METRICS[0].color}
                  radius={[4, 4, 0, 0]}
                />
              )
            )}
            {selectedMetrics.includes('tokens') && (
              chartType === 'area' ? (
                <Area 
                  yAxisId="right"
                  type="monotone" 
                  dataKey="tokens" 
                  name="Tokens"
                  stroke={METRICS[1].color}
                  fill={METRICS[1].color}
                  fillOpacity={0.3}
                />
              ) : chartType === 'line' ? (
                <Line 
                  yAxisId="right"
                  type="monotone" 
                  dataKey="tokens" 
                  name="Tokens"
                  stroke={METRICS[1].color}
                  strokeWidth={2}
                  dot={{ r: 4 }}
                />
              ) : (
                <Bar 
                  yAxisId="right"
                  dataKey="tokens" 
                  name="Tokens"
                  fill={METRICS[1].color}
                  radius={[4, 4, 0, 0]}
                />
              )
            )}
            {selectedMetrics.includes('cost') && (
              chartType === 'area' ? (
                <Area 
                  yAxisId="right"
                  type="monotone" 
                  dataKey="cost" 
                  name="Cost"
                  stroke={METRICS[2].color}
                  fill={METRICS[2].color}
                  fillOpacity={0.3}
                />
              ) : chartType === 'line' ? (
                <Line 
                  yAxisId="right"
                  type="monotone" 
                  dataKey="cost" 
                  name="Cost"
                  stroke={METRICS[2].color}
                  strokeWidth={2}
                  dot={{ r: 4 }}
                />
              ) : (
                <Bar 
                  yAxisId="right"
                  dataKey="cost" 
                  name="Cost"
                  fill={METRICS[2].color}
                  radius={[4, 4, 0, 0]}
                />
              )
            )}
          </ChartComponent>
        </ResponsiveContainer>
      );
    } else {
      const pieData = aggregatedData.map((item, index) => ({
        name: item.name,
        value: item[selectedMetrics[0] as keyof typeof item] as number || 0,
        fill: COLORS[index % COLORS.length]
      })).filter(item => item.value > 0);

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
              fill="#8884d8"
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
                borderRadius: '8px'
              }}
            />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      );
    }
  };

  return (
    <div className="min-h-screen p-6 transition-all duration-300 bg-gradient-to-br from-bg-deep to-bg-surface">
      <div className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-3xl font-bold text-text m-0 mb-2">Detailed Usage</h1>
            <p className="text-text-secondary">Advanced analytics with customizable chart types</p>
          </div>
          <Badge status="connected" secondaryText={`Last updated: ${formatTimeAgo(Math.floor((Date.now() - lastUpdated.getTime()) / 1000))}`}>
            Live Data
          </Badge>
        </div>
      </div>

      <div className="mb-6" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px' }}>
        {stats.map((stat, index) => (
          <div key={index} className="glass-bg rounded-lg p-4 flex flex-col gap-1">
            <div className="flex justify-between items-start">
              <span className="font-body text-xs font-semibold text-text-muted uppercase tracking-wider">{stat.label}</span>
              <div className="w-8 h-8 rounded-sm flex items-center justify-center text-text-secondary">
                <stat.icon size={20} />
              </div>
            </div>
            <div className="font-heading text-2xl font-bold text-text">{stat.value}</div>
          </div>
        ))}
      </div>

      <Card className="mb-6" title="Chart Configuration">
        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-text-muted uppercase">Time Range</span>
            <div className="flex gap-2">
              {(['hour', 'day', 'week', 'month'] as TimeRange[]).map((range) => (
                <Button
                  key={range}
                  size="sm"
                  variant={timeRange === range ? 'primary' : 'secondary'}
                  onClick={() => setTimeRange(range)}
                >
                  {range.charAt(0).toUpperCase() + range.slice(1)}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-text-muted uppercase">Group By</span>
            <div className="flex gap-2">
              {[
                { key: 'time', label: 'Time' },
                { key: 'provider', label: 'Provider' },
                { key: 'model', label: 'Model' },
                { key: 'status', label: 'Status' }
              ].map((option) => (
                <Button
                  key={option.key}
                  size="sm"
                  variant={groupBy === option.key ? 'primary' : 'secondary'}
                  onClick={() => setGroupBy(option.key as GroupBy)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-text-muted uppercase">Chart Type</span>
            <div className="flex gap-2">
              {[
                { key: 'area', icon: LineChartIcon, label: 'Area' },
                { key: 'line', icon: LineChartIcon, label: 'Line' },
                { key: 'bar', icon: BarChart3, label: 'Bar' },
                { key: 'pie', icon: PieChartIcon, label: 'Pie' }
              ].map((type) => (
                <Button
                  key={type.key}
                  size="sm"
                  variant={chartType === type.key ? 'primary' : 'secondary'}
                  onClick={() => setChartType(type.key as ChartType)}
                  disabled={groupBy !== 'time' && type.key !== 'pie'}
                >
                  <type.icon size={16} className="mr-1" />
                  {type.label}
                </Button>
              ))}
            </div>
          </div>

          {groupBy === 'time' && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-text-muted uppercase">Metrics</span>
              <div className="flex gap-2 flex-wrap">
                {METRICS.slice(0, 4).map((metric) => (
                  <button
                    key={metric.key}
                    onClick={() => toggleMetric(metric.key)}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                      selectedMetrics.includes(metric.key)
                        ? 'bg-primary text-white'
                        : 'bg-bg-hover text-text-secondary hover:text-text'
                    }`}
                  >
                    {metric.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card 
        title={`Usage by ${groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}`}
        extra={
          <Button size="sm" variant="secondary" onClick={loadData} isLoading={loading}>
            Refresh
          </Button>
        }
      >
        {aggregatedData.length === 0 ? (
          <div className="h-96 flex items-center justify-center text-text-secondary">
            No data available for the selected time range
          </div>
        ) : (
          renderChart()
        )}
      </Card>

      {groupBy !== 'time' && aggregatedData.length > 0 && (
        <Card className="mt-6" title="Detailed Breakdown">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-border-glass text-text-secondary">
                  <th className="py-3 pr-4">{groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}</th>
                  <th className="py-3 pr-4">Requests</th>
                  <th className="py-3 pr-4">Tokens</th>
                  <th className="py-3 pr-4">Cost</th>
                  <th className="py-3 pr-4">Avg Duration</th>
                  <th className="py-3 pr-4">Avg TTFT</th>
                </tr>
              </thead>
              <tbody>
                {aggregatedData.map((row, index) => (
                  <tr key={index} className="border-b border-border-glass/50">
                    <td className="py-3 pr-4 font-medium">{row.name}</td>
                    <td className="py-3 pr-4">{formatNumber(row.requests, 0)}</td>
                    <td className="py-3 pr-4">{formatTokens(row.tokens)}</td>
                    <td className="py-3 pr-4">{formatCost(row.cost, 6)}</td>
                    <td className="py-3 pr-4">{formatMs(row.duration)}</td>
                    <td className="py-3 pr-4">{formatMs(row.ttft)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
};
