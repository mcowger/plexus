import { formatDuration } from '../lib/format';

/**
 * Netflix streaming energy consumption: 0.077 kWh per hour
 * Source: user-provided value
 */
const KWH_PER_STREAMING_HOUR = 0.077;

interface EnergyTimeComparisonProps {
  data: Array<{ kwhUsed?: number; ttftMs?: number; durationMs?: number }>;
}

/**
 * Compares AI energy consumption to Netflix streaming.
 * Shows how much Netflix streaming your AI energy could have powered
 * vs actual processing time, plus energy per second comparison.
 */
export function EnergyTimeComparison({ data }: EnergyTimeComparisonProps) {
  let totalKwh = 0;
  let totalProcessingMs = 0;

  for (const point of data) {
    totalKwh += point.kwhUsed ?? 0;
    totalProcessingMs += point.durationMs ?? 0;
  }

  const totalProcessingSeconds = Math.round(totalProcessingMs / 1000);
  const streamingSecondsEquivalent = (totalKwh / KWH_PER_STREAMING_HOUR) * 3600;

  // Power in watts - kWh/hr directly converts to watts (kW * 1000 = W)
  const netflixWatts = KWH_PER_STREAMING_HOUR * 1000; // 0.077 kW * 1000 = 77 W
  const aiWatts =
    totalProcessingSeconds > 0 ? (totalKwh / (totalProcessingSeconds / 3600)) * 1000 : 0;

  // For bar chart - compare total time
  const maxSeconds = Math.max(streamingSecondsEquivalent, totalProcessingSeconds || 1);
  const streamingPercent = (streamingSecondsEquivalent / maxSeconds) * 100;
  const processingPercent = (totalProcessingSeconds / maxSeconds) * 100;

  // For energy per second bars
  const maxWatts = Math.max(netflixWatts, aiWatts) || 1;
  const netflixWattsPercent = (netflixWatts / maxWatts) * 100;
  const aiWattsPercent = (aiWatts / maxWatts) * 100;

  if (totalKwh === 0 && totalProcessingSeconds === 0) {
    return (
      <div className="h-full flex items-center justify-center text-text-secondary text-sm">
        No energy data available
      </div>
    );
  }

  const streamingDisplay = formatDuration(streamingSecondsEquivalent);
  const processingDisplay = formatDuration(totalProcessingSeconds);

  return (
    <div className="space-y-4">
      {/* Total Time Comparison */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-text-secondary">Total Time</div>
        <div className="space-y-2">
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-text-secondary">Netflix (equivalent)</span>
              <span className="font-semibold text-info">{streamingDisplay}</span>
            </div>
            <div className="h-2 bg-bg-hover rounded-full overflow-hidden">
              <div
                className="h-full bg-info rounded-full"
                style={{ width: `${streamingPercent}%` }}
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-text-secondary">AI compute</span>
              <span className="font-semibold text-primary">{processingDisplay}</span>
            </div>
            <div className="h-2 bg-bg-hover rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full"
                style={{ width: `${processingPercent}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Energy Per Second Comparison */}
      <div className="space-y-2 pt-2 border-t border-border">
        <div className="text-xs font-medium text-text-secondary">Energy Per Second</div>
        <div className="space-y-2">
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-text-secondary">Netflix streaming</span>
              <span className="font-semibold text-info">{netflixWatts.toFixed(1)} W</span>
            </div>
            <div className="h-2 bg-bg-hover rounded-full overflow-hidden">
              <div
                className="h-full bg-info rounded-full"
                style={{ width: `${netflixWattsPercent}%` }}
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

      {/* Comparison message */}
      {streamingSecondsEquivalent > 0 && totalProcessingSeconds > 0 && (
        <div className="text-xs text-text-secondary pt-2 border-t border-border">
          {streamingSecondsEquivalent > totalProcessingSeconds ? (
            <>
              Your AI used enough energy to power{' '}
              <span className="font-semibold text-warning">
                {(streamingSecondsEquivalent / totalProcessingSeconds).toFixed(1)}×
              </span>{' '}
              more Netflix streaming than the compute time consumed
            </>
          ) : totalProcessingSeconds > streamingSecondsEquivalent ? (
            <>
              AI compute ran{' '}
              <span className="font-semibold text-primary">
                {(totalProcessingSeconds / streamingSecondsEquivalent).toFixed(1)}×
              </span>{' '}
              longer than the streaming equivalent would last
            </>
          ) : (
            <>Energy equivalent equals processing time</>
          )}
        </div>
      )}

      {/* Source footnote */}
      <div className="pt-2">
        <a
          href="https://www.iea.org/commentaries/the-carbon-footprint-of-streaming-video-fact-checking-the-headlines"
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
          Netflix streaming energy: IEA
        </a>
      </div>
    </div>
  );
}
