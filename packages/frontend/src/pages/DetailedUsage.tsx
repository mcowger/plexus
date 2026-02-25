import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { api, type UsageRecord } from '../lib/api';
import { formatCost, formatMs, formatNumber, formatTokens, formatTimeAgo } from '../lib/format';
import { Activity, BarChart3, LineChart as LineChartIcon, PieChart as PieChartIcon, TrendingUp, Clock, DollarSign, Database, List, AlertTriangle, ArrowLeft } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, Area, AreaChart, ComposedChart
} from 'recharts';

type TimeRange = 'live' | 'hour' | 'day' | 'week' | 'month';
type ChartType = 'line' | 'bar' | 'area' | 'pie' | 'composed';
type GroupBy = 'time' | 'provider' | 'model' | 'apiKey' | 'status';
type ViewMode = 'chart' | 'list';

interface DetailedUsageProps {
  embedded?: boolean;
  initialQueryString?: string;
  onBack?: () => void;
}

interface MetricConfig {
  key: string;
  label: string;
  color: string;
  yAxisId?: 'left' | 'right';
  format: (value: number) => string;
}

interface AggregatedPoint {
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

const METRICS: MetricConfig[] = [
  { key: 'requests', label: 'Requests', color: '#3b82f6', yAxisId: 'left', format: (v) => formatNumber(v, 0) },
  { key: 'tokens', label: 'Tokens', color: '#10b981', yAxisId: 'right', format: (v) => formatTokens(v) },
  { key: 'cost', label: 'Cost', color: '#f59e0b', yAxisId: 'right', format: (v) => formatCost(v, 4) },
  { key: 'duration', label: 'Duration', color: '#8b5cf6', yAxisId: 'right', format: (v) => formatMs(v) },
  { key: 'ttft', label: 'TTFT', color: '#ec4899', yAxisId: 'right', format: (v) => formatMs(v) },
  { key: 'tps', label: 'TPS', color: '#06b6d4', yAxisId: 'right', format: (v) => formatNumber(v, 1) },
  { key: 'errors', label: 'Errors', color: '#ef4444', yAxisId: 'left', format: (v) => formatNumber(v, 0) }
];

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#84cc16'];
const LIVE_WINDOW_MINUTES = 5;

const ALLOWED_TIME_RANGES: TimeRange[] = ['live', 'hour', 'day', 'week', 'month'];
const ALLOWED_CHART_TYPES: ChartType[] = ['line', 'bar', 'area', 'pie', 'composed'];
const ALLOWED_GROUP_BY: GroupBy[] = ['time', 'provider', 'model', 'apiKey', 'status'];
const ALLOWED_VIEW_MODES: ViewMode[] = ['chart', 'list'];

const parsePresetFromQuery = (query: string): {
  timeRange: TimeRange;
  chartType: ChartType;
  groupBy: GroupBy;
  viewMode: ViewMode;
  selectedMetrics: string[];
} => {
  const params = new URLSearchParams(query);

  const range = params.get('range');
  const chartType = params.get('chartType');
  const groupBy = params.get('groupBy');
  const viewMode = params.get('viewMode');
  const metrics = params.get('metrics');
  const metric = params.get('metric');

  const parsedMetrics = (metrics ? metrics.split(',') : metric ? [metric] : ['requests', 'tokens', 'cost'])
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return {
    timeRange: ALLOWED_TIME_RANGES.includes(range as TimeRange) ? (range as TimeRange) : 'day',
    chartType: ALLOWED_CHART_TYPES.includes(chartType as ChartType) ? (chartType as ChartType) : 'area',
    groupBy: ALLOWED_GROUP_BY.includes(groupBy as GroupBy) ? (groupBy as GroupBy) : 'time',
    viewMode: ALLOWED_VIEW_MODES.includes(viewMode as ViewMode) ? (viewMode as ViewMode) : 'chart',
    selectedMetrics: parsedMetrics.length > 0 ? parsedMetrics : ['requests', 'tokens', 'cost'],
  };
};

const getRangeConfig = (range: TimeRange): { minutes: number; bucketFn: (d: Date) => void } => {
  switch (range) {
    case 'live': return { minutes: LIVE_WINDOW_MINUTES, bucketFn: (d) => d.setSeconds(0, 0) };
    case 'hour': return { minutes: 60, bucketFn: (d) => d.setSeconds(0, 0) };
    case 'day': return { minutes: 1440, bucketFn: (d) => d.setMinutes(0, 0, 0) };
    case 'week': return { minutes: 10080, bucketFn: (d) => d.setHours(0, 0, 0, 0) };
    case 'month': return { minutes: 43200, bucketFn: (d) => d.setHours(0, 0, 0, 0) };
  }
};

const formatBucketLabel = (range: TimeRange, ms: number) => {
  const d = new Date(ms);
  return range === 'live' || range === 'hour' || range === 'day'
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString();
};

const calcVelocity = (data: AggregatedPoint[]): AggregatedPoint[] => {
  return data.map((point, i, arr) => ({
    ...point,
    velocity: i === 0 ? 0 : point.requests - arr[i - 1].requests
  }));
};

const aggregateByTime = (records: UsageRecord[], range: TimeRange): AggregatedPoint[] => {
  const { bucketFn } = getRangeConfig(range);
  const grouped = new Map<number, { requests: number; errors: number; tokens: number; cost: number; duration: number; ttft: number; tps: number; count: number }>();

  records.forEach(r => {
    const d = new Date(r.date);
    if (Number.isNaN(d.getTime())) return;
    bucketFn(d);
    const ms = d.getTime();
    const ex = grouped.get(ms) || { requests: 0, errors: 0, tokens: 0, cost: 0, duration: 0, ttft: 0, tps: 0, count: 0 };
    ex.requests++;
    if (r.responseStatus !== 'success') ex.errors++;
    ex.tokens += (r.tokensInput || 0) + (r.tokensOutput || 0) + (r.tokensReasoning || 0) + (r.tokensCached || 0);
    ex.cost += r.costTotal || 0;
    ex.duration += r.durationMs || 0;
    ex.ttft += r.ttftMs || 0;
    ex.tps += r.tokensPerSec || 0;
    ex.count++;
    grouped.set(ms, ex);
  });

  const data = Array.from(grouped.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([ms, v]) => ({
      name: formatBucketLabel(range, ms),
      requests: v.requests,
      errors: v.errors,
      tokens: v.tokens,
      cost: v.cost,
      duration: v.count > 0 ? v.duration / v.count : 0,
      ttft: v.count > 0 ? v.ttft / v.count : 0,
      tps: v.count > 0 ? v.tps / v.count : 0,
      successRate: v.requests > 0 ? ((v.requests - v.errors) / v.requests) * 100 : 0
    }));

  return calcVelocity(data);
};

const aggregateByGroup = (records: UsageRecord[], groupBy: GroupBy): AggregatedPoint[] => {
  const grouped = new Map<string, { requests: number; errors: number; tokens: number; cost: number; duration: number; ttft: number; tps: number; count: number }>();

  records.forEach(r => {
    let key: string;
    switch (groupBy) {
      case 'provider': key = r.provider || 'unknown'; break;
      case 'model': key = r.incomingModelAlias || r.selectedModelName || 'unknown'; break;
      case 'apiKey': key = r.apiKey ? `${r.apiKey.slice(0, 8)}...` : 'unknown'; break;
      case 'status': key = r.responseStatus || 'unknown'; break;
      default: key = 'unknown';
    }

    const ex = grouped.get(key) || { requests: 0, errors: 0, tokens: 0, cost: 0, duration: 0, ttft: 0, tps: 0, count: 0 };
    ex.requests++;
    if (r.responseStatus !== 'success') ex.errors++;
    ex.tokens += (r.tokensInput || 0) + (r.tokensOutput || 0) + (r.tokensReasoning || 0) + (r.tokensCached || 0);
    ex.cost += r.costTotal || 0;
    ex.duration += r.durationMs || 0;
    ex.ttft += r.ttftMs || 0;
    ex.tps += r.tokensPerSec || 0;
    ex.count++;
    grouped.set(key, ex);
  });

  return Array.from(grouped.entries())
    .map(([name, v]) => ({
      name,
      requests: v.requests,
      errors: v.errors,
      tokens: v.tokens,
      cost: v.cost,
      duration: v.count > 0 ? v.duration / v.count : 0,
      ttft: v.count > 0 ? v.ttft / v.count : 0,
      tps: v.count > 0 ? v.tps / v.count : 0,
      successRate: v.requests > 0 ? ((v.requests - v.errors) / v.requests) * 100 : 0,
      fill: COLORS[Math.abs(name.split('').reduce((a, b) => a + b.charCodeAt(0), 0)) % COLORS.length]
    }))
    .sort((a, b) => b.requests - a.requests)
    .slice(0, 10);
};

const renderTimeSeriesChart = (data: AggregatedPoint[], chartType: ChartType, selectedMetrics: string[]) => {
  const ChartComponent = chartType === 'composed' ? ComposedChart : chartType === 'bar' ? BarChart : chartType === 'line' ? LineChart : AreaChart;
  const isComposed = chartType === 'composed';
  const barMetrics = selectedMetrics.slice(0, 2);

  return (
    <ResponsiveContainer width="100%" height={400}>
      <ChartComponent data={data} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
        <XAxis dataKey="name" stroke="var(--color-text-secondary)" tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} />
        <YAxis yAxisId="left" stroke="var(--color-text-secondary)" tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} />
        <YAxis yAxisId="right" orientation="right" stroke="var(--color-text-secondary)" tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} />
        <Tooltip contentStyle={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: '8px' }} labelStyle={{ color: 'var(--color-text)' }} />
        <Legend />
        {selectedMetrics.map(metricKey => {
          const metric = METRICS.find(m => m.key === metricKey);
          if (!metric) return null;
          const isBar = isComposed ? barMetrics.includes(metricKey) : chartType === 'bar';
          const yAxisId = metric.yAxisId || 'left';

          if (isComposed && isBar) {
            return <Bar key={metricKey} yAxisId={yAxisId} dataKey={metricKey} name={metric.label} fill={metric.color} radius={[4, 4, 0, 0]} />;
          }
          if (isComposed && !isBar) {
            return <Line key={metricKey} yAxisId={yAxisId} type="monotone" dataKey={metricKey} name={metric.label} stroke={metric.color} strokeWidth={2} dot={false} />;
          }
          if (chartType === 'area') {
            return <Area key={metricKey} yAxisId={yAxisId} type="monotone" dataKey={metricKey} name={metric.label} stroke={metric.color} fill={metric.color} fillOpacity={0.3} />;
          }
          if (chartType === 'line') {
            return <Line key={metricKey} yAxisId={yAxisId} type="monotone" dataKey={metricKey} name={metric.label} stroke={metric.color} strokeWidth={2} dot={{ r: 4 }} />;
          }
          return <Bar key={metricKey} yAxisId={yAxisId} dataKey={metricKey} name={metric.label} fill={metric.color} radius={[4, 4, 0, 0]} />;
        })}
      </ChartComponent>
    </ResponsiveContainer>
  );
};

const renderPieChart = (data: AggregatedPoint[], metricKey: string) => {
  const pieData = data.map((item, index) => ({
    name: item.name,
    value: item[metricKey as keyof AggregatedPoint] as number || 0,
    fill: item.fill || COLORS[index % COLORS.length]
  })).filter(item => item.value > 0);

  return (
    <ResponsiveContainer width="100%" height={400}>
      <PieChart>
        <Pie data={pieData} cx="50%" cy="50%" labelLine={false} label={({ name, percent }) => `${name}: ${((percent || 0) * 100).toFixed(0)}%`} outerRadius={120} dataKey="value">
          {pieData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.fill} />)}
        </Pie>
        <Tooltip contentStyle={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: '8px' }} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
};

export const DetailedUsage: React.FC<DetailedUsageProps> = ({
  embedded = false,
  initialQueryString,
  onBack,
}) => {
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

  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>(preset.timeRange);
  const [chartType, setChartType] = useState<ChartType>(preset.chartType);
  const [groupBy, setGroupBy] = useState<GroupBy>(preset.groupBy);
  const [viewMode, setViewMode] = useState<ViewMode>(preset.viewMode);
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(preset.selectedMetrics);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  useEffect(() => {
    setTimeRange(preset.timeRange);
    setChartType(preset.chartType);
    setGroupBy(preset.groupBy);
    setViewMode(preset.viewMode);
    setSelectedMetrics(preset.selectedMetrics);
  }, [preset]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { minutes } = getRangeConfig(timeRange);
      const startDate = new Date(Date.now() - minutes * 60000);

      const logsResponse = await api.getLogs(5000, 0, { startDate: startDate.toISOString() });

      setRecords(logsResponse.data || []);
      setLastUpdated(new Date());
    } catch (e) {
      console.error('Failed to load usage data', e);
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => { loadData(); const interval = setInterval(loadData, 30000); return () => clearInterval(interval); }, [loadData]);

  const aggregatedData = useMemo(() => {
    if (groupBy === 'time') return aggregateByTime(records, timeRange);
    return aggregateByGroup(records, groupBy);
  }, [records, groupBy, timeRange]);

  const stats = useMemo(() => {
    const total = records.length;
    const errors = records.filter(r => r.responseStatus !== 'success').length;
    const tokens = records.reduce((acc, r) => acc + (r.tokensInput || 0) + (r.tokensOutput || 0) + (r.tokensReasoning || 0) + (r.tokensCached || 0), 0);
    const cost = records.reduce((acc, r) => acc + (r.costTotal || 0), 0);
    const avgDuration = total > 0 ? records.reduce((acc, r) => acc + (r.durationMs || 0), 0) / total : 0;
    const avgTtft = total > 0 ? records.reduce((acc, r) => acc + (r.ttftMs || 0), 0) / total : 0;
    const avgTps = total > 0 ? records.reduce((acc, r) => acc + (r.tokensPerSec || 0), 0) / total : 0;
    const successRate = total > 0 ? ((total - errors) / total) * 100 : 0;

    return [
      { label: 'Requests', value: formatNumber(total, 0), icon: Activity },
      { label: 'Errors', value: formatNumber(errors, 0), icon: AlertTriangle, color: errors > 0 ? 'text-red-500' : '' },
      { label: 'Tokens', value: formatTokens(tokens), icon: Database },
      { label: 'Cost', value: formatCost(cost, 4), icon: DollarSign },
      { label: 'Avg Duration', value: formatMs(avgDuration), icon: Clock },
      { label: 'Avg TTFT', value: formatMs(avgTtft), icon: Clock },
      { label: 'Avg TPS', value: formatNumber(avgTps, 1), icon: TrendingUp },
      { label: 'Success Rate', value: `${successRate.toFixed(1)}%`, icon: TrendingUp }
    ];
  }, [records]);

  const toggleMetric = (key: string) => setSelectedMetrics(prev => prev.includes(key) ? prev.filter(m => m !== key) : [...prev, key]);

  return (
    <div className={embedded ? 'h-full p-2 bg-bg-card' : 'min-h-screen p-6 transition-all duration-300 bg-gradient-to-br from-bg-deep to-bg-surface'}>
      <div className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-3xl font-bold text-text m-0 mb-2">Detailed Usage</h1>
            <p className="text-text-secondary">Advanced analytics with customizable chart types</p>
          </div>
          <div className="flex items-center gap-3">
            {(onBack || !embedded) && (
              <Button size="sm" variant="secondary" onClick={() => (onBack ? onBack() : (window.location.href = '/ui/live-metrics'))}>
                <ArrowLeft size={16} className="mr-1" />
                {onBack ? 'Back to Live Card' : 'Return to Live Metrics'}
              </Button>
            )}
            <Badge status="connected" secondaryText={`Last updated: ${formatTimeAgo(Math.floor((Date.now() - lastUpdated.getTime()) / 1000))}`}>Live Data</Badge>
          </div>
        </div>
      </div>

      <div className="mb-6" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
        {stats.map((stat, i) => (
          <div key={i} className="glass-bg rounded-lg p-3 flex flex-col gap-1">
            <div className="flex justify-between items-start">
              <span className="font-body text-xs font-semibold text-text-muted uppercase tracking-wider">{stat.label}</span>
              <stat.icon size={16} className={`text-text-secondary ${stat.color || ''}`} />
            </div>
            <div className={`font-heading text-xl font-bold ${stat.color || 'text-text'}`}>{stat.value}</div>
          </div>
        ))}
      </div>

      <Card className="mb-6" title="Chart Configuration">
        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-text-muted uppercase">Time Range</span>
            <div className="flex gap-2">
              {(['live', 'hour', 'day', 'week', 'month'] as TimeRange[]).map(r => (
                <Button key={r} size="sm" variant={timeRange === r ? 'primary' : 'secondary'} onClick={() => setTimeRange(r)}>
                  {r === 'live' ? '5m' : r.charAt(0).toUpperCase() + r.slice(1)}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-text-muted uppercase">Group By</span>
            <div className="flex gap-2">
              {[{ k: 'time', l: 'Time' }, { k: 'provider', l: 'Provider' }, { k: 'model', l: 'Model' }, { k: 'status', l: 'Status' }].map(o => (
                <Button key={o.k} size="sm" variant={groupBy === o.k ? 'primary' : 'secondary'} onClick={() => setGroupBy(o.k as GroupBy)}>{o.l}</Button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-text-muted uppercase">Chart Type</span>
            <div className="flex gap-2">
              {[{ k: 'area', i: LineChartIcon, l: 'Area' }, { k: 'line', i: LineChartIcon, l: 'Line' }, { k: 'bar', i: BarChart3, l: 'Bar' }, { k: 'composed', i: BarChart3, l: 'Mixed' }, { k: 'pie', i: PieChartIcon, l: 'Pie' }].map(t => (
                <Button key={t.k} size="sm" variant={chartType === t.k ? 'primary' : 'secondary'} onClick={() => setChartType(t.k as ChartType)} disabled={groupBy !== 'time' && t.k !== 'pie'}>
                  <t.i size={14} className="mr-1" />{t.l}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-text-muted uppercase">View</span>
            <div className="flex gap-2">
              <Button size="sm" variant={viewMode === 'chart' ? 'primary' : 'secondary'} onClick={() => setViewMode('chart')}><LineChartIcon size={14} className="mr-1" />Chart</Button>
              <Button size="sm" variant={viewMode === 'list' ? 'primary' : 'secondary'} onClick={() => setViewMode('list')}><List size={14} className="mr-1" />List</Button>
            </div>
          </div>

          {groupBy === 'time' && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-text-muted uppercase">Metrics</span>
              <div className="flex gap-2 flex-wrap">
                {METRICS.map(m => (
                  <button key={m.key} onClick={() => toggleMetric(m.key)} className={`px-2 py-1 rounded-md text-xs font-medium transition-all ${selectedMetrics.includes(m.key) ? 'bg-primary text-white' : 'bg-bg-hover text-text-secondary'}`}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      {viewMode === 'chart' ? (
        <Card title={`Usage by ${groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}`} extra={<Button size="sm" variant="secondary" onClick={loadData} isLoading={loading}>Refresh</Button>}>
          {aggregatedData.length === 0 ? (
            <div className="h-96 flex items-center justify-center text-text-secondary">No data available</div>
          ) : chartType === 'pie' ? (
            renderPieChart(aggregatedData, selectedMetrics[0] || 'requests')
          ) : (
            renderTimeSeriesChart(aggregatedData, chartType, selectedMetrics)
          )}
        </Card>
      ) : (
        <Card title="Raw Request Log" extra={<span className="text-xs text-text-secondary">{records.length} requests</span>}>
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-bg-card">
                <tr className="text-left border-b border-border-glass text-text-secondary">
                  {['Time', 'Provider', 'Model', 'Status', 'Tokens', 'Cost', 'Duration', 'TTFT', 'TPS'].map(h => <th key={h} className="py-2 pr-3">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {records.slice(0, 100).map((r, i) => (
                  <tr key={i} className="border-b border-border-glass/50">
                    <td className="py-2 pr-3 text-xs">{new Date(r.date).toLocaleTimeString()}</td>
                    <td className="py-2 pr-3">{r.provider || 'unknown'}</td>
                    <td className="py-2 pr-3 text-xs">{r.incomingModelAlias || r.selectedModelName || 'unknown'}</td>
                    <td className="py-2 pr-3"><span className={`text-xs ${r.responseStatus === 'success' ? 'text-green-500' : 'text-red-500'}`}>{r.responseStatus}</span></td>
                    <td className="py-2 pr-3">{formatTokens((r.tokensInput || 0) + (r.tokensOutput || 0))}</td>
                    <td className="py-2 pr-3">{formatCost(r.costTotal || 0, 4)}</td>
                    <td className="py-2 pr-3">{formatMs(r.durationMs || 0)}</td>
                    <td className="py-2 pr-3">{formatMs(r.ttftMs || 0)}</td>
                    <td className="py-2 pr-3">{formatNumber(r.tokensPerSec || 0, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {groupBy !== 'time' && aggregatedData.length > 0 && (
        <Card className="mt-6" title="Detailed Breakdown">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-border-glass text-text-secondary">
                  <th className="py-3 pr-4">{groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}</th>
                  {['Requests', 'Errors', 'Success %', 'Tokens', 'Cost', 'Avg Duration', 'Avg TTFT', 'Avg TPS'].map(h => <th key={h} className="py-3 pr-4">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {aggregatedData.map((row, i) => (
                  <tr key={i} className="border-b border-border-glass/50">
                    <td className="py-3 pr-4 font-medium">{row.name}</td>
                    <td className="py-3 pr-4">{formatNumber(row.requests, 0)}</td>
                    <td className="py-3 pr-4 text-red-500">{formatNumber(row.errors, 0)}</td>
                    <td className="py-3 pr-4 text-green-500">{row.successRate.toFixed(1)}%</td>
                    <td className="py-3 pr-4">{formatTokens(row.tokens)}</td>
                    <td className="py-3 pr-4">{formatCost(row.cost, 6)}</td>
                    <td className="py-3 pr-4">{formatMs(row.duration)}</td>
                    <td className="py-3 pr-4">{formatMs(row.ttft)}</td>
                    <td className="py-3 pr-4">{formatNumber(row.tps, 1)}</td>
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
