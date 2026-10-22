import { RefreshCw, X } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { api } from '../../lib/api';
import { useCurrency } from '../../lib/CurrencyContext';
import type { Meter, QuotaCheckerInfo } from '../../types/quota';
import { Button } from '../ui/Button';
import { formatMeterValue } from './MeterValue';

type TimeRange = '1h' | '3h' | '6h' | '12h' | '24h' | '1w' | '4w';

const TIME_RANGES: { key: TimeRange; label: string; days: number }[] = [
  { key: '1h', label: '1h', days: 1 / 24 },
  { key: '3h', label: '3h', days: 3 / 24 },
  { key: '6h', label: '6h', days: 6 / 24 },
  { key: '12h', label: '12h', days: 0.5 },
  { key: '24h', label: '24h', days: 1 },
  { key: '1w', label: '1w', days: 7 },
  { key: '4w', label: '4w', days: 28 },
];

interface MeterHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  quota: QuotaCheckerInfo;
  meter: Meter;
  displayName: string;
}

interface HistoryRow {
  checkedAt: string | number;
  remaining?: number | null;
  used?: number | null;
  limit?: number | null;
  utilizationPercent?: number | null;
  success?: boolean;
  meterKey?: string;
}

// Pick the best value to chart: remaining for balances, utilizationPercent for allowances.
function getChartValue(row: HistoryRow, kind: 'balance' | 'allowance'): number | null {
  if (!row.success) return null;
  if (kind === 'balance') {
    return row.remaining ?? null;
  }
  return typeof row.utilizationPercent === 'number' ? row.utilizationPercent : null;
}

function formatTimestamp(ts: string | number, showDate: boolean): string {
  const d = new Date(typeof ts === 'number' ? ts : Number(ts) || String(ts));
  if (showDate) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export const MeterHistoryModal: React.FC<MeterHistoryModalProps> = ({
  isOpen,
  onClose,
  quota,
  meter,
  displayName,
}) => {
  const { currency, rate, symbol } = useCurrency();
  const [range, setRange] = useState<TimeRange>('24h');
  const [rawHistory, setRawHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setRange('24h');
      setRawHistory([]);
      setError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const fetch = async () => {
      setLoading(true);
      setError(null);
      try {
        const days = TIME_RANGES.find((r) => r.key === range)!.days;
        const result = await api.getQuotaHistory(quota.checkerId, meter.key, `${days}d`);
        if (!cancelled && result?.history) {
          const sorted = [...result.history].sort((a: HistoryRow, b: HistoryRow) => {
            const ta =
              typeof a.checkedAt === 'number' ? a.checkedAt : new Date(a.checkedAt).getTime();
            const tb =
              typeof b.checkedAt === 'number' ? b.checkedAt : new Date(b.checkedAt).getTime();
            return ta - tb;
          });
          setRawHistory(sorted);
        }
      } catch {
        if (!cancelled) setError('Failed to load history');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetch();
    return () => {
      cancelled = true;
    };
  }, [isOpen, quota.checkerId, meter.key, range]);

  const showDate = (TIME_RANGES.find((r) => r.key === range)?.days ?? 1) >= 2;

  const chartData = useMemo(() => {
    return rawHistory
      .map((row) => {
        const value = getChartValue(row, meter.kind);
        if (value === null) return null;
        const raw = row.checkedAt;
        const ts = typeof raw === 'number' ? raw : new Date(String(raw)).getTime();
        return {
          ts,
          label: formatTimestamp(ts, showDate),
          value,
          remaining: row.remaining ?? null,
          used: row.used ?? null,
          limit: row.limit ?? null,
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);
  }, [rawHistory, meter.kind, showDate]);

  const stats = useMemo(() => {
    if (!chartData.length) return null;
    const vals = chartData.map((d) => d.value);
    return {
      current: vals[vals.length - 1],
      min: Math.min(...vals),
      max: Math.max(...vals),
    };
  }, [chartData]);

  const isBalance = meter.kind === 'balance';
  const chartColor = isBalance ? '#06b6d4' : '#8b5cf6';
  const yLabel = isBalance ? meter.unit : '%';

  const formatY = (v: number) =>
    isBalance
      ? formatMeterValue(v, meter.unit, true, { currency, rate, symbol })
      : `${Math.round(v)}%`;

  const formatTooltip = (v: number) =>
    isBalance
      ? formatMeterValue(v, meter.unit, false, { currency, rate, symbol })
      : `${v.toFixed(1)}%`;

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="border-border-glass bg-bg-card flex max-h-[92vh] w-full max-w-2xl flex-col rounded-xl border shadow-2xl sm:max-h-[90vh]">
        {/* Header */}
        <div className="border-border-glass flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-5 sm:py-4">
          <div className="min-w-0">
            <h2 className="font-heading text-h2 text-text truncate font-semibold">{meter.label}</h2>
            <p className="text-text-muted mt-0.5 truncate text-xs">
              {displayName}
              {quota.oauthAccountId && ` · ${quota.oauthAccountId}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:bg-bg-hover hover:text-text ml-3 flex-shrink-0 rounded-md p-1.5 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Time-range selector */}
        <div className="border-border-glass flex items-center gap-1 overflow-x-auto border-b px-4 py-3 sm:px-5">
          {TIME_RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                range === r.key
                  ? 'bg-primary/20 text-primary border-primary/40 border'
                  : 'text-text-secondary hover:bg-bg-hover'
              }`}
            >
              {r.label}
            </button>
          ))}
          {loading && <RefreshCw size={14} className="text-text-muted ml-auto animate-spin" />}
        </div>

        {/* Body */}
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 sm:px-5">
          {/* Stats row */}
          {stats && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                { label: 'Current', value: formatTooltip(stats.current) },
                { label: 'Min', value: formatTooltip(stats.min) },
                { label: 'Max', value: formatTooltip(stats.max) },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="border-border-glass bg-bg-subtle rounded-lg border px-3 py-2"
                >
                  <div className="text-text-muted text-[10px] tracking-wider uppercase">
                    {label}
                  </div>
                  <div className="text-text mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Chart */}
          <div className="h-48 w-full sm:h-52">
            {error ? (
              <div className="text-danger flex h-full items-center justify-center text-sm">
                {error}
              </div>
            ) : loading && chartData.length === 0 ? (
              <div className="text-text-secondary flex h-full items-center justify-center gap-2 text-sm">
                <RefreshCw size={16} className="animate-spin" />
                Loading…
              </div>
            ) : chartData.length === 0 ? (
              <div className="text-text-muted flex h-full items-center justify-center text-sm">
                No data for this period
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="mhGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={chartColor} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={chartColor} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tickFormatter={formatY}
                    tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
                    tickLine={false}
                    axisLine={false}
                    width={60}
                    label={
                      yLabel && yLabel !== '%'
                        ? undefined
                        : {
                            value: '%',
                            position: 'insideTopRight',
                            fontSize: 10,
                            fill: 'var(--color-text-muted)',
                          }
                    }
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--color-bg-card)',
                      border: '1px solid var(--color-border-glass)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: 'var(--color-text-secondary)', marginBottom: 2 }}
                    itemStyle={{ color: chartColor }}
                    formatter={(value: unknown) =>
                      [formatTooltip(value as number), meter.label] as [string, string]
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke={chartColor}
                    strokeWidth={2}
                    fill="url(#mhGrad)"
                    dot={false}
                    activeDot={{ r: 4, fill: chartColor }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-border-glass flex justify-end border-t px-4 py-3 sm:px-5">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
};
