import { UsageData } from '../lib/api';
import { KWH_PER_SLICE, formatEnergy, formatSlices } from '../lib/format';
import toastFull from '../assets/toast/toast-full.png';
import toast75 from '../assets/toast/toast-75.png';
import toast50 from '../assets/toast/toast-50.png';
import toast25 from '../assets/toast/toast-25.png';
import loafFull from '../assets/toast/loaf-full.png';
import loaf75 from '../assets/toast/loaf-75.png';
import loaf50 from '../assets/toast/loaf-50.png';
import loaf25 from '../assets/toast/loaf-25.png';

interface SlicesToastedProps {
  data: UsageData[];
}

const SLICES_PER_LOAF = 20;
const SLICE_LAYOUT_THRESHOLD = 30;
const MAX_LOAVES_TO_RENDER = 8;

const getQuartileImage = (fraction: number, images: Record<string, string>) => {
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

export function SlicesToasted({ data }: SlicesToastedProps) {
  const totalKwh = data.reduce((sum, point) => sum + (point.kwhUsed ?? 0), 0);
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

  return (
    <div className="space-y-3">
      <div className="text-sm text-text-secondary">
        {slicesEquivalent} slices equivalent ({formatEnergy(totalKwh)})
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
    </div>
  );
}
