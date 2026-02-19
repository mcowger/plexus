import React, { useEffect, useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { clsx } from 'clsx';
import { X, Clock, Calendar, TrendingDown, Activity } from 'lucide-react';
import { createPortal } from 'react-dom';
import { api } from '../../lib/api';
import { formatCost, formatNumber } from '../../lib/format';
import type { QuotaCheckerInfo, QuotaSnapshot } from '../../types/quota';
import { Button } from '../ui/Button';

type TimeRange = '12h' | '24h' | '1w' | '4w';

interface QuotaHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  quota: QuotaCheckerInfo | null;
  displayName: string;
}

interface HistoryDataPoint {
  timestamp: number;
  date: Date;
  label: string;
  used?: number | null;
  remaining?: number | null;
  limit?: number | null;
  utilizationPercent: number;
  unit: string;
}

const TIME_RANGE_CONFIG: Record<TimeRange, { label: string; days: number; interval: string }> = {
  '12h': { label: '12 Hours', days: 0.5, interval: 'hour' },
  '24h': { label: '24 Hours', days: 1, interval: 'hour' },
  '1w': { label: '1 Week', days: 7, interval: 'day' },
  '4w': { label: '4 Weeks', days: 28, interval: 'day' },
};

export const QuotaHistoryModal: React.FC<QuotaHistoryModalProps> = ({
  isOpen,
  onClose,
  quota,
  displayName,
}) => {
  const [selectedRange, setSelectedRange] = useState<TimeRange>('24h');
  const [history, setHistory] = useState<QuotaSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setSelectedRange('24h');
      setHistory([]);
      setError(null);
    }
  }, [isOpen]);

  // Fetch history when range changes
  useEffect(() => {
    if (!isOpen || !quota) return;

    const range: TimeRange = selectedRange;

    const fetchHistory = async () => {
      setLoading(true);
      setError(null);

      try {
        const days = TIME_RANGE_CONFIG[range].days;
        const since = `${days}d`;
        const result = await api.getQuotaHistory(quota.checkerId, undefined, since);

        if (result && result.history) {
          // Sort by checkedAt timestamp
          const sorted = [...result.history].sort((a, b) => {
            const dateA = new Date(a.checkedAt as string).getTime();
            const dateB = new Date(b.checkedAt as string).getTime();
            return dateA - dateB;
          });
          setHistory(sorted);
        } else {
          setHistory([]);
        }
      } catch (e) {
        setError('Failed to load history data');
        console.error('Error fetching quota history:', e);
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [isOpen, quota, selectedRange]);

  // Process history data for the chart
  const chartData: HistoryDataPoint[] = useMemo(() => {
    if (!history.length) return [];

    const timeRange: TimeRange = selectedRange;

    return history.map((snapshot: QuotaSnapshot) => {
      const date = new Date(snapshot.checkedAt as string);
      const range = TIME_RANGE_CONFIG[timeRange];

      // Format label based on time range
      let label: string;
      if (range.days <= 1) {
        // For 12h/24h, show hour:minute
        label = date.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });
      } else {
        // For 1w/4w, show month/day
        label = date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        });
      }

      return {
        timestamp: date.getTime(),
        date,
        label,
        used: snapshot.used,
        remaining: snapshot.remaining,
        limit: snapshot.limit,
        utilizationPercent: snapshot.utilizationPercent ?? 0,
        unit: snapshot.unit || 'percentage',
      };
    });
  }, [history, selectedRange]);

  // Determine the primary metric to display
  const primaryMetric = useMemo(() => {
    if (!chartData.length) return null;

    // Find the most common unit in the data
    const unitCounts = new Map<string, number>();
    for (const point of chartData) {
      unitCounts.set(point.unit, (unitCounts.get(point.unit) || 0) + 1);
    }
    const primaryUnit = Array.from(unitCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 'percentage';

    // Get the latest data point for current values
    const latest = chartData[chartData.length - 1];

    return {
      unit: primaryUnit,
      latest,
      hasUsage: latest.used !== null && latest.used !== undefined,
      hasRemaining: latest.remaining !== null && latest.remaining !== undefined,
      hasLimit: latest.limit !== null && latest.limit !== undefined,
    };
  }, [chartData]);

  // Format tooltip values
  const formatTooltipValue = (value: number, unit: string): string => {
    if (unit === 'dollars') return formatCost(value);
    if (unit === 'percentage') return `${value.toFixed(1)}%`;
    if (unit === 'tokens') return formatNumber(value, 0);
    return formatNumber(value, 0);
  };

  // Calculate statistics
  const stats = useMemo(() => {
    if (!chartData.length) return null;

    const values = chartData.map((d) => d.utilizationPercent);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;

    // Calculate trend (compare first half to second half)
    const midPoint = Math.floor(chartData.length / 2);
    const firstHalf = chartData.slice(0, midPoint);
    const secondHalf = chartData.slice(midPoint);
    const firstAvg = firstHalf.length
      ? firstHalf.reduce((a, b) => a + b.utilizationPercent, 0) / firstHalf.length
      : 0;
    const secondAvg = secondHalf.length
      ? secondHalf.reduce((a, b) => a + b.utilizationPercent, 0) / secondHalf.length
      : 0;
    const trend = secondAvg - firstAvg;

    return { min, max, avg, trend };
  }, [chartData]);

  // Handle escape key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEsc);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen || !quota) return null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center z-[1000] p-5 bg-black/70 backdrop-blur-md animate-[fadeIn_0.2s_ease]"
      onClick={onClose}
    >
      <div
        className="bg-bg-surface border border-border-glass rounded-xl w-[900px] max-w-full max-h-[90vh] overflow-hidden flex flex-col shadow-[0_20px_60px_rgba(0,0,0,0.5)] animate-[slideUp_0.3s_ease]"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-glass bg-bg-card">
          <div className="flex items-center gap-3">
            <Activity size={20} className="text-primary" />
            <div>
              <h2 className="font-heading text-lg font-semibold text-text m-0">
                {displayName} History
              </h2>
              <p className="text-xs text-text-secondary m-0">
                {quota.oauthAccountId && `Account: ${quota.oauthAccountId}`}
              </p>
            </div>
          </div>
          <button
            className="bg-transparent border-0 text-text-muted cursor-pointer hover:text-text p-1 rounded-md hover:bg-bg-hover transition-colors"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* Time Range Selector */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-text-secondary" />
              <span className="text-sm font-medium text-text-secondary">Time Range:</span>
            </div>
            <div className="flex items-center gap-1 bg-bg-subtle rounded-lg p-1">
              {(Object.keys(TIME_RANGE_CONFIG) as TimeRange[]).map((range) => (
                <button
                  key={range}
                  onClick={() => setSelectedRange(range)}
                  className={clsx(
                    'px-3 py-1.5 text-sm font-medium rounded-md transition-all',
                    selectedRange === range
                      ? 'bg-bg-card text-text shadow-sm border border-border'
                      : 'text-text-secondary hover:text-text hover:bg-bg-hover'
                  )}
                >
                  {TIME_RANGE_CONFIG[range].label}
                </button>
              ))}
            </div>
          </div>

          {/* Stats Summary */}
          {stats && (
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-bg-subtle rounded-lg p-3 border border-border">
                <div className="flex items-center gap-2 text-text-secondary text-xs mb-1">
                  <TrendingDown size={12} />
                  <span>Avg Usage</span>
                </div>
                <div className="text-lg font-semibold text-text">
                  {Math.round(stats.avg)}%
                </div>
              </div>
              <div className="bg-bg-subtle rounded-lg p-3 border border-border">
                <div className="flex items-center gap-2 text-text-secondary text-xs mb-1">
                  <Activity size={12} />
                  <span>Peak</span>
                </div>
                <div className="text-lg font-semibold text-text">
                  {Math.round(stats.max)}%
                </div>
              </div>
              <div className="bg-bg-subtle rounded-lg p-3 border border-border">
                <div className="flex items-center gap-2 text-text-secondary text-xs mb-1">
                  <Calendar size={12} />
                  <span>Lowest</span>
                </div>
                <div className="text-lg font-semibold text-text">
                  {Math.round(stats.min)}%
                </div>
              </div>
              <div className="bg-bg-subtle rounded-lg p-3 border border-border">
                <div className="flex items-center gap-2 text-text-secondary text-xs mb-1">
                  <TrendingDown size={12} />
                  <span>Trend</span>
                </div>
                <div
                  className={clsx(
                    'text-lg font-semibold',
                    stats.trend > 0 ? 'text-danger' : 'text-success'
                  )}
                >
                  {stats.trend > 0 ? '+' : ''}
                  {stats.trend.toFixed(1)}%
                </div>
              </div>
            </div>
          )}

          {/* Chart */}
          <div className="bg-bg-card rounded-lg border border-border p-4">
            {loading ? (
              <div className="flex items-center justify-center h-[300px] text-text-secondary">
                <div className="animate-spin mr-2">
                  <Clock size={20} />
                </div>
                Loading history...
              </div>
            ) : error ? (
              <div className="flex items-center justify-center h-[300px] text-danger">
                {error}
              </div>
            ) : chartData.length === 0 ? (
              <div className="flex items-center justify-center h-[300px] text-text-secondary">
                No historical data available for this time range
              </div>
            ) : (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={chartData}
                    margin={{
                      top: 10,
                      right: 20,
                      bottom: 20,
                      left: 10,
                    }}
                  >
                    <defs>
                      <linearGradient id="colorUtilization" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--color-border)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                      axisLine={{ stroke: 'var(--color-border)' }}
                      tickLine={false}
                      interval="preserveStartEnd"
                      minTickGap={30}
                    />
                    <YAxis
                      tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(value: number) => `${Math.round(value)}%`}
                      domain={[0, 100]}
                    />
                    <Tooltip
                      content={({ active, payload, label }: { active?: boolean; payload?: ReadonlyArray<{ payload: HistoryDataPoint }>; label?: string | number }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload as HistoryDataPoint;
                          return (
                            <div className="bg-bg-card border border-border rounded-lg p-3 shadow-lg">
                              <p className="text-xs text-text-secondary mb-2">{label}</p>
                              <div className="space-y-1">
                                <p className="text-sm font-medium text-text">
                                  Utilization: {data.utilizationPercent.toFixed(1)}%
                                </p>
                                {data.used !== null && data.used !== undefined && (
                                  <p className="text-xs text-text-secondary">
                                    Used: {formatTooltipValue(data.used, data.unit)}
                                  </p>
                                )}
                                {data.remaining !== null && data.remaining !== undefined && (
                                  <p className="text-xs text-text-secondary">
                                    Remaining: {formatTooltipValue(data.remaining, data.unit)}
                                  </p>
                                )}
                                {data.limit !== null && data.limit !== undefined && (
                                  <p className="text-xs text-text-secondary">
                                    Limit: {formatTooltipValue(data.limit, data.unit)}
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    {/* Warning line at 70% */}
                    <ReferenceLine
                      y={70}
                      stroke="#f59e0b"
                      strokeDasharray="5 5"
                      label={{
                        value: 'Warning',
                        fill: '#f59e0b',
                        fontSize: 10,
                        position: 'insideRight',
                      }}
                    />
                    {/* Critical line at 90% */}
                    <ReferenceLine
                      y={90}
                      stroke="#ef4444"
                      strokeDasharray="5 5"
                      label={{
                        value: 'Critical',
                        fill: '#ef4444',
                        fontSize: 10,
                        position: 'insideRight',
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="utilizationPercent"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorUtilization)"
                      name="Utilization %"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Current Status Summary */}
          {primaryMetric && (
            <div className="bg-bg-subtle rounded-lg border border-border p-4">
              <h3 className="text-sm font-semibold text-text-secondary mb-3">Current Status</h3>
              <div className="grid grid-cols-3 gap-4">
                {primaryMetric.hasUsage && (
                  <div>
                    <p className="text-xs text-text-secondary mb-1">Used</p>
                    <p className="text-base font-medium text-text">
                      {formatTooltipValue(primaryMetric.latest.used!, primaryMetric.unit)}
                    </p>
                  </div>
                )}
                {primaryMetric.hasRemaining && (
                  <div>
                    <p className="text-xs text-text-secondary mb-1">Remaining</p>
                    <p className="text-base font-medium text-text">
                      {formatTooltipValue(primaryMetric.latest.remaining!, primaryMetric.unit)}
                    </p>
                  </div>
                )}
                {primaryMetric.hasLimit && (
                  <div>
                    <p className="text-xs text-text-secondary mb-1">Limit</p>
                    <p className="text-base font-medium text-text">
                      {formatTooltipValue(primaryMetric.latest.limit!, primaryMetric.unit)}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-text-secondary mb-1">Utilization</p>
                  <p
                    className={clsx(
                      'text-base font-medium',
                      primaryMetric.latest.utilizationPercent >= 90
                        ? 'text-danger'
                        : primaryMetric.latest.utilizationPercent >= 70
                          ? 'text-warning'
                          : 'text-success'
                    )}
                  >
                    {primaryMetric.latest.utilizationPercent.toFixed(1)}%
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-4 border-t border-border-glass bg-bg-card">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
};
