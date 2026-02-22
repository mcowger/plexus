import { UsageData } from '../lib/api';
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

const KWH_PER_SLICE = 0.01;
const SLICES_PER_LOAF = 20;
const SLICE_LAYOUT_THRESHOLD = 18;
const TOAST_COLUMNS = 6;

const formatSlices = (slices: number): string => {
  if (slices < 1) return slices.toFixed(2);
  if (slices < 10) return slices.toFixed(1);
  return Math.round(slices).toLocaleString();
};

const formatEnergy = (kwh: number): string => {
  const wh = kwh * 1000;
  if (wh >= 1) return `${wh.toFixed(2)} Wh`;
  const mwh = wh * 1000;
  if (mwh >= 1) return `${mwh.toFixed(2)} mWh`;
  return `${(mwh * 1000).toFixed(2)} µWh`;
};

const getQuartileImage = (fraction: number, images: Record<string, string>) => {
  if (fraction >= 0.75) return images.full;
  if (fraction >= 0.5) return images.seventyFive;
  if (fraction >= 0.25) return images.half;
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
  const totalKwh = data.reduce((sum, point) => sum + (point.kwhUsed || 0), 0);
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

  return (
    <div className="space-y-3">
      <div className="text-sm text-text-secondary">
        {slicesEquivalent} slices equivalent ({formatEnergy(totalKwh)})
      </div>

      {units.length === 0 && <div className="text-sm text-text-secondary">No usage yet.</div>}

      {!useLoaves && units.length > 0 && (
        <div
          className="grid gap-2"
          style={{
            gridTemplateColumns: `repeat(${TOAST_COLUMNS}, minmax(0, 1fr))`,
            justifyItems: 'start',
            alignItems: 'center',
          }}
        >
          {units.map((fraction, index) => (
            <img
              key={`toast-${index}`}
              src={getQuartileImage(fraction, toastImages)}
              alt="Toast slice"
              style={{ width: 48, height: 48, objectFit: 'contain' }}
            />
          ))}
        </div>
      )}

      {useLoaves && units.length > 0 && (
        <div className="flex flex-col gap-3">
          {units.map((fraction, index) => (
            <img
              key={`loaf-${index}`}
              src={getQuartileImage(fraction, loafImages)}
              alt="Loaf equivalent"
              style={{ width: 180, height: 'auto', objectFit: 'contain' }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
