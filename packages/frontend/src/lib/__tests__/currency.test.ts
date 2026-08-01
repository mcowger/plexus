import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSpy } from '../../../../backend/test/test-utils';
import {
  CURRENCY_RATE_CACHE_MAX_AGE_MS,
  CURRENCY_RATES_STORAGE_KEY,
  CURRENCY_RATES_URL,
  DEFAULT_CURRENCY,
  DISPLAY_CURRENCY_STORAGE_KEY,
  SUPPORTED_CURRENCIES,
  fetchRates,
  getCachedRates,
  getCurrency,
  getSelectedCurrency,
  isCurrencyRateCacheFresh,
  setSelectedCurrency,
} from '../currency';

function createStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

const storage = createStorage();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('currency helpers', () => {
  it('fetches rates, adds the implicit USD rate, and caches the response', async () => {
    const now = 1_700_000_000_000;
    registerSpy(Date, 'now').mockReturnValue(now);
    const fetchSpy = registerSpy(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ date: '2026-08-01', rates: { EUR: 0.9, GBP: 0.8 } }),
    });

    await expect(fetchRates()).resolves.toEqual({
      base: DEFAULT_CURRENCY,
      date: '2026-08-01',
      rates: { EUR: 0.9, GBP: 0.8, USD: 1 },
    });

    expect(fetchSpy).toHaveBeenCalledWith(CURRENCY_RATES_URL);
    expect(getCachedRates()).toEqual({
      date: '2026-08-01',
      fetchedAt: now,
      rates: { EUR: 0.9, GBP: 0.8, USD: 1 },
    });
  });

  it('returns fresh cached rates without fetching again', async () => {
    const now = 1_700_000_000_000;
    registerSpy(Date, 'now').mockReturnValue(now);
    storage.setItem(
      CURRENCY_RATES_STORAGE_KEY,
      JSON.stringify({
        date: '2026-07-31',
        fetchedAt: now - CURRENCY_RATE_CACHE_MAX_AGE_MS,
        rates: { EUR: 0.9 },
      })
    );
    const fetchSpy = registerSpy(globalThis, 'fetch');

    await expect(fetchRates()).resolves.toEqual({
      base: DEFAULT_CURRENCY,
      date: '2026-07-31',
      rates: { EUR: 0.9, USD: 1 },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('identifies fresh and stale cache entries at the twelve-hour boundary', () => {
    const now = 1_700_000_000_000;
    const cache = {
      date: '2026-07-31',
      fetchedAt: now - CURRENCY_RATE_CACHE_MAX_AGE_MS,
      rates: { EUR: 0.9, USD: 1 },
    };

    expect(isCurrencyRateCacheFresh(cache, now)).toBe(true);
    expect(isCurrencyRateCacheFresh(cache, now + 1)).toBe(false);
  });

  it('normalizes cached rates and ignores non-numeric entries', () => {
    storage.setItem(
      CURRENCY_RATES_STORAGE_KEY,
      JSON.stringify({
        date: '2026-07-31',
        fetchedAt: 1_700_000_000_000,
        rates: { EUR: 0.9, invalid: 'not-a-rate' },
      })
    );

    expect(getCachedRates()).toEqual({
      date: '2026-07-31',
      fetchedAt: 1_700_000_000_000,
      rates: { EUR: 0.9, USD: 1 },
    });
  });

  it('falls back to stale cached rates when fetching fails', async () => {
    const now = 1_700_000_000_000;
    registerSpy(Date, 'now').mockReturnValue(now);
    storage.setItem(
      CURRENCY_RATES_STORAGE_KEY,
      JSON.stringify({
        date: '2026-07-30',
        fetchedAt: now - CURRENCY_RATE_CACHE_MAX_AGE_MS - 1,
        rates: { EUR: 0.9 },
      })
    );
    registerSpy(globalThis, 'fetch').mockRejectedValue(new Error('network unavailable'));

    await expect(fetchRates()).resolves.toEqual({
      base: DEFAULT_CURRENCY,
      date: '2026-07-30',
      rates: { EUR: 0.9, USD: 1 },
    });
  });

  it('returns null when fetching fails and there is no cache', async () => {
    registerSpy(globalThis, 'fetch').mockRejectedValue(new Error('network unavailable'));

    await expect(fetchRates()).resolves.toBeNull();
  });

  it('defaults the selected currency to USD and persists changes', () => {
    expect(getSelectedCurrency()).toBe(DEFAULT_CURRENCY);

    setSelectedCurrency('EUR');

    expect(storage.getItem(DISPLAY_CURRENCY_STORAGE_KEY)).toBe('EUR');
    expect(getSelectedCurrency()).toBe('EUR');
  });

  it('falls back to USD for an unsupported selected currency', () => {
    storage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, 'not-supported');

    expect(getSelectedCurrency()).toBe(DEFAULT_CURRENCY);
  });

  it('looks up supported currencies and falls back to USD', () => {
    expect(getCurrency('EUR')).toEqual({ code: 'EUR', symbol: '€', label: 'Euro' });
    expect(getCurrency('not-supported')).toBe(SUPPORTED_CURRENCIES[0]);
    expect(SUPPORTED_CURRENCIES[0]).toEqual({ code: 'USD', symbol: '$', label: 'US Dollar' });
  });
});
