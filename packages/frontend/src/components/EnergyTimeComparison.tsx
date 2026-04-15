import { Info, Zap } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

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
    id: 'led-bulb',
    label: 'LED light bulb',
    shortLabel: 'LED Bulb',
    kwhPerHour: 0.01,
    sourceUrl:
      'https://www.energysage.com/electricity/house-watts/how-many-watts-does-a-light-bulb-use/',
    sourceName: 'EnergySage.com',
  },
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
    label: 'LCD/LED TV',
    shortLabel: 'LCD TV',
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

/** Comparison items use info blue; AI compute uses primary amber. */
const COLOR_COMPARISON = '#3B82F6';
const COLOR_AI = '#F59E0B';

interface ChartRow {
  id: string;
  name: string;
  shortName: string;
  watts: number;
  isAi: boolean;
  sourceUrl?: string;
  sourceName?: string;
}

const formatWatts = (w: number): string => {
  if (w >= 1000) return `${(w / 1000).toFixed(1)} kW`;
  if (w >= 1) return `${w.toFixed(w < 10 ? 1 : 0)} W`;
  return `${(w * 1000).toFixed(0)} mW`;
};

interface EnergyTimeComparisonProps {
  /** Pre-computed total kWh used across all requests (from backend summary). */
  totalKwh?: number;
  /** Pre-computed total inference duration in ms across all requests (from backend summary). */
  totalDurationMs?: number;
  /** Session-based active time in ms (gaps > 15 min split sessions). */
  totalActiveMs?: number;
}

/**
 * Compares AI compute power usage rate to common household items
 * as a vertical bar chart on a logarithmic scale.
 */
export function EnergyTimeComparison({
  totalKwh = 0,
  totalDurationMs = 0,
  totalActiveMs = 0,
}: EnergyTimeComparisonProps) {
  // Use active time when available, fall back to inference duration
  const aiTimeMs = totalActiveMs || totalDurationMs;
  const aiTimeSeconds = Math.round(aiTimeMs / 1000);
  const aiWatts = aiTimeSeconds > 0 ? (totalKwh / (aiTimeSeconds / 3600)) * 1000 : 0;

  if (totalKwh === 0 && aiTimeSeconds === 0) {
    return (
      <div className="h-full flex items-center justify-center text-text-secondary text-sm">
        No energy data available
      </div>
    );
  }

  // Build chart rows: comparisons + AI compute, sorted by watts ascending
  const rows: ChartRow[] = [
    ...COMPARISONS.map((c) => ({
      id: c.id,
      name: c.label,
      shortName: c.shortLabel,
      watts: c.kwhPerHour * 1000,
      isAi: false,
      sourceUrl: c.sourceUrl,
      sourceName: c.sourceName,
    })),
  ];

  if (aiWatts > 0) {
    rows.push({
      id: 'ai-compute',
      name: 'AI compute (active)',
      shortName: 'AI Compute',
      watts: aiWatts,
      isAi: true,
    });
  }

  rows.sort((a, b) => a.watts - b.watts);

  // Log-scale domain: all values ≥ 1 W, with headroom above max
  const maxWatts = Math.max(...rows.map((r) => r.watts), 10);
  const logDomain: [number, number] = [1, Math.ceil(maxWatts * 1.5)];

  return (
    <div className="space-y-4 pb-6">
      {/* Vertical bar chart */}
      <div style={{ height: 260, marginTop: '8px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ left: 10, right: 10, top: 0, bottom: 0 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--color-border-glass)"
              vertical={false}
            />
            <XAxis
              dataKey="shortName"
              stroke="var(--color-text-secondary)"
              tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
            />
            <YAxis
              type="number"
              scale="log"
              domain={logDomain}
              stroke="var(--color-text-secondary)"
              tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
              tickFormatter={(v: number) => formatWatts(v)}
              width={55}
            />
            <Tooltip
              formatter={(value) => [formatWatts(Number(value || 0)), 'Power']}
              contentStyle={{
                background: 'var(--color-bg-card)',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
              }}
              itemStyle={{ color: 'var(--color-text)' }}
              labelStyle={{ color: 'var(--color-text-secondary)' }}
            />
            <Bar dataKey="watts" radius={[4, 4, 0, 0]} barSize={28}>
              {rows.map((entry) => (
                <Cell
                  key={entry.id}
                  fill={entry.isAi ? COLOR_AI : COLOR_COMPARISON}
                  stroke={entry.isAi ? COLOR_AI : COLOR_COMPARISON}
                  strokeWidth={0.5}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* AI compute fallback when no active time */}
      {aiWatts === 0 && (
        <div className="flex items-center gap-2 text-xs text-text-tertiary">
          <Zap size={14} className="text-primary" />
          <span>AI compute: N/A (no active time data)</span>
        </div>
      )}

      {/* Scale note */}
      <div className="text-[10px] text-text-tertiary italic">
        Logarithmic scale — bar lengths represent log₁₀(watts)
      </div>

      {/* Source footnotes */}
      <div className="space-y-1.5 pt-1">
        {COMPARISONS.filter((c) => c.sourceUrl).map((c) => (
          <a
            key={c.id}
            href={c.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-text-tertiary hover:text-text-secondary transition-colors mr-3"
          >
            <Info size={10} />
            {c.shortLabel}: {c.sourceName}
          </a>
        ))}
        <a
          href={ACTIVE_TIME_REF_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[10px] text-text-tertiary hover:text-text-secondary transition-colors"
        >
          <Info size={10} />
          &quot;Active time&quot; uses 15-min session timeout (same model as Google Analytics)
        </a>
      </div>
    </div>
  );
}
