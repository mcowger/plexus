import { Card } from '../../components/ui/Card';
import { formatCostIn, formatMs, formatNumber, formatTokens } from '../../lib/format';
import type { AggregatedPoint, CostDisplay, GroupBy } from './types';

interface DetailedUsageBreakdownProps {
  aggregatedData: AggregatedPoint[];
  groupBy: GroupBy;
  currency: CostDisplay;
}

export const DetailedUsageBreakdown = ({
  aggregatedData,
  groupBy,
  currency,
}: DetailedUsageBreakdownProps) => {
  if (groupBy === 'time' || aggregatedData.length === 0) return null;

  return (
    <Card className="mt-6" title="Detailed Breakdown">
      <div className="space-y-3 md:hidden">
        {aggregatedData.map((row, index) => (
          <article key={index} className="rounded-md border border-border-glass bg-bg-subtle p-3">
            <div className="truncate font-heading text-sm font-semibold text-text">{row.name}</div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded border border-border-glass bg-bg-glass px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wider text-text-muted">Requests</div>
                <div className="font-medium text-text">{formatNumber(row.requests, 0)}</div>
              </div>
              <div className="rounded border border-border-glass bg-bg-glass px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wider text-text-muted">Success</div>
                <div className="font-medium text-green-500">{row.successRate.toFixed(1)}%</div>
              </div>
              <div className="rounded border border-border-glass bg-bg-glass px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wider text-text-muted">Tokens</div>
                <div className="font-medium text-text">{formatTokens(row.tokens)}</div>
              </div>
              <div className="rounded border border-border-glass bg-bg-glass px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wider text-text-muted">Cost</div>
                <div className="font-medium text-text">
                  {formatCostIn(row.cost, {
                    currency: currency.currency,
                    rate: currency.rate,
                    symbol: currency.symbol,
                    decimals: 6,
                  })}
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-border-glass text-text-secondary">
              <th className="py-3 pr-4">{groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}</th>
              {[
                'Requests',
                'Errors',
                'Success %',
                'Tokens',
                'Cost',
                'Avg Duration',
                'Avg TTFT',
                'Avg TPS',
              ].map((header) => (
                <th key={header} className="py-3 pr-4">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {aggregatedData.map((row, index) => (
              <tr key={index} className="border-b border-border-glass/50">
                <td className="py-3 pr-4 font-medium">{row.name}</td>
                <td className="py-3 pr-4">{formatNumber(row.requests, 0)}</td>
                <td className="py-3 pr-4 text-red-500">{formatNumber(row.errors, 0)}</td>
                <td className="py-3 pr-4 text-green-500">{row.successRate.toFixed(1)}%</td>
                <td className="py-3 pr-4">{formatTokens(row.tokens)}</td>
                <td className="py-3 pr-4">
                  {formatCostIn(row.cost, {
                    currency: currency.currency,
                    rate: currency.rate,
                    symbol: currency.symbol,
                    decimals: 6,
                  })}
                </td>
                <td className="py-3 pr-4">{formatMs(row.duration)}</td>
                <td className="py-3 pr-4">{formatMs(row.ttft)}</td>
                <td className="py-3 pr-4">{formatNumber(row.tps, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
};
