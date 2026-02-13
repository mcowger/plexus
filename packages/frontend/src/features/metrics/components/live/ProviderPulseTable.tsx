import React from 'react';
import type { LiveProviderSnapshot } from '../../../../lib/api';
import { formatNumber, formatTokens, formatCost, formatMs, formatTPS } from '../../../../lib/format';

interface ProviderPerformanceInfo {
  avgTtftMs: number;
  avgTokensPerSec: number;
}

interface ProviderPulseTableProps {
  providers: LiveProviderSnapshot[];
  providerPerformance: Map<string, ProviderPerformanceInfo>;
  maxRows?: number;
}

export const ProviderPulseTable: React.FC<ProviderPulseTableProps> = ({
  providers,
  providerPerformance,
  maxRows = 8
}) => {
  const displayProviders = providers.slice(0, maxRows);

  if (providers.length === 0) {
    return (
      <div className="py-8 text-sm text-text-secondary text-center">
        No provider traffic in the selected live window.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left text-text-secondary border-b border-border-glass">
            <th className="py-2 pr-2">Provider</th>
            <th className="py-2 pr-2">Req</th>
            <th className="py-2 pr-2">Success</th>
            <th className="py-2 pr-2">Tokens</th>
            <th className="py-2 pr-2">Cost</th>
            <th className="py-2 pr-2">Avg Latency</th>
            <th className="py-2 pr-2">Perf</th>
          </tr>
        </thead>
        <tbody>
          {displayProviders.map((provider) => {
            const perf = providerPerformance.get(provider.provider);
            return (
              <tr key={provider.provider} className="border-b border-border-glass/60">
                <td className="py-2 pr-2 text-text font-medium">{provider.provider}</td>
                <td className="py-2 pr-2 text-text-secondary">{formatNumber(provider.requests, 0)}</td>
                <td className="py-2 pr-2 text-text-secondary">{(provider.successRate * 100).toFixed(1)}%</td>
                <td className="py-2 pr-2 text-text-secondary">{formatTokens(provider.totalTokens)}</td>
                <td className="py-2 pr-2 text-text-secondary">{formatCost(provider.totalCost, 6)}</td>
                <td className="py-2 pr-2 text-text-secondary">{formatMs(provider.avgDurationMs)}</td>
                <td className="py-2 pr-2 text-text-secondary">
                  {perf
                    ? `${formatTPS(perf.avgTokensPerSec)} tok/s · ${formatMs(perf.avgTtftMs)}`
                    : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
