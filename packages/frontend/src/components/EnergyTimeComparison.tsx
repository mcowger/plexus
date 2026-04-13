import { useState } from 'react';
import { formatDuration } from '../lib/format';
import { AlertTriangle } from 'lucide-react';

interface ComparisonOption {
  id: string;
  label: string;
  shortLabel: string;
  kwhPerHour: number;
  sourceUrl?: string;
  sourceName?: string;
}

const COMPARISONS: ComparisonOption[] = [
  {
    id: 'netflix',
    label: 'Netflix streaming',
    shortLabel: 'Netflix',
    kwhPerHour: 0.077,
    sourceUrl:
      'https://www.iea.org/commentaries/the-carbon-footprint-of-streaming-video-fact-checking-the-headlines',
    sourceName: 'IEA',
  },
  {
    id: 'tv',
    label: '55" LCD/LED TV',
    shortLabel: '55" TV',
    kwhPerHour: 0.1,
    sourceUrl: 'https://www.energysage.com/electricity/house-watts/how-many-watts-does-a-tv-use/',
    sourceName: 'EnnnergySage.com',
  },
  {
    id: 'oven',
    label: 'Electric oven (350°F)',
    shortLabel: 'Oven',
    kwhPerHour: 3.0,
    sourceUrl:
      'https://paylesspower.com/blog/electric-ovens-what-you-need-to-know-about-energy-consumption-and-costs',
    sourceName: 'PayLessPower.com',
  },
];

interface EnergyTimeComparisonProps {
  /** Pre-computed total kWh used across all requests (from backend summary). */
  totalKwh?: number;
  /** Pre-computed total processing duration in ms across all requests (from backend summary). */
  totalDurationMs?: number;
}

/**
 * Compares AI energy consumption to common household activities.
 * Shows how efficiently AI used energy compared to the selected comparison.
 */
export function EnergyTimeComparison({
  totalKwh = 0,
  totalDurationMs = 0,
}: EnergyTimeComparisonProps) {
  const [selectedComparison, setSelectedComparison] = useState<ComparisonOption>(COMPARISONS[0]);

  const totalProcessingMs = totalDurationMs;

  const totalProcessingSeconds = Math.round(totalProcessingMs / 1000);
  const comparisonSecondsEquivalent = (totalKwh / selectedComparison.kwhPerHour) * 3600;

  // Power in watts - kWh/hr directly converts to watts (kW * 1000 = W)
  const comparisonWatts = selectedComparison.kwhPerHour * 1000;
  const aiWatts =
    totalProcessingSeconds > 0 ? (totalKwh / (totalProcessingSeconds / 3600)) * 1000 : 0;

  // AI efficiency ratio: Comparison time / AI time
  // > 1 = Comparison takes LONGER = AI used energy faster = AI LESS efficient
  // < 1 = Comparison takes LESS time = AI took longer = AI MORE efficient
  const efficiencyRatio =
    totalProcessingSeconds > 0 ? comparisonSecondsEquivalent / totalProcessingSeconds : 0;

  // For bar: when AI is more efficient (ratio < 1), bar is smaller (ratio * 100 %)
  // When AI is less efficient (ratio > 1), bar is full (100%)
  const barPercent = efficiencyRatio < 1 ? Math.min(efficiencyRatio * 100, 100) : 100;

  const isAiMoreEfficient = efficiencyRatio < 1;
  const isAiLessEfficient = efficiencyRatio >= 1;

  // For energy per second bars
  const maxWatts = Math.max(comparisonWatts, aiWatts) || 1;
  const comparisonWattsPercent = (comparisonWatts / maxWatts) * 100;
  const aiWattsPercent = (aiWatts / maxWatts) * 100;

  if (totalKwh === 0 && totalProcessingSeconds === 0) {
    return (
      <div className="h-full flex items-center justify-center text-text-secondary text-sm">
        No energy data available
      </div>
    );
  }

  const comparisonDisplay = formatDuration(comparisonSecondsEquivalent);
  const processingDisplay = formatDuration(totalProcessingSeconds);

  // Dynamic wording based on comparison type
  const getComparisonVerb = () => {
    switch (selectedComparison.id) {
      case 'netflix':
        return 'watch';
      case 'tv':
        return 'watch';
      case 'oven':
        return 'cook with';
      default:
        return 'use';
    }
  };

  const getComparisonNoun = () => {
    switch (selectedComparison.id) {
      case 'netflix':
        return 'Netflix';
      case 'tv':
        return 'TV';
      case 'oven':
        return 'the oven';
      default:
        return selectedComparison.shortLabel;
    }
  };

  return (
    <div className="space-y-4">
      {/* Comparison Tabs */}
      <div className="border-b border-border-glass">
        <div className="flex gap-0">
          {COMPARISONS.map((comparison) => {
            const isActive = comparison.id === selectedComparison.id;
            return (
              <button
                key={comparison.id}
                onClick={() => setSelectedComparison(comparison)}
                className={[
                  'flex items-center gap-2 px-3 py-2 text-[12px] font-medium transition-all border-b-2 -mb-px',
                  isActive
                    ? 'border-accent text-text'
                    : 'border-transparent text-text-muted hover:text-text hover:border-border-glass',
                ].join(' ')}
              >
                {comparison.shortLabel}
              </button>
            );
          })}
        </div>
      </div>

      {/* AI Efficiency Comparison */}
      <div className="space-y-3">
        <div
          className="
flex items-center gap-2"
        >
          <div className="text-sm font-semibold text-text-primary">
            AI Efficiency vs {selectedComparison.shortLabel}
          </div>
          {isAiMoreEfficient && (
            <span className="text-xs px-2 py-0.5 bg-success/20 text-success rounded-full font-medium">
              {(1 / efficiencyRatio).toFixed(1)}× more efficient
            </span>
          )}
          {isAiLessEfficient && (
            <span className="text-xs px-2 py-0.5 bg-danger/20 text-danger rounded-full font-medium">
              {efficiencyRatio.toFixed(1)}× less efficient
            </span>
          )}
        </div>

        {/* Main bar - Comparison equivalent, sized by AI efficiency */}
        <div className="space-y-2">
          <div className="h-3 bg-bg-hover rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isAiMoreEfficient ? 'bg-success' : isAiLessEfficient ? 'bg-danger' : 'bg-info'
              }`}
              style={{ width: `${barPercent}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="font-medium text-text-secondary">
                {selectedComparison.shortLabel} time for same energy:
              </span>
              <span className="font-semibold text-text-primary">{comparisonDisplay}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-text-tertiary">AI used that energy in:</span>
              <span
                className={`font-semibold ${
                  isAiLessEfficient ? 'text-danger' : 'text-text-primary'
                }`}
              >
                {processingDisplay}
              </span>
              {isAiLessEfficient && <AlertTriangle size={14} className="text-danger" />}
            </div>
          </div>
        </div>

        {/* Explanation for bar interpretation */}
        {isAiMoreEfficient ? (
          <p className="text-xs text-text-tertiary">
            Smaller bar = AI more efficient. You'd have to {getComparisonVerb()}{' '}
            {getComparisonNoun()} for {comparisonDisplay} to use the same energy your AI used in
            just {processingDisplay}.
          </p>
        ) : isAiLessEfficient ? (
          <p className="text-xs text-danger">
            AI used energy faster than {selectedComparison.label}. {selectedComparison.shortLabel}{' '}
            would take {comparisonDisplay} to use the same energy your AI burned through in only{' '}
            {processingDisplay}.
          </p>
        ) : null}
      </div>

      {/* Power Usage Rate Comparison */}
      <div className="space-y-2 pt-2 border-t border-border">
        <div className="text-xs font-medium text-text-secondary">Power Usage Rate</div>
        <div className="space-y-2">
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-text-secondary">{selectedComparison.label}</span>
              <span className="font-semibold text-info">{comparisonWatts.toFixed(1)} W</span>
            </div>
            <div className="h-2 bg-bg-hover rounded-full overflow-hidden">
              <div
                className="h-full bg-info rounded-full"
                style={{ width: `${comparisonWattsPercent}%` }}
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-text-secondary">AI compute</span>
              <span className="font-semibold text-primary">
                {aiWatts > 0 ? `${aiWatts.toFixed(1)} W` : 'N/A'}
              </span>
            </div>
            <div className="h-2 bg-bg-hover rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full"
                style={{ width: `${aiWattsPercent}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Source footnote */}
      {selectedComparison.sourceUrl && (
        <div className="pt-2">
          <a
            href={selectedComparison.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-text-tertiary hover:text-text-secondary transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
            {selectedComparison.label} energy: {selectedComparison.sourceName}
          </a>
        </div>
      )}
    </div>
  );
}
