import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_CURRENCY,
  fetchRates,
  getCachedRates,
  getCurrency,
  getSelectedCurrency,
  setSelectedCurrency,
  type CurrencyCode,
  type CurrencyRates,
} from './currency';

export type CurrencyContextValue = {
  currency: CurrencyCode;
  setCurrency: (currency: CurrencyCode) => void;
  rate: number;
  convert: (usd: number) => number;
  symbol: string;
  isLoading: boolean;
  ratesAvailable: boolean;
};

const CurrencyContext = createContext<CurrencyContextValue | undefined>(undefined);

export const CurrencyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currency, setCurrencyState] = useState<CurrencyCode>(getSelectedCurrency);
  const [rates, setRates] = useState<CurrencyRates | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const cached = getCachedRates();

    if (cached) {
      setRates({ base: DEFAULT_CURRENCY, date: cached.date, rates: cached.rates });
    }

    fetchRates()
      .then((loadedRates) => {
        if (cancelled) return;
        setRates(loadedRates);
        setIsLoading(false);
      })
      .catch(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const setCurrency = useCallback((nextCurrency: CurrencyCode) => {
    setCurrencyState(nextCurrency);
    setSelectedCurrency(nextCurrency);
  }, []);

  const activeRate = currency === DEFAULT_CURRENCY ? 1 : (rates?.rates[currency] ?? 1);
  const ratesAvailable =
    rates !== null && (currency === DEFAULT_CURRENCY || currency in rates.rates);
  const symbol = getCurrency(currency).symbol;

  const convert = useCallback((usd: number) => usd * activeRate, [activeRate]);

  const value = useMemo<CurrencyContextValue>(
    () => ({
      currency,
      setCurrency,
      rate: activeRate,
      convert,
      symbol,
      isLoading,
      ratesAvailable,
    }),
    [activeRate, convert, currency, isLoading, ratesAvailable, setCurrency, symbol]
  );

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
};

export function useCurrency(): CurrencyContextValue {
  const context = useContext(CurrencyContext);
  if (context === undefined) {
    throw new Error('useCurrency must be used within a CurrencyProvider');
  }
  return context;
}
