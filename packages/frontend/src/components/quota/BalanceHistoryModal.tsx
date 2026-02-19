import React, { useEffect, useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { clsx } from 'clsx';
import { X, Clock, Calendar, Wallet, TrendingDown } from 'lucide-react';
import { createPortal } from 'react-dom';
import { api } from '../../lib/api';
import { formatCost } from '../../lib/format';
import type { QuotaCheckerInfo, QuotaSnapshot } from '../../types/quota';

type TimeRange = '1h' | '3h' | '6h' | '12h' | '24h' | '1w' | '4w';

interface BalanceHistoryModalProps {
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

export const BalanceHistoryModal: React.FC<BalanceHistoryModalProps> = ({
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

    const fetchHistory = async () => {
      setLoading(true);
      setError(null);
      try {
        const days = TIME_RANGE_CONFIG[selectedRange].days;
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

  // Process history data for the chart - show remaining balance
  const { chartData, hasData } = useMemo(() => {
    if (!history.length) return { chartData: [], hasData: false };

    // Filter to only successful snapshots with valid remaining balance
    const validSnapshots = history.filter((snapshot: QuotaSnapshot) =>
      snapshot.success &&
      snapshot.remaining !== null &&
      snapshot.remaining !== undefined
    );

    if (!validSnapshots.length) return { chartData: [], hasData: false };

    // Build chart data showing balance over time
    const data = validSnapshots.map((snapshot) => {
      const date = new Date(snapshot.checkedAt as string);
      const range = TIME_RANGE_CONFIG[selectedRange];

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

      return {
        timestamp: date.getTime(),
        date,
        label,
        balance: snapshot.remaining as number,
      };
    });

    return { chartData: data, hasData: true };
  }, [history, selectedRange]);

  // Calculate balance statistics
  const stats = useMemo(() => {
    if (!chartData.length) return null;

    const balances = chartData.map(d => d.balance);
    const current = balances[balances.length - 1];
    const min = Math.min(...balances);
    const max = Math.max(...balances);

    // Calculate spending trend (compare first to last)
    const first = balances[0];
    const change = current - first;
    const percentChange = first !== 0 ? (change / first) * 100 : 0;

    return { current, min, max, change, percentChange };
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
            <Wallet size={20} className="text-info" />
            <div>
              <h2 className="font-heading text-lg font-semibold text-text m-0">
                {displayName} Balance
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
                    'px-3 py-1.5 text-xs font-medium rounded-md transition-all',
                    selectedRange === range
                      ? 'bg-primary text-white'
                      : 'text-text-secondary hover:text-text hover:bg-bg-hover'
                  )}
                >
                  {TIME_RANGE_CONFIG[range].label}
                </button>
              ))}
            </div>
          </div>

          {/* Stats */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-bg-subtle rounded-lg p-3 border border-border">
                <div className="flex items-center gap-2 text-text-secondary text-xs mb-1">
                  <Wallet size={12} />
                  <span>Current</span>
                </div>
                <div className="text-lg font-semibold text-info">
                  {formatCost(stats.current)}
                </div>
              </div>
              <div className="bg-bg-subtle rounded-lg p-3 border border-border">
                <div className="flex items-center gap-2 text-text-secondary text-xs mb-1">
                  <TrendingDown size={12} />
                  <span>Change</span>
                </div>
                <div
                  className={clsx(
                    'text-lg font-semibold',
                    stats.change < 0 ? 'text-danger' : 'text-success'
                  )}
                >
                  {stats.change < 0 ? '' : '+'}{formatCost(stats.change)}
                </div>
              </div>
              <div className="bg-bg-subtle rounded-lg p-3 border border-border">
                <div className="flex items-center gap-2 text-text-secondary text-xs mb-1">
                  <Calendar size={12} />
                  <span>High</span>
                </div>
                <div className="text-lg font-semibold text-text">
                  {formatCost(stats.max)}
                </div>
              </div>
              <div className="bg-bg-subtle rounded-lg p-3 border border-border">
                <div className="flex items-center gap-2 text-text-secondary text-xs mb-1">
                  <Calendar size={12} />
                  <span>Low</span>
                </div>
                <div className="text-lg font-semibold text-text">
                  {formatCost(stats.min)}
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
            ) : !hasData ? (
              <div className="flex items-center justify-center h-[300px] text-text-secondary">
                No balance history available for this time range
              </div>
            ) : (
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={chartData}
                    margin={{
                      top: 10,
                      right: 30,
                      bottom: 30,
                      left: 10,
                    }}
                  >
                    <defs>
                      <linearGradient id="balanceGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
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
                      tickFormatter={(value: number) => formatCost(value)}
                      domain={['auto', 'auto']}
                    />
                    <Tooltip
                      content={({ active, payload, label }: {
                        active?: boolean;
                        payload?: ReadonlyArray<{
                          value: number;
                          payload: Record<string, unknown>;
                        }>;
                        label?: string | number
                      }) => {
                        if (active && payload && payload.length) {
                          const balance = payload[0]?.value;
                          return (
                            <div className="bg-bg-card border border-border rounded-lg p-3 shadow-lg min-w-[150px]">
                              <p className="text-xs text-text-secondary mb-1">{label}</p>
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-cyan-400" />
                                <span className="text-xs text-text-secondary">Balance:</span>
                                <span className="text-sm font-semibold text-text">
                                  {formatCost(balance as number)}
                                </span>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="balance"
                      stroke="#06b6d4"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#balanceGradient)"
                      name="Balance"
                      connectNulls={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
