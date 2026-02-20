import React from 'react';
import { useNavigate } from 'react-router-dom';
import { toTitleCase } from '../../lib/format';
import type { QuotaCheckerInfo } from '../../types/quota';

interface CompactQuotasCardProps {
  rateLimitQuotas: QuotaCheckerInfo[];
  getQuotaResult: (quota: QuotaCheckerInfo) => any;
}

// Window type priority for display order (lower = shown first)
const WINDOW_PRIORITY: Record<string, number> = {
  'five_hour': 1,
  'daily': 2,
  'toolcalls': 3,
  'search': 4,
  'weekly': 5,
  'monthly': 6,
};

// Get the checker category from checkerId or checkerType
const getCheckerCategory = (quota: QuotaCheckerInfo): string => {
  const id = (quota.checkerType || quota.checkerId).toLowerCase();
  if (id.includes('synthetic')) return 'synthetic';
  if (id.includes('claude-code') || id.includes('claude')) return 'claude';
  if (id.includes('openai-codex') || id.includes('codex')) return 'codex';
  if (id.includes('zai')) return 'zai';
  if (id.includes('nanogpt') || id.includes('nano')) return 'nanogpt';
  if (id.includes('naga')) return 'naga';
  if (id.includes('copilot')) return 'copilot';
  return 'default';
};

// Define which windows to show for each checker type
// Returns array of windowType strings in display order
const getTrackedWindowsForChecker = (category: string, windows: any[]): string[] => {
  const availableTypes = new Set(windows.map(w => w.windowType));

  switch (category) {
    case 'synthetic':
      // Synthetic: 5h limit, tool calls (search hidden - too crowded)
      return ['five_hour', 'toolcalls'].filter(t => availableTypes.has(t));

    case 'claude':
    case 'codex':
      // Claude Code & OpenAI Codex: 5h + weekly
      return ['five_hour', 'weekly'].filter(t => availableTypes.has(t));

    case 'zai':
      // ZAI: 5h tokens + monthly MCP
      return ['five_hour', 'monthly'].filter(t => availableTypes.has(t));

    case 'nanogpt':
      // NanoGPT: daily + monthly
      return ['daily', 'monthly'].filter(t => availableTypes.has(t));

    case 'naga':
      // Naga: Show all available windows sorted by priority
      return Array.from(availableTypes)
        .filter(t => t !== 'subscription') // Exclude balance-style windows
        .sort((a, b) => (WINDOW_PRIORITY[a] || 99) - (WINDOW_PRIORITY[b] || 99));

    case 'copilot':
      // Copilot: monthly only
      return ['monthly'].filter(t => availableTypes.has(t));

    default:
      // Default: Show up to 2 most important windows by priority
      return Array.from(availableTypes)
        .filter(t => t !== 'subscription')
        .sort((a, b) => (WINDOW_PRIORITY[a] || 99) - (WINDOW_PRIORITY[b] || 99))
        .slice(0, 2);
  }
};

// Format window type for display (abbreviated)
const formatWindowLabel = (windowType: string): string => {
  const labels: Record<string, string> = {
    'five_hour': '', // Primary - no label
    'daily': '',     // Primary - no label  
    'toolcalls': 'TC',
    'search': 'S',
    'weekly': '1w',
    'monthly': '1m',
  };
  return labels[windowType] || windowType.slice(0, 2).toUpperCase();
};

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
        const displayName = toTitleCase(quota.checkerId);
        const windows = result.windows || [];

        const category = getCheckerCategory(quota);
        const trackedWindowTypes = getTrackedWindowsForChecker(category, windows);

        // Get windows in priority order
        const trackedWindows = trackedWindowTypes
          .map(type => windows.find((w: any) => w.windowType === type))
          .filter(Boolean);

        // Format: "Primary%" or "Primary% / Label: Secondary%"
        const primaryWindow = trackedWindows[0];
        const secondaryWindows = trackedWindows.slice(1);

        if (!primaryWindow) {
          return (
            <div key={quota.checkerId} className="flex items-center justify-between min-w-0">
              <span className="text-xs text-text-secondary truncate">{displayName}:</span>
              {!result.success ? (
                <span className="text-xs text-danger flex-shrink-0 ml-2">Error</span>
              ) : (
                <span className="text-xs text-text-muted flex-shrink-0">—</span>
              )}
            </div>
          );
        }

        const primaryPct = Math.round(primaryWindow.utilizationPercent || 0);

        // Build display string
        let displayValue: string;
        if (secondaryWindows.length === 0) {
          displayValue = `${primaryPct}%`;
        } else if (secondaryWindows.length === 1) {
          const sec = secondaryWindows[0];
          const secPct = Math.round(sec.utilizationPercent || 0);
          const secLabel = formatWindowLabel(sec.windowType);
          displayValue = secLabel ? `${primaryPct}% / ${secLabel}:${secPct}%` : `${primaryPct}% / ${secPct}%`;
        } else {
          // Multiple secondaries - show all with labels
          const secondaryStr = secondaryWindows.map(w => {
            const pct = Math.round(w.utilizationPercent || 0);
            const label = formatWindowLabel(w.windowType);
            return label ? `${label}:${pct}%` : `${pct}%`;
          }).join(' / ');
          displayValue = `${primaryPct}% / ${secondaryStr}`;
        }

        return (
          <div key={quota.checkerId} className="flex items-center justify-between min-w-0">
            <span className="text-xs text-text-secondary truncate">
              {displayName}:
            </span>
            <span className="text-xs font-semibold text-text-secondary tabular-nums flex-shrink-0 ml-2">
              {displayValue}
            </span>
          </div>
        );
      })}
    </div>
  );
};
