/**
 * @file ModelPulseModal.tsx
 *
 * Full-height expanded list of top models with request count and success rate.
 */

import React from 'react';
import { formatNumber } from '../../../lib/format';

export interface ModelPulseModalProps {
  modelPulseRows: { label: string; requests: number; successRate: number }[];
}

export const ModelPulseModal: React.FC<ModelPulseModalProps> = ({ modelPulseRows }) => {
  return (
    <div className="h-[60vh]">
      {modelPulseRows.length === 0 ? (
        <div className="h-full flex items-center justify-center text-text-secondary">
          No model traffic in the selected live window.
        </div>
      ) : (
        <div className="space-y-3">
          {modelPulseRows.map((row) => (
            <div
              key={row.label}
              className="rounded-md border border-border-glass bg-bg-glass px-4 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-base text-text font-medium">{row.label}</span>
                <span className="text-sm text-text-secondary">
                  {formatNumber(row.requests, 0)} requests
                </span>
              </div>
              <div className="mt-1 text-sm text-text-secondary">
                Success: {row.successRate.toFixed(1)}%
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
