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
import type { QuotaCheckerInfo, QuotaSnapshot } from '../../types/quota';
import { Button } from '../ui/Button';

type TimeRange = '1h' | '3h' | '6h' | '12h' | '24h' | '1w' | '4w';

interface QuotaHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  quota: QuotaCheckerInfo | null;
  displayName: string;
}



const TIME_RANGE_CONFIG: Record<TimeRange, { label: string; days: number; interval: string }> = {
  '1h': { label: '1 Hour', days: 1 / 24, interval: 'hour' },
  '3h': { label: '3 Hours', days: 3 / 24, interval: 'hour' },
  '6h': { label: '6 Hours', days: 6 / 24, interval: 'hour' },
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

  // Colors for different window types
  const WINDOW_COLORS: Record<string, string> = {
    'five_hour': '#3b82f6',    // blue
    'toolcalls': '#06b6d4',    // cyan
    'search': '#8b5cf6',       // violet
    'daily': '#10b981',        // emerald
    'weekly': '#a855f7',       // purple
    'monthly': '#f59e0b',      // amber
    'subscription': '#ec4899', // pink
    'custom': '#6b7280',       // gray
  };

  // Process history data for the chart - group by window type
  const { chartData, windowTypes } = useMemo(() => {
    if (!history.length) return { chartData: [], windowTypes: [] as string[] };

    const timeRange: TimeRange = selectedRange;

    // Filter to only successful snapshots with valid utilization data
    const validSnapshots = history.filter((snapshot: QuotaSnapshot) => 
      snapshot.success && 
      snapshot.utilizationPercent !== null && 
      snapshot.utilizationPercent !== undefined
    );

    // Group by window type
    const snapshotsByWindow = new Map<string, QuotaSnapshot[]>();
    for (const snapshot of validSnapshots) {
      const windowType = snapshot.windowType || 'custom';
      const existing = snapshotsByWindow.get(windowType) || [];
      existing.push(snapshot);
      snapshotsByWindow.set(windowType, existing);
    }

    // Get unique timestamps for all data points
    const allTimestamps = new Set<number>();
    for (const snapshot of validSnapshots) {
      allTimestamps.add(new Date(snapshot.checkedAt as string).getTime());
    }
    const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);

    // Build chart data with all window types as separate columns
    const data = sortedTimestamps.map((timestamp) => {
      const date = new Date(timestamp);
      const range = TIME_RANGE_CONFIG[timeRange];

      // Format label based on time range
      let label: string;
      if (range.days <= 1) {
        label = date.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });
      } else {
        label = date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        });
      }

      const point: Record<string, number | string | Date | null> = {
        timestamp,
        date,
        label,
      };

      // Add utilization for each window type at this timestamp
      for (const [windowType, snapshots] of snapshotsByWindow) {
        const snapshot = snapshots.find(s => 
          new Date(s.checkedAt as string).getTime() === timestamp
        );
        if (snapshot) {
          point[windowType] = snapshot.utilizationPercent ?? null;
          // Also store metadata for the first window type (for tooltip)
          if (!point['unit']) {
            point['unit'] = snapshot.unit || 'percentage';
            point['used'] = snapshot.used;
            point['remaining'] = snapshot.remaining;
            point['limit'] = snapshot.limit;
            point['windowType'] = windowType;
          }
        } else {
          point[windowType] = null;
        }
      }

      return point;
    });

    // Sort window types by priority
    const priorityOrder = ['five_hour', 'toolcalls', 'search', 'daily', 'weekly', 'monthly', 'subscription', 'custom'];
    const sortedWindowTypes = Array.from(snapshotsByWindow.keys()).sort((a, b) => {
      const aIdx = priorityOrder.indexOf(a);
      const bIdx = priorityOrder.indexOf(b);
      return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
    });

    return { chartData: data, windowTypes: sortedWindowTypes };
  }, [history, selectedRange]);

  // Calculate statistics across all window types
  const stats = useMemo(() => {
    if (!chartData.length || !windowTypes.length) return null;

    // Collect all utilization values across all window types
    const allValues: number[] = [];
    for (const point of chartData) {
      for (const windowType of windowTypes) {
        const value = point[windowType];
        if (typeof value === 'number') {
          allValues.push(value);
        }
      }
    }

    if (!allValues.length) return null;

    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const avg = allValues.reduce((a, b) => a + b, 0) / allValues.length;

    // Calculate trend (compare first half to second half)
    const midPoint = Math.floor(chartData.length / 2);
    const firstHalf = chartData.slice(0, midPoint);
    const secondHalf = chartData.slice(midPoint);

    const firstAvg = firstHalf.length
      ? firstHalf.reduce((sum, point) => {
          const vals = windowTypes
            .map((wt) => point[wt])
            .filter((v): v is number => typeof v === 'number');
          return vals.length ? sum + vals.reduce((a, b) => a + b, 0) / vals.length : sum;
        }, 0) / firstHalf.length
      : 0;

    const secondAvg = secondHalf.length
      ? secondHalf.reduce((sum, point) => {
          const vals = windowTypes
            .map((wt) => point[wt])
            .filter((v): v is number => typeof v === 'number');
          return vals.length ? sum + vals.reduce((a, b) => a + b, 0) / vals.length : sum;
        }, 0) / secondHalf.length
      : 0;

    const trend = secondAvg - firstAvg;

    return { min, max, avg, trend };
  }, [chartData, windowTypes]);

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
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={chartData}
                    margin={{
                      top: 10,
                      right: 30,
                      bottom: 60,
                      left: 10,
                    }}
                  >
                    <defs>
                      {windowTypes.map((windowType) => (
                        <linearGradient
                          key={windowType}
                          id={`color${windowType}`}
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor={WINDOW_COLORS[windowType] || '#6b7280'}
                            stopOpacity={0.3}
                          />
                          <stop
                            offset="95%"
                            stopColor={WINDOW_COLORS[windowType] || '#6b7280'}
                            stopOpacity={0}
                          />
                        </linearGradient>
                      ))}
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
                      content={({ active, payload, label }: { 
                        active?: boolean; 
                        payload?: ReadonlyArray<{ 
                          dataKey: string; 
                          value: number; 
                          color: string;
                          payload: Record<string, unknown>;
                        }>; 
                        label?: string | number 
                      }) => {
                        if (active && payload && payload.length) {
                          return (
                            <div className="bg-bg-card border border-border rounded-lg p-3 shadow-lg min-w-[180px]">
                              <p className="text-xs text-text-secondary mb-2">{label}</p>
                              <div className="space-y-1">
                                {payload
                                  .filter((p) => p.value !== null && p.value !== undefined)
                                  .map((p) => {
                                    const windowType = p.dataKey;
                                    const displayName = windowType
                                      .replace(/_/g, ' ')
                                      .replace(/\b\w/g, (l) => l.toUpperCase());
                                    return (
                                      <div key={windowType} className="flex items-center gap-2">
                                        <div
                                          className="w-2 h-2 rounded-full"
                                          style={{ backgroundColor: p.color }}
                                        />
                                        <span className="text-xs text-text-secondary flex-1">
                                          {displayName}:
                                        </span>
                                        <span className="text-xs font-medium text-text">
                                          {typeof p.value === 'number' ? `${p.value.toFixed(1)}%` : p.value}
                                        </span>
                                      </div>
                                    );
                                  })}
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
                        position: 'right',
                        dx: -5,
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
                        position: 'right',
                        dx: -5,
                      }}
                    />
                    {windowTypes.map((windowType) => (
                      <Area
                        key={windowType}
                        type="monotone"
                        dataKey={windowType}
                        stroke={WINDOW_COLORS[windowType] || '#6b7280'}
                        strokeWidth={2}
                        fillOpacity={1}
                        fill={`url(#color${windowType})`}
                        name={windowType.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                        connectNulls={false}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
                {/* Legend */}
                <div className="flex flex-wrap justify-center gap-4 mt-4 pt-2">
                  {windowTypes.map((windowType) => (
                    <div key={windowType} className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: WINDOW_COLORS[windowType] || '#6b7280' }}
                      />
                      <span className="text-xs text-text-secondary">
                        {windowType.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
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
