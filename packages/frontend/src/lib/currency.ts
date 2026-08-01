export const CURRENCY_RATES_STORAGE_KEY = 'plexus.currencyRates';
export const DISPLAY_CURRENCY_STORAGE_KEY = 'plexus.displayCurrency';
export const CURRENCY_RATE_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
export const DEFAULT_CURRENCY = 'USD';
export const CURRENCY_RATES_URL = 'https://api.frankfurter.dev/v1/latest?base=USD';

export type Currency = {
  code: string;
  symbol: string;
  label: string;
};

export const SUPPORTED_CURRENCIES = [
  { code: 'USD', symbol: '$', label: 'US Dollar' },
  { code: 'EUR', symbol: '€', label: 'Euro' },
  { code: 'GBP', symbol: '£', label: 'British Pound' },
  { code: 'JPY', symbol: '¥', label: 'Japanese Yen' },
  { code: 'AUD', symbol: 'A$', label: 'Australian Dollar' },
  { code: 'CAD', symbol: 'C$', label: 'Canadian Dollar' },
  { code: 'CHF', symbol: 'CHF', label: 'Swiss Franc' },
  { code: 'CNY', symbol: '¥', label: 'Chinese Yuan' },
  { code: 'HKD', symbol: 'HK$', label: 'Hong Kong Dollar' },
  { code: 'NZD', symbol: 'NZ$', label: 'New Zealand Dollar' },
  { code: 'SEK', symbol: 'kr', label: 'Swedish Krona' },
  { code: 'KRW', symbol: '₩', label: 'South Korean Won' },
  { code: 'SGD', symbol: 'S$', label: 'Singapore Dollar' },
  { code: 'NOK', symbol: 'kr', label: 'Norwegian Krone' },
  { code: 'MXN', symbol: 'MX$', label: 'Mexican Peso' },
  { code: 'INR', symbol: '₹', label: 'Indian Rupee' },
  { code: 'BRL', symbol: 'R$', label: 'Brazilian Real' },
  { code: 'ZAR', symbol: 'R', label: 'South African Rand' },
  { code: 'PLN', symbol: 'zł', label: 'Polish Zloty' },
  { code: 'DKK', symbol: 'kr', label: 'Danish Krone' },
  { code: 'CZK', symbol: 'Kč', label: 'Czech Koruna' },
  { code: 'HUF', symbol: 'Ft', label: 'Hungarian Forint' },
  { code: 'ILS', symbol: '₪', label: 'Israeli New Shekel' },
  { code: 'PHP', symbol: '₱', label: 'Philippine Peso' },
  { code: 'MYR', symbol: 'RM', label: 'Malaysian Ringgit' },
  { code: 'THB', symbol: '฿', label: 'Thai Baht' },
  { code: 'IDR', symbol: 'Rp', label: 'Indonesian Rupiah' },
  { code: 'TRY', symbol: '₺', label: 'Turkish Lira' },
  { code: 'ISK', symbol: 'kr', label: 'Icelandic Krona' },
  { code: 'RON', symbol: 'lei', label: 'Romanian Leu' },
  { code: 'BGN', symbol: 'лв', label: 'Bulgarian Lev' },
] as const satisfies readonly Currency[];

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]['code'];

export type CurrencyRates = {
  base: 'USD';
  date: string;
  rates: Record<string, number>;
};

export type CurrencyRateCache = {
  date: string;
  fetchedAt: number;
  rates: Record<string, number>;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function getStorage(): Storage | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function normalizeRates(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;

  const rates: Record<string, number> = {};
  for (const [code, rate] of Object.entries(value)) {
    if (typeof rate === 'number' && Number.isFinite(rate)) {
      rates[code] = rate;
    }
  }

  if (Object.keys(rates).length === 0) return null;
  rates[DEFAULT_CURRENCY] = 1;
  return rates;
}

function toCurrencyRates(cache: CurrencyRateCache): CurrencyRates {
  return {
    base: DEFAULT_CURRENCY,
    date: cache.date,
    rates: cache.rates,
  };
}

function writeCachedRates(cache: CurrencyRateCache): void {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(CURRENCY_RATES_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Storage can be unavailable or full; the in-memory response remains usable.
  }
}

export function getCachedRates(): CurrencyRateCache | null {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(CURRENCY_RATES_STORAGE_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      typeof parsed.date !== 'string' ||
      typeof parsed.fetchedAt !== 'number' ||
      !Number.isFinite(parsed.fetchedAt)
    ) {
      return null;
    }

    const rates = normalizeRates(parsed.rates);
    if (!rates) return null;

    return { date: parsed.date, fetchedAt: parsed.fetchedAt, rates };
  } catch {
    return null;
  }
}

export function isCurrencyRateCacheFresh(
  cache: CurrencyRateCache,
  now: number = Date.now()
): boolean {
  return now - cache.fetchedAt <= CURRENCY_RATE_CACHE_MAX_AGE_MS;
}

export async function fetchRates(): Promise<CurrencyRates | null> {
  const cached = getCachedRates();
  if (cached && isCurrencyRateCacheFresh(cached)) {
    return toCurrencyRates(cached);
  }

  try {
    const response = await fetch(CURRENCY_RATES_URL);
    if (!response.ok) throw new Error(`Currency rate request failed: ${response.status}`);

    const data: unknown = await response.json();
    if (!isRecord(data) || typeof data.date !== 'string') {
      throw new Error('Currency rate response was invalid');
    }

    const rates = normalizeRates(data.rates);
    if (!rates) throw new Error('Currency rate response was invalid');

    const result: CurrencyRates = {
      base: DEFAULT_CURRENCY,
      date: data.date,
      rates,
    };
    writeCachedRates({ date: result.date, fetchedAt: Date.now(), rates: result.rates });
    return result;
  } catch {
    return cached ? toCurrencyRates(cached) : null;
  }
}

export function getCurrency(code: string): Currency {
  return SUPPORTED_CURRENCIES.find((currency) => currency.code === code) ?? SUPPORTED_CURRENCIES[0];
}

export function getSelectedCurrency(): CurrencyCode {
  const storage = getStorage();
  if (storage) {
    try {
      const stored = storage.getItem(DISPLAY_CURRENCY_STORAGE_KEY);
      if (stored && SUPPORTED_CURRENCIES.some((currency) => currency.code === stored)) {
        return stored as CurrencyCode;
      }
    } catch {
      // Use the default when storage is unavailable.
    }
  }

  return DEFAULT_CURRENCY;
}

export function setSelectedCurrency(currency: CurrencyCode): void {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, currency);
  } catch {
    // Storage can be unavailable or full; the in-memory selection remains usable.
  }
}
