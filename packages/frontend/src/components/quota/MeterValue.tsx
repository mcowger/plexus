import React from 'react';
import { formatCostIn, formatPointsFull, type FormatCostInOptions } from '../../lib/format';
import { useCurrency } from '../../lib/CurrencyContext';

type MeterCurrencyOptions = Pick<FormatCostInOptions, 'currency' | 'rate' | 'symbol'>;

const DEFAULT_CURRENCY: MeterCurrencyOptions = {
  currency: 'USD',
  rate: 1,
  symbol: '$',
};

interface MeterValueProps {
  value: number;
  unit: string;
  compact?: boolean;
}

export function formatMeterValue(
  value: number,
  unit: string,
  compact = false,
  currency: MeterCurrencyOptions = DEFAULT_CURRENCY
): string {
  switch (unit) {
    case 'usd':
      return formatCostIn(value, { ...currency, decimals: 4 });
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

export const MeterValue: React.FC<MeterValueProps> = ({ value, unit, compact }) => {
  const currency = useCurrency();

  return (
    <span>
      {formatMeterValue(value, unit, compact, {
        currency: currency.currency,
        rate: currency.rate,
        symbol: currency.symbol,
      })}
    </span>
  );
};
