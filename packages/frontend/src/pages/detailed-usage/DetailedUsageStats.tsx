import { useMemo } from 'react';
import { Activity, AlertTriangle, Clock, Database, DollarSign, TrendingUp } from 'lucide-react';
import type { UsageSummaryResponse } from '../../lib/api';
import { Skeleton } from '../../components/ui/Skeleton';
import { formatCostIn, formatMs, formatNumber, formatTokens } from '../../lib/format';

interface DetailedUsageStatsProps {
  loading: boolean;
  summaryResponse: UsageSummaryResponse | null;
  currency: string;
  rate: number;
  symbol: string;
}

export const DetailedUsageStats = ({
  loading,
  summaryResponse,
  currency,
  rate,
  symbol,
}: DetailedUsageStatsProps) => {
  const stats = useMemo(() => {
    const summary = summaryResponse?.stats;
    const total = summary?.totalRequests || 0;
    const errors = summary?.totalErrors || 0;
    const tokens = summary?.totalTokens || 0;
    const cost = summary?.totalCost || 0;
    const avgDuration = summary?.avgDurationMs || 0;
    const avgTtft = summary?.avgTtftMs || 0;
    const avgTps = summary?.avgTokensPerSec || 0;
    const successRate = summary?.successRate || 0;

    return [
      { label: 'Requests', value: formatNumber(total, 0), icon: Activity },
      {
        label: 'Errors',
        value: formatNumber(errors, 0),
        icon: AlertTriangle,
        color: errors > 0 ? 'text-red-500' : '',
      },
      { label: 'Tokens', value: formatTokens(tokens), icon: Database },
      {
        label: 'Cost',
        value: formatCostIn(cost, { currency, rate, symbol, decimals: 4 }),
        icon: DollarSign,
      },
      { label: 'Avg Duration', value: formatMs(avgDuration), icon: Clock },
      { label: 'Avg TTFT', value: formatMs(avgTtft), icon: Clock },
      { label: 'Avg TPS', value: formatNumber(avgTps, 1), icon: TrendingUp },
      { label: 'Success Rate', value: `${successRate.toFixed(1)}%`, icon: TrendingUp },
    ];
  }, [currency, rate, summaryResponse, symbol]);

  return (
    <div className="mb-6 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-8">
      {loading && !summaryResponse
        ? Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} height={76} className="w-full" />
          ))
        : stats.map((stat, index) => (
            <div key={index} className="glass-bg rounded-lg p-3 flex flex-col gap-1">
              <div className="flex justify-between items-start">
                <span className="font-body text-xs font-semibold text-text-muted uppercase tracking-wider">
                  {stat.label}
                </span>
                <stat.icon size={16} className={`text-text-secondary ${stat.color || ''}`} />
              </div>
              <div className={`font-heading text-xl font-bold ${stat.color || 'text-text'}`}>
                {stat.value}
              </div>
            </div>
          ))}
    </div>
  );
};
