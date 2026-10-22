import { Info } from 'lucide-react';

import { SUPPORTED_CURRENCIES } from '../../lib/currency';
import { useCurrency } from '../../lib/CurrencyContext';
import { Card } from '../ui/Card';

export function DisplayPreferencesCard() {
  const { currency, setCurrency, ratesAvailable } = useCurrency();

  return (
    <Card title="Display Preferences">
      <div className="flex flex-col gap-1">
        <label htmlFor="displayCurrency" className="font-body text-text text-[12px] font-medium">
          Display currency
        </label>
        <select
          id="displayCurrency"
          value={currency}
          onChange={(event) => {
            const nextCurrency = SUPPORTED_CURRENCIES.find(
              ({ code }) => code === event.target.value
            );
            if (nextCurrency) setCurrency(nextCurrency.code);
          }}
          className="text-text bg-bg-subtle border-border-glass focus:border-primary h-[27px] w-64 max-w-full rounded-sm border px-2 py-0 font-mono text-[12px] leading-none outline-none"
        >
          {SUPPORTED_CURRENCIES.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label} ({option.code}) — {option.symbol}
            </option>
          ))}
        </select>
        {!ratesAvailable && currency !== 'USD' && (
          <p className="text-text-muted flex items-center gap-1.5 text-[11px]">
            <Info size={13} className="text-warning shrink-0" aria-hidden="true" />
            <span>Live exchange rates are unavailable; amounts fall back to USD.</span>
          </p>
        )}
      </div>
    </Card>
  );
}
