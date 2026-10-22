import { Ban, CheckCircle, Plane, Timer, XCircle } from 'lucide-react';

import { Card } from '../../components/ui/Card';
import type { UsageRecord } from '../../lib/api';
import { formatCostIn, formatMs, formatNumber, formatTokens } from '../../lib/format';
import type { CostDisplay } from './types';

interface DetailedUsageRequestLogProps {
  records: UsageRecord[];
  totalRequests: number;
  currency: CostDisplay;
}

export const DetailedUsageRequestLog = ({
  records,
  totalRequests,
  currency,
}: DetailedUsageRequestLogProps) => (
  <Card
    title="Raw Request Log"
    extra={
      <span className="text-text-secondary text-xs">
        {records.length} shown of {totalRequests} requests
      </span>
    }
  >
    <div className="max-h-125 space-y-3 overflow-y-auto md:hidden">
      {records.slice(0, 100).map((record, index) => (
        <article key={index} className="border-border-glass bg-bg-subtle rounded-md border p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-text text-xs font-medium">
                {new Date(record.date).toLocaleString()}
              </div>
              <div className="text-text-muted mt-1 truncate text-xs">
                {record.provider || 'unknown'} /{' '}
                {record.incomingModelAlias || record.selectedModelName || 'unknown'}
              </div>
            </div>
            <span
              className={`inline-flex shrink-0 items-center gap-1 text-xs font-semibold ${
                record.responseStatus === 'success'
                  ? 'text-green-500'
                  : record.responseStatus === 'pending'
                    ? 'text-warning'
                    : record.responseStatus === 'cancelled'
                      ? 'text-blue-400'
                      : record.responseStatus === 'timeout'
                        ? 'text-orange-400'
                        : 'text-red-500'
              }`}
            >
              {record.responseStatus === 'success' ? (
                <CheckCircle size={11} />
              ) : record.responseStatus === 'pending' ? (
                <Plane size={11} className="animate-pulse" />
              ) : record.responseStatus === 'cancelled' ? (
                <Ban size={11} />
              ) : record.responseStatus === 'timeout' ? (
                <Timer size={11} />
              ) : (
                <XCircle size={11} />
              )}
              {record.responseStatus}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="border-border-glass bg-bg-glass rounded border px-2 py-1.5">
              <div className="text-text-muted text-[10px] tracking-wider uppercase">Tokens</div>
              <div className="text-text font-medium">
                {formatTokens((record.tokensInput || 0) + (record.tokensOutput || 0))}
              </div>
            </div>
            <div className="border-border-glass bg-bg-glass rounded border px-2 py-1.5">
              <div className="text-text-muted text-[10px] tracking-wider uppercase">Cost</div>
              <div className="text-text font-medium">
                {formatCostIn(record.costTotal || 0, {
                  currency: currency.currency,
                  rate: currency.rate,
                  symbol: currency.symbol,
                  decimals: 4,
                })}
              </div>
            </div>
            <div className="border-border-glass bg-bg-glass rounded border px-2 py-1.5">
              <div className="text-text-muted text-[10px] tracking-wider uppercase">Duration</div>
              <div className="text-text font-medium">{formatMs(record.durationMs || 0)}</div>
            </div>
            <div className="border-border-glass bg-bg-glass rounded border px-2 py-1.5">
              <div className="text-text-muted text-[10px] tracking-wider uppercase">TPS</div>
              <div className="text-text font-medium">
                {formatNumber(record.tokensPerSec || 0, 1)}
              </div>
            </div>
          </div>
        </article>
      ))}
    </div>

    <div className="hidden max-h-125 overflow-x-auto overflow-y-auto md:block">
      <table className="w-full text-sm">
        <thead className="bg-bg-card sticky top-0">
          <tr className="border-border-glass text-text-secondary border-b text-left">
            {[
              'Time',
              'Provider',
              'Model',
              'Status',
              'Tokens',
              'Cost',
              'Duration',
              'TTFT',
              'TPS',
            ].map((header) => (
              <th key={header} className="py-2 pr-3">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.slice(0, 100).map((record, index) => (
            <tr key={index} className="border-border-glass/50 border-b">
              <td className="py-2 pr-3 text-xs">{new Date(record.date).toLocaleTimeString()}</td>
              <td className="py-2 pr-3">{record.provider || 'unknown'}</td>
              <td className="py-2 pr-3 text-xs">
                {record.incomingModelAlias || record.selectedModelName || 'unknown'}
              </td>
              <td className="py-2 pr-3">
                <span
                  className={`inline-flex items-center gap-1 text-xs ${
                    record.responseStatus === 'success'
                      ? 'text-green-500'
                      : record.responseStatus === 'pending'
                        ? 'text-warning'
                        : record.responseStatus === 'cancelled'
                          ? 'text-blue-400'
                          : record.responseStatus === 'timeout'
                            ? 'text-orange-400'
                            : 'text-red-500'
                  }`}
                >
                  {record.responseStatus === 'success' ? (
                    <CheckCircle size={11} />
                  ) : record.responseStatus === 'pending' ? (
                    <Plane size={11} className="animate-pulse" />
                  ) : record.responseStatus === 'cancelled' ? (
                    <Ban size={11} />
                  ) : record.responseStatus === 'timeout' ? (
                    <Timer size={11} />
                  ) : (
                    <XCircle size={11} />
                  )}
                  {record.responseStatus}
                </span>
              </td>
              <td className="py-2 pr-3">
                {formatTokens((record.tokensInput || 0) + (record.tokensOutput || 0))}
              </td>
              <td className="py-2 pr-3">
                {formatCostIn(record.costTotal || 0, {
                  currency: currency.currency,
                  rate: currency.rate,
                  symbol: currency.symbol,
                  decimals: 4,
                })}
              </td>
              <td className="py-2 pr-3">{formatMs(record.durationMs || 0)}</td>
              <td className="py-2 pr-3">{formatMs(record.ttftMs || 0)}</td>
              <td className="py-2 pr-3">{formatNumber(record.tokensPerSec || 0, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </Card>
);
