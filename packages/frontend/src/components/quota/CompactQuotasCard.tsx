import React from 'react';
import { useNavigate } from 'react-router-dom';
import { toTitleCase } from '../../lib/format';
import type { QuotaCheckerInfo } from '../../types/quota';

interface CompactQuotasCardProps {
  rateLimitQuotas: QuotaCheckerInfo[];
  getQuotaResult: (quota: QuotaCheckerInfo) => any;
}

// Non-core usage types to exclude
const EXCLUDED_USAGE_TYPES = ['tools', 'search', 'mcp', 'tool', 'discount'];

export const CompactQuotasCard: React.FC<CompactQuotasCardProps> = ({
  rateLimitQuotas,
  getQuotaResult,
}) => {
  const navigate = useNavigate();

  if (rateLimitQuotas.length === 0) {
    return null;
  }

  const handleClick = () => {
    navigate('/quotas');
  };

  return (
    <div 
      className="px-2 py-1 space-y-0.5 cursor-pointer hover:bg-bg-hover transition-colors"
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      {rateLimitQuotas.map((quota) => {
        const result = getQuotaResult(quota);
        
        // Use the checkerId as the display name (this is the unique provider identifier)
        const displayName = toTitleCase(quota.checkerId);
        const windows = result.windows || [];
        
        // Filter out non-core usage types and sort by window type priority
        const coreWindows = windows.filter((w: any) => {
          const label = (w.windowLabel || '').toLowerCase();
          return !EXCLUDED_USAGE_TYPES.some(excluded => label.includes(excluded));
        });

        // Sort windows: five_hour > daily > weekly > monthly
        const windowPriority: Record<string, number> = {
          'five_hour': 1,
          'daily': 2,
          'weekly': 3,
          'monthly': 4,
        };
        
        coreWindows.sort((a: any, b: any) => {
          const aPriority = windowPriority[a.windowType] || 99;
          const bPriority = windowPriority[b.windowType] || 99;
          return aPriority - bPriority;
        });

        // Format percentages (show up to 2 most important windows)
        const percentages = coreWindows.slice(0, 2).map((w: any) => {
          const pct = Math.round(w.utilizationPercent || 0);
          return `${pct}%`;
        });
        
        const percentageDisplay = percentages.join(' / ');

        return (
          <div key={quota.checkerId} className="flex items-center justify-between min-w-0">
            <span className="text-xs text-text-secondary truncate">
              {displayName}:
            </span>
            {!result.success ? (
              <span className="text-xs text-danger flex-shrink-0 ml-2">Error</span>
            ) : percentages.length > 0 ? (
              <span className="text-xs font-semibold text-text-secondary tabular-nums flex-shrink-0 ml-2">
                {percentageDisplay}
              </span>
            ) : (
              <span className="text-xs text-text-muted flex-shrink-0">—</span>
            )}
          </div>
        );
      })}
    </div>
  );
};
