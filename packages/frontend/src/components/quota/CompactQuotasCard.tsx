import React from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { toTitleCase } from '../../lib/format';
import type { QuotaCheckerInfo } from '../../types/quota';
import {
  Bot,
  MessageSquare,
  Zap,
  Terminal,
  Cpu,
  Shield,
  Github,
  AlertTriangle,
} from 'lucide-react';

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

// Get display name for each checker category
const getTypeDisplayName = (category: string): string => {
  const names: Record<string, string> = {
    'codex': 'Codex',
    'claude': 'Claude',
    'zai': 'Zai',
    'synthetic': 'Synthetic',
    'nanogpt': 'NanoGPT',
    'naga': 'Naga',
    'copilot': 'Copilot',
  };
  return names[category] || toTitleCase(category);
};

// Format checker display name as "Type: Name" (e.g., "Codex: Alt2" or "Copilot")
const formatCheckerDisplayName = (quota: QuotaCheckerInfo): string => {
  const category = getCheckerCategory(quota);
  const checkerId = quota.checkerId;
  const typeName = getTypeDisplayName(category);
  
  // Clean up the checker ID - remove type prefix and normalize
  let displayPart = checkerId;
  
  // Remove common type prefixes
  const prefixes = ['openai-', 'claude-', 'github-', 'copilot-', 'synthetic-', 'zai-', 'nano-', 'naga-'];
  for (const prefix of prefixes) {
    if (displayPart.toLowerCase().startsWith(prefix)) {
      displayPart = displayPart.slice(prefix.length);
      break;
    }
  }
  
  // Shorten "github copilot" to just "copilot" or remove if redundant
  displayPart = displayPart.replace(/github\s+/gi, '').trim();
  
  // If the display part is the same as the type or empty, just return the type
  if (!displayPart || displayPart.toLowerCase() === typeName.toLowerCase()) {
    return typeName;
  }
  
  // Return "Type: Name" format
  return `${typeName}: ${toTitleCase(displayPart)}`;
};

// Get icon for each checker category
const getCheckerIcon = (category: string) => {
  const iconClass = "w-3.5 h-3.5 text-text-muted flex-shrink-0";
  switch (category) {
    case 'codex':
      return <Bot className={iconClass} />;
    case 'claude':
      return <MessageSquare className={iconClass} />;
    case 'zai':
      return <Zap className={iconClass} />;
    case 'synthetic':
      return <Terminal className={iconClass} />;
    case 'nanogpt':
      return <Cpu className={iconClass} />;
    case 'naga':
      return <Shield className={iconClass} />;
    case 'copilot':
      return <Github className={iconClass} />;
    default:
      return <Bot className={iconClass} />;
  }
};

// Define which windows to show for each checker type
const getTrackedWindowsForChecker = (category: string, windows: any[]): string[] => {
  const availableTypes = new Set(windows.map(w => w.windowType));

  switch (category) {
    case 'synthetic':
      return ['five_hour', 'toolcalls'].filter(t => availableTypes.has(t));
    case 'claude':
    case 'codex':
      return ['five_hour', 'weekly'].filter(t => availableTypes.has(t));
    case 'zai':
      return ['five_hour', 'monthly'].filter(t => availableTypes.has(t));
    case 'nanogpt':
      return ['daily', 'monthly'].filter(t => availableTypes.has(t));
    case 'naga':
      return Array.from(availableTypes)
        .filter(t => t !== 'subscription')
        .sort((a, b) => (WINDOW_PRIORITY[a] || 99) - (WINDOW_PRIORITY[b] || 99));
    case 'copilot':
      return ['monthly'].filter(t => availableTypes.has(t));
    default:
      return Array.from(availableTypes)
        .filter(t => t !== 'subscription')
        .sort((a, b) => (WINDOW_PRIORITY[a] || 99) - (WINDOW_PRIORITY[b] || 99))
        .slice(0, 2);
  }
};

// Mini progress bar component
const MiniProgressBar: React.FC<{ percent: number; className?: string }> = ({ percent, className }) => {
  const clampedPercent = Math.max(0, Math.min(100, percent));

  // Determine color based on utilization
  const getBarColor = () => {
    if (clampedPercent >= 90) return 'bg-gradient-to-r from-danger to-danger/80';
    if (clampedPercent >= 70) return 'bg-gradient-to-r from-warning to-warning/80';
    return 'bg-gradient-to-r from-success to-success/80';
  };

  return (
    <div
      className={clsx(
        'bg-bg-subtle rounded-full overflow-hidden border border-border/30 h-2',
        className
      )}
    >
      <div
        className={clsx(
          'h-full rounded-full transition-all duration-500 ease-out',
          getBarColor()
        )}
        style={{ width: `${clampedPercent}%` }}
      />
    </div>
  );
};

// Format window label (very compact)
const formatWindowLabel = (windowType: string): string => {
  const labels: Record<string, string> = {
    'toolcalls': 't',
    'search': 's',
    'weekly': 'w',
    'monthly': 'm',
  };
  return labels[windowType] || '';
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
      className="px-2 py-1 space-y-1 cursor-pointer hover:bg-bg-hover transition-colors"
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
        const displayName = formatCheckerDisplayName(quota);
        const windows = result.windows || [];
        const category = getCheckerCategory(quota);
        const icon = getCheckerIcon(category);

        if (!result.success) {
          return (
            <div key={quota.checkerId} className="flex items-center gap-2 min-w-0 py-0.5">
              {icon}
              <span className="text-[11px] text-text-secondary truncate flex-1">{displayName}</span>
              <AlertTriangle className="w-3 h-3 text-danger flex-shrink-0" />
            </div>
          );
        }

        const trackedWindowTypes = getTrackedWindowsForChecker(category, windows);
        const trackedWindows = trackedWindowTypes
          .map(type => windows.find((w: any) => w.windowType === type))
          .filter(Boolean);

        const primaryWindow = trackedWindows[0];
        if (!primaryWindow) {
          return (
            <div key={quota.checkerId} className="flex items-center gap-2 min-w-0 py-0.5">
              {icon}
              <span className="text-[11px] text-text-secondary truncate flex-1">{displayName}</span>
              <span className="text-[11px] text-text-muted flex-shrink-0">—</span>
            </div>
          );
        }

        const primaryPct = Math.round(primaryWindow.utilizationPercent || 0);
        const secondaryWindows = trackedWindows.slice(1);

        // All providers: name on row 1, bar(s) on row 2
        return (
          <div key={quota.checkerId} className="flex flex-col gap-0.5 py-0.5">
            {/* Row 1: Icon + Name */}
            <div className="flex items-center gap-2 min-w-0">
              {icon}
              <span className="text-[11px] text-text-secondary truncate flex-1 min-w-0">{displayName}</span>
            </div>
            {/* Row 2: Bar(s) side by side (70/30 split if multiple) */}
            <div className="flex items-center gap-1 pl-5">
              {/* Primary bar (full width if single, 70% if multiple) */}
              <div className={clsx(
                "flex items-center gap-1 min-w-0",
                secondaryWindows.length > 0 ? "flex-[7]" : "flex-1"
              )}>
                <MiniProgressBar percent={primaryPct} className="w-full flex-shrink" />
                <span className="text-[10px] font-medium text-text-secondary tabular-nums w-6 text-right flex-shrink-0">
                  {primaryPct}%
                </span>
              </div>
              {/* Secondary bar (30%) - only if exists */}
              {secondaryWindows[0] && (
                <div className="flex items-center gap-0.5 flex-[3] min-w-0">
                  <MiniProgressBar percent={Math.round(secondaryWindows[0].utilizationPercent || 0)} className="w-full flex-shrink" />
                  <span className="text-[10px] text-text-muted w-2 flex-shrink-0 text-center">
                    {formatWindowLabel(secondaryWindows[0].windowType)}
                  </span>
                  <span className="text-[10px] text-text-muted tabular-nums w-6 text-right flex-shrink-0">
                    {Math.round(secondaryWindows[0].utilizationPercent || 0)}%
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
