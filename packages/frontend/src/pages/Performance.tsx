import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Gauge, TimerReset, Trash2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts';
import { api, type ProviderPerformanceData } from '../lib/api';
import { formatMs, formatNumber } from '../lib/format';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

const BAR_COLORS = ['#c26134', '#8f7aea', '#c08752', '#332f5d', '#cc6531', '#7e68e0', '#a8774e', '#5c549d'];

type ChartMetric = 'avg_tokens_per_sec' | 'avg_ttft_ms';

const PerformanceBarChart = ({
  data,
  metric,
  reverse = false
}: {
  data: ProviderPerformanceData[];
  metric: ChartMetric;
  reverse?: boolean;
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const chartData = (reverse ? [...data] : data).map(row => ({
    ...row,
    label: row.target_model ? `${row.provider}/${row.target_model}` : row.provider
  }));
  const metricLabel = metric === 'avg_tokens_per_sec' ? 'Avg throughput' : 'Avg TTFT';

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      setSize({
        width: Math.max(0, Math.floor(rect.width)),
        height: Math.max(0, Math.floor(rect.height))
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="h-full w-full min-w-0">
      {chartData.length === 0 ? (
        <div className="h-full w-full min-w-0 flex items-center justify-center text-sm text-text-secondary">
          No performance data for this model yet.
        </div>
      ) : size.width > 10 && size.height > 10 ? (
        <BarChart width={size.width} height={size.height} data={chartData} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" horizontal={false} />
          <XAxis
            type="number"
            stroke="var(--color-text-secondary)"
            tickFormatter={(value) => (metric === 'avg_tokens_per_sec' ? formatNumber(value as number) : formatMs(value as number))}
          />
          <YAxis type="category" dataKey="label" stroke="var(--color-text-secondary)" width={80} />
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgba(8, 13, 28, 0.96)',
              borderColor: 'rgba(148, 163, 184, 0.35)',
              borderRadius: '8px',
              color: '#f8fafc'
            }}
            labelStyle={{ color: '#f8fafc', fontWeight: 600 }}
            itemStyle={{ color: '#f8fafc' }}
            cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }}
            formatter={(value) => {
              const numericValue = Number(value ?? 0);
              return [
                metric === 'avg_tokens_per_sec'
                  ? `${formatNumber(numericValue, 1)} tok/s`
                  : formatMs(numericValue),
                metricLabel
              ];
            }}
            labelFormatter={(label, payload) => {
              const row = payload?.[0]?.payload;
              if (row?.target_model) {
                return row.target_model;
              }
              return label;
            }}
          />
          <Bar dataKey={metric} radius={[0, 6, 6, 0]}>
            {chartData.map((_, index) => (
              <Cell key={`cell-${index}`} fill={BAR_COLORS[index % BAR_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      ) : null}
    </div>
  );
};

export const Performance = () => {
  const [rows, setRows] = useState<ProviderPerformanceData[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);

  const loadPerformance = async () => {
    setLoading(true);
    const data = await api.getProviderPerformance();
    setRows(data);
    setLoading(false);
  };

  const clearPerformance = async () => {
    if (!selectedModel) return;
    if (!confirm(`Are you sure you want to clear all performance data for "${selectedModel}"?`)) return;
    
    setClearing(true);
    const success = await api.clearProviderPerformance(selectedModel);
    if (success) {
      await loadPerformance();
    }
    setClearing(false);
  };

  useEffect(() => {
    loadPerformance();
  }, []);

  const models = useMemo(() => {
    const unique = Array.from(new Set(rows.map((r) => r.model).filter(Boolean)));
    unique.sort((a, b) => a.localeCompare(b));
    return unique;
  }, [rows]);

  useEffect(() => {
    if (!selectedModel && models.length > 0) {
      setSelectedModel(models[0]!);
    }
  }, [models, selectedModel]);

  const selectedRows = useMemo(() => {
    if (!selectedModel) return [];
    return rows.filter((r) => r.model === selectedModel);
  }, [rows, selectedModel]);

  const fastestByTokens = useMemo(
    () => [...selectedRows].sort((a, b) => b.avg_tokens_per_sec - a.avg_tokens_per_sec).slice(0, 8),
    [selectedRows]
  );

  const fastestByTtft = useMemo(
    () => [...selectedRows].sort((a, b) => a.avg_ttft_ms - b.avg_ttft_ms).slice(0, 8),
    [selectedRows]
  );

  const totalSamples = useMemo(
    () => selectedRows.reduce((acc, row) => acc + (row.sample_count || 0), 0),
    [selectedRows]
  );

  return (
    <div className="min-h-screen p-6 transition-all duration-300 bg-gradient-to-br from-bg-deep to-bg-surface">
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-bold text-text m-0 mb-2">Performance</h1>
        <p className="text-[15px] text-text-secondary m-0">
          Compare provider speed for a given model by throughput and time-to-first-token.
        </p>
      </div>

      <Card className="mb-4" title="Filters & Summary">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="bg-bg-glass text-text border border-border-glass rounded-md px-3 py-2 text-sm min-w-[240px]"
          >
            {models.length === 0 ? (
              <option value="">No models available</option>
            ) : (
              models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))
            )}
          </select>

          <Button size="sm" variant="secondary" onClick={loadPerformance} isLoading={loading}>
            Refresh
          </Button>

          <Button
            size="sm"
            variant="danger"
            onClick={clearPerformance}
            isLoading={clearing}
            disabled={!selectedModel || selectedRows.length === 0}
          >
            <Trash2 size={14} className="mr-1" />
            Clear
          </Button>

          <div className="text-sm text-text-secondary">
            Providers: <span className="text-text font-medium">{selectedRows.length}</span>
          </div>
          <div className="text-sm text-text-secondary">
            Samples: <span className="text-text font-medium">{formatNumber(totalSamples, 0)}</span>
          </div>
        </div>
      </Card>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))' }}>
        <Card
          className="min-w-0"
          style={{ minWidth: '350px' }}
          title="Fastest Providers (tok/s)"
          extra={<Gauge size={16} className="text-primary" />}
        >
          <div style={{ height: 280 }}><PerformanceBarChart data={fastestByTokens} metric="avg_tokens_per_sec" reverse /></div>
          <div className="mt-4 space-y-2">
            {fastestByTokens.slice(0, 5).map((row, index) => {
              const label = row.target_model ? `${row.provider}/${row.target_model}` : row.provider;
              return (
                <div key={label} className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">{String(index + 1).padStart(2, '0')}. {label}</span>
                  <span className="text-text font-medium">{formatNumber(row.avg_tokens_per_sec, 1)} tok/s</span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card
          className="min-w-0"
          style={{ minWidth: '350px' }}
          title="Fastest First Token (TTFT)"
          extra={<TimerReset size={16} className="text-primary" />}
        >
          <div style={{ height: 280 }}><PerformanceBarChart data={fastestByTtft} metric="avg_ttft_ms" reverse /></div>
          <div className="mt-4 space-y-2">
            {fastestByTtft.slice(0, 5).map((row, index) => {
              const label = row.target_model ? `${row.provider}/${row.target_model}` : row.provider;
              return (
                <div key={label} className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">{String(index + 1).padStart(2, '0')}. {label}</span>
                  <span className="text-text font-medium">{formatMs(row.avg_ttft_ms)}</span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card
          className="min-w-0"
          style={{ minWidth: '350px' }}
          title="Selected Model"
          extra={<BarChart3 size={16} className="text-primary" />}
        >
          <div className="space-y-3 text-sm">
            <div className="text-text-secondary">Model</div>
            <div className="text-text font-medium break-all">{selectedModel || '—'}</div>

            <div className="pt-2 border-t border-border-glass text-text-secondary">Top throughput provider</div>
            <div className="text-text font-medium">
              {fastestByTokens[0]
                ? `${fastestByTokens[0].target_model ? `${fastestByTokens[0].provider}/${fastestByTokens[0].target_model}` : fastestByTokens[0].provider} · ${formatNumber(fastestByTokens[0].avg_tokens_per_sec, 1)} tok/s`
                : '—'}
            </div>

            <div className="pt-2 border-t border-border-glass text-text-secondary">Lowest TTFT provider</div>
            <div className="text-text font-medium">
              {fastestByTtft[0] ? `${fastestByTtft[0].target_model ? `${fastestByTtft[0].provider}/${fastestByTtft[0].target_model}` : fastestByTtft[0].provider} · ${formatMs(fastestByTtft[0].avg_ttft_ms)}` : '—'}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};
