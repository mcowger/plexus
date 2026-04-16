import { useState } from 'react';
import { KWH_PER_SLICE, formatDuration, formatEnergy, formatSlices } from '../lib/format';
import { Tv, Flame, Play, Gamepad2, Lightbulb } from 'lucide-react';
import toastFull from '../assets/toast/toast-full.png';
import toast75 from '../assets/toast/toast-75.png';
import toast50 from '../assets/toast/toast-50.png';
import toast25 from '../assets/toast/toast-25.png';
import loafFull from '../assets/toast/loaf-full.png';
import loaf75 from '../assets/toast/loaf-75.png';
import loaf50 from '../assets/toast/loaf-50.png';
import loaf25 from '../assets/toast/loaf-25.png';

interface ComparisonOption {
  id: string;
  label: string;
  shortLabel: string;
  kwhPerHour: number;
  icon: React.ReactNode;
  verb: string;
  noun: string;
  sourceUrl?: string;
  sourceName?: string;
}

const COMPARISONS: ComparisonOption[] = [
  {
    id: 'led-bulb',
    label: 'LED light bulb',
    shortLabel: 'LED Bulb',
    kwhPerHour: 0.01,
    icon: <Lightbulb size={28} className="text-yellow-400" />,
    verb: 'run',
    noun: 'an LED bulb',
    sourceUrl:
      'https://www.energysage.com/electricity/house-watts/how-many-watts-does-a-light-bulb-use/',
    sourceName: 'EnergySage.com',
  },
  {
    id: 'netflix',
    label: 'Netflix streaming',
    shortLabel: 'Netflix',
    kwhPerHour: 0.077,
    icon: <Play size={28} className="text-red-400" />,
    verb: 'watch',
    noun: 'Netflix',
    sourceUrl:
      'https://www.iea.org/commentaries/the-carbon-footprint-of-streaming-video-fact-checking-the-headlines',
    sourceName: 'IEA',
  },
  {
    id: 'tv',
    label: '55" LCD/LED TV',
    shortLabel: '55" TV',
    kwhPerHour: 0.1,
    icon: <Tv size={28} className="text-blue-400" />,
    verb: 'watch',
    noun: 'TV',
    sourceUrl: 'https://www.energysage.com/electricity/house-watts/how-many-watts-does-a-tv-use/',
    sourceName: 'EnergySage.com',
  },
  {
    id: 'ps5',
    label: 'PlayStation 5 gaming',
    shortLabel: 'PS5',
    kwhPerHour: 0.2,
    icon: <Gamepad2 size={28} className="text-indigo-400" />,
    verb: 'play',
    noun: 'PS5',
    sourceUrl: 'https://www.playstation.com/en-no/legal/ecodesign/',
    sourceName: 'Sony (ECODESIGN)',
  },
  {
    id: 'oven',
    label: 'Electric oven (350°F)',
    shortLabel: 'Oven',
    kwhPerHour: 3.0,
    icon: <Flame size={28} className="text-orange-400" />,
    verb: 'cook with',
    noun: 'the oven',
    sourceUrl:
      'https://paylesspower.com/blog/electric-ovens-what-you-need-to-know-about-energy-consumption-and-costs',
    sourceName: 'PayLessPower.com',
  },
];

const SLICES_PER_LOAF = 20;
const SLICE_LAYOUT_THRESHOLD = 30;
const MAX_LOAVES_TO_RENDER = 8;

interface QuartileImages {
  full: string;
  seventyFive: string;
  half: string;
  quarter: string;
}

const getQuartileImage = (fraction: number, images: QuartileImages) => {
  if (fraction > 0.75) return images.full;
  if (fraction > 0.5) return images.seventyFive;
  if (fraction > 0.25) return images.half;
  return images.quarter;
};

const buildUnits = (value: number): number[] => {
  if (value <= 0) return [];

  const fullUnits = Math.floor(value);
  const remainder = value - fullUnits;
  const units = Array.from({ length: fullUnits }, () => 1);
  if (remainder > 0) {
    units.push(remainder);
  }
  return units;
};

interface TotalEnergyComparisonProps {
  /** Pre-computed total kWh used across all requests (from backend summary). */
  totalKwh?: number;
}

export function TotalEnergyComparison({ totalKwh = 0 }: TotalEnergyComparisonProps) {
  const [activeTab, setActiveTab] = useState<'slices' | string>('slices');

  const totalSlices = totalKwh / KWH_PER_SLICE;
  const useLoaves = totalSlices > SLICE_LAYOUT_THRESHOLD;

  const toastImages = {
    full: toastFull,
    seventyFive: toast75,
    half: toast50,
    quarter: toast25,
  };
  const loafImages = {
    full: loafFull,
    seventyFive: loaf75,
    half: loaf50,
    quarter: loaf25,
  };

  const slicesEquivalent = formatSlices(totalSlices);
  const units = buildUnits(useLoaves ? totalSlices / SLICES_PER_LOAF : totalSlices);
  const displayedUnits = useLoaves ? units.slice(0, MAX_LOAVES_TO_RENDER) : units;
  const hasOverflowLoaves = useLoaves && units.length > MAX_LOAVES_TO_RENDER;

  const selectedComparison = COMPARISONS.find((c) => c.id === activeTab);

  const renderSlicesView = () => (
    <div className="space-y-4 flex flex-col items-center justify-center py-2">
      <div className="text-center space-y-1">
        <div className="text-xs text-text-secondary">With this energy, you could toast</div>
        <div className="text-2xl font-bold text-text-primary">
          {slicesEquivalent} slice{totalSlices !== 1 ? 's' : ''} of bread
        </div>
      </div>

      {displayedUnits.length === 0 && (
        <div className="text-sm text-text-secondary text-center">No usage yet.</div>
      )}

      {!useLoaves && displayedUnits.length > 0 && (
        <div className="grid grid-cols-6 gap-2 justify-items-center items-center w-fit mx-auto">
          {displayedUnits.map((fraction, index) => (
            <img
              key={`toast-${index}`}
              src={getQuartileImage(fraction, toastImages)}
              alt=""
              className="w-12 h-12 object-contain"
            />
          ))}
        </div>
      )}

      {useLoaves && displayedUnits.length > 0 && (
        <div className="space-y-3">
          <div className="grid [grid-template-columns:repeat(2,minmax(0,1fr))] gap-3 justify-items-center items-center w-fit mx-auto">
            {displayedUnits.map((fraction, index) => (
              <img
                key={`loaf-${index}`}
                src={getQuartileImage(fraction, loafImages)}
                alt=""
                className="w-[150px] h-auto object-contain"
              />
            ))}
          </div>
          {hasOverflowLoaves && (
            <div className="text-sm text-text-secondary text-center">You are a bad person.</div>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 text-xs text-text-tertiary">
        <span>Toaster uses ~800 W</span>
        <span className="text-border-glass">|</span>
        <span>{formatEnergy(totalKwh)} total</span>
      </div>
    </div>
  );

  const renderComparisonView = (comparison: ComparisonOption) => {
    const comparisonSeconds = (totalKwh / comparison.kwhPerHour) * 3600;
    const comparisonDisplay = formatDuration(comparisonSeconds);
    const watts = comparison.kwhPerHour * 1000;

    return (
      <div className="space-y-4 flex flex-col items-center justify-center py-2">
        <div className="text-center space-y-1">
          <div className="text-xs text-text-secondary">
            With this energy, you could {comparison.verb} {comparison.noun} for
          </div>
          <div className="text-2xl font-bold text-text-primary">{comparisonDisplay}</div>
        </div>

        <div className="flex items-center justify-center">{comparison.icon}</div>

        <div className="flex items-center gap-3 text-xs text-text-tertiary">
          <span>
            {comparison.label} uses {watts.toFixed(0)} W
          </span>
          <span className="text-border-glass">|</span>
          <span>{formatEnergy(totalKwh)} total</span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Tab Bar */}
      <div className="border-b border-border-glass">
        <div className="flex gap-0">
          <button
            onClick={() => setActiveTab('slices')}
            className={[
              'flex items-center gap-2 px-3 py-2 text-[12px] font-medium transition-all border-b-2 -mb-px',
              activeTab === 'slices'
                ? 'border-accent text-text'
                : 'border-transparent text-text-muted hover:text-text hover:border-border-glass',
            ].join(' ')}
          >
            Slices
          </button>
          {COMPARISONS.map((comparison) => {
            const isActive = activeTab === comparison.id;
            return (
              <button
                key={comparison.id}
                onClick={() => setActiveTab(comparison.id)}
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

      {/* Tab Content */}
      {activeTab === 'slices' && renderSlicesView()}
      {selectedComparison && renderComparisonView(selectedComparison)}

      {/* Source footnote */}
      {selectedComparison?.sourceUrl && (
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
