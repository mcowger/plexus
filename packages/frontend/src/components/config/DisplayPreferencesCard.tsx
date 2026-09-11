import { Info } from 'lucide-react';
import { useCurrency } from '../../lib/CurrencyContext';
import { SUPPORTED_CURRENCIES } from '../../lib/currency';
import { Card } from '../ui/Card';

export function DisplayPreferencesCard() {
  const { currency, setCurrency, ratesAvailable } = useCurrency();

  return (
    <Card title="Display Preferences">
      <div className="flex flex-col gap-1">
        <label htmlFor="displayCurrency" className="font-body text-[12px] font-medium text-text">
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
          className="w-64 max-w-full h-[27px] py-0 px-2 font-mono text-[12px] leading-none text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary"
        >
          {SUPPORTED_CURRENCIES.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label} ({option.code}) — {option.symbol}
            </option>
          ))}
        </select>
        {!ratesAvailable && currency !== 'USD' && (
          <p className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <Info size={13} className="text-warning shrink-0" aria-hidden="true" />
            <span>Live exchange rates are unavailable; amounts fall back to USD.</span>
          </p>
        )}
      </div>
    </Card>
  );
}
