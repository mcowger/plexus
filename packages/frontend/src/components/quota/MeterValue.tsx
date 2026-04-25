import React from 'react';
import { formatCost, formatPointsFull } from '../../lib/format';

interface MeterValueProps {
  value: number;
  unit: string;
  compact?: boolean;
}

export function formatMeterValue(value: number, unit: string, compact = false): string {
  switch (unit) {
    case 'usd':
      return formatCost(value);
    case 'percentage':
      return `${Math.round(value)}%`;
    case 'points':
      return compact ? `${formatPointsFull(value)}` : `${formatPointsFull(value)} pts`;
    case 'kwh':
      return compact ? `${value.toFixed(3)} kWh` : `${value.toFixed(6)} kWh`;
    case 'flows':
      return `${value.toLocaleString()} flows`;
    case 'requests':
      return compact ? `${value.toLocaleString()}` : `${value.toLocaleString()} req`;
    case 'tokens':
      return compact ? `${value.toLocaleString()}` : `${value.toLocaleString()} tok`;
    default:
      return `${value.toLocaleString()} ${unit}`;
  }
}

export const MeterValue: React.FC<MeterValueProps> = ({ value, unit, compact }) => (
  <span>{formatMeterValue(value, unit, compact)}</span>
);
