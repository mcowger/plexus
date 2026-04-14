import { useState } from 'react';
import { formatDuration } from '../lib/format';
import { AlertTriangle, Info } from 'lucide-react';

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
    sourceName: 'EnergySage.com',
  },
  {
    id: 'ps5',
    label: 'PlayStation 5 gaming',
    shortLabel: 'PS5',
    kwhPerHour: 0.2,
    sourceUrl: 'https://www.playstation.com/en-no/legal/ecodesign/',
    sourceName: 'Sony (ECODESIGN)',
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

/** Google Analytics session timeout documentation — same model we use for active time. */
const ACTIVE_TIME_REF_URL = 'https://support.google.com/analytics/answer/2731565';

interface EnergyTimeComparisonProps {
  /** Pre-computed total kWh used across all requests (from backend summary). */
  totalKwh?: number;
  /** Pre-computed total inference duration in ms across all requests (from backend summary). */
  totalDurationMs?: number;
  /** Session-based active time in ms (gaps > 15 min split sessions). */
  totalActiveMs?: number;
}

/**
 * Compares AI energy consumption to common household activities.
 * Uses "active time" (session-based) as the real time the person was working with AI,
 * rather than raw inference duration.
 */
export function EnergyTimeComparison({
  totalKwh = 0,
  totalDurationMs = 0,
  totalActiveMs = 0,
}: EnergyTimeComparisonProps) {
  const [selectedComparison, setSelectedComparison] = useState<ComparisonOption>(COMPARISONS[0]);

  // Use active time when available, fall back to inference duration
  const aiTimeMs = totalActiveMs || totalDurationMs;
  const aiTimeSeconds = Math.round(aiTimeMs / 1000);
  const comparisonSecondsEquivalent = (totalKwh / selectedComparison.kwhPerHour) * 3600;

  // Power in watts — kWh/hr directly converts to watts (kW * 1000 = W)
  const comparisonWatts = selectedComparison.kwhPerHour * 1000;
  const aiWatts = aiTimeSeconds > 0 ? (totalKwh / (aiTimeSeconds / 3600)) * 1000 : 0;

  // Efficiency ratio: Comparison time / AI active time
  // > 1 = Comparison takes LONGER = AI used energy faster = AI LESS efficient
  // < 1 = Comparison takes LESS time = AI took longer = AI MORE efficient
  const efficiencyRatio = aiTimeSeconds > 0 ? comparisonSecondsEquivalent / aiTimeSeconds : 0;

  // For bar: when AI is more efficient (ratio < 1), bar is smaller (ratio * 100 %)
  // When AI is less efficient (ratio > 1), bar is full (100%)
  const barPercent = efficiencyRatio < 1 ? Math.min(efficiencyRatio * 100, 100) : 100;

  const isAiMoreEfficient = efficiencyRatio < 1;
  const isAiLessEfficient = efficiencyRatio >= 1;

  // For energy per second bars
  const maxWatts = Math.max(comparisonWatts, aiWatts) || 1;
  const comparisonWattsPercent = (comparisonWatts / maxWatts) * 100;
  const aiWattsPercent = (aiWatts / maxWatts) * 100;

  if (totalKwh === 0 && aiTimeSeconds === 0) {
    return (
      <div className="h-full flex items-center justify-center text-text-secondary text-sm">
        No energy data available
      </div>
    );
  }

  const comparisonDisplay = formatDuration(comparisonSecondsEquivalent);
  const activeTimeDisplay = formatDuration(aiTimeSeconds);

  // Dynamic wording based on comparison type
  const getComparisonVerb = () => {
    switch (selectedComparison.id) {
      case 'netflix':
        return 'watch';
      case 'tv':
        return 'watch';
      case 'ps5':
        return 'play';
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
      case 'ps5':
        return 'PS5';
      case 'oven':
        return 'the oven';
      default:
        return selectedComparison.shortLabel;
    }
  };

  return (
    <div className="space-y-4 pb-6">
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
        <div className="flex items-center gap-2">
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

        {/* Main bar — Comparison equivalent, sized by AI efficiency */}
        <div className="space-y-2">
          <div className="h-3 bg-bg-hover rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${isAiMoreEfficient ? 'bg-success' : isAiLessEfficient ? 'bg-danger' : 'bg-info'
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
              <span className="text-text-tertiary">You worked with AI for:</span>
              <span
                className={`font-semibold ${isAiLessEfficient ? 'text-danger' : 'text-text-primary'
                  }`}
              >
                {activeTimeDisplay}
              </span>
              {isAiLessEfficient && <AlertTriangle size={14} className="text-danger" />}
            </div>
          </div>
        </div>

        {/* Explanation for bar interpretation */}
        {isAiMoreEfficient ? (
          <p className="text-xs text-text-tertiary">
            You'd have to {getComparisonVerb()} {getComparisonNoun()} for {comparisonDisplay} to use
            the same energy you consumed during {activeTimeDisplay} of active AI work.
          </p>
        ) : isAiLessEfficient ? (
          <p className="text-xs text-danger">
            AI used energy faster than {selectedComparison.label}. {selectedComparison.shortLabel}{' '}
            would take {comparisonDisplay} to use the same energy your AI burned through in just{' '}
            {activeTimeDisplay} of active work.
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
              <span className="text-text-secondary">AI compute (active rate)</span>
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

      {/* Footnotes */}
      <div className="space-y-1.5 pt-2">
        {/* Source footnote */}
        {selectedComparison.sourceUrl && (
          <a
            href={selectedComparison.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-text-tertiary hover:text-text-secondary transition-colors"
          >
            <Info size={10} />
            {selectedComparison.label} energy: {selectedComparison.sourceName}
          </a>
        )}

        {/* Active time methodology footnote */}
        <a
          href={ACTIVE_TIME_REF_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[10px] text-text-tertiary hover:text-text-secondary transition-colors"
        >
          <Info size={10} />
          "Active time" groups requests into sessions with a 15-min inactivity timeout (same model
          as Google Analytics sessions)
        </a>
      </div>
    </div>
  );
}
