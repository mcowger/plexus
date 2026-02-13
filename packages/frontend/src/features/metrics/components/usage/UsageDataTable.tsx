import React from 'react';
import { formatNumber, formatTokens, formatCost, formatMs } from '../../../../lib/format';

export interface UsageDataRow {
  name: string;
  requests: number;
  tokens: number;
  cost: number;
  duration: number;
  ttft: number;
}

interface UsageDataTableProps {
  data: UsageDataRow[];
  groupBy: string;
}

export const UsageDataTable: React.FC<UsageDataTableProps> = ({
  data,
  groupBy
}) => {
  if (data.length === 0) {
    return (
      <div className="py-8 text-center text-text-secondary">
        No data available
      </div>
    );
  }

  const groupByLabel = groupBy.charAt(0).toUpperCase() + groupBy.slice(1);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b border-border-glass text-text-secondary">
            <th className="py-3 pr-4">{groupByLabel}</th>
            <th className="py-3 pr-4">Requests</th>
            <th className="py-3 pr-4">Tokens</th>
            <th className="py-3 pr-4">Cost</th>
            <th className="py-3 pr-4">Avg Duration</th>
            <th className="py-3 pr-4">Avg TTFT</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, index) => (
            <tr key={index} className="border-b border-border-glass/50">
              <td className="py-3 pr-4 font-medium">{row.name}</td>
              <td className="py-3 pr-4">{formatNumber(row.requests, 0)}</td>
              <td className="py-3 pr-4">{formatTokens(row.tokens)}</td>
              <td className="py-3 pr-4">{formatCost(row.cost, 6)}</td>
              <td className="py-3 pr-4">{formatMs(row.duration)}</td>
              <td className="py-3 pr-4">{formatMs(row.ttft)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
