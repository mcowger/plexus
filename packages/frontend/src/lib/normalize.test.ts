import { describe, expect, test } from 'bun:test';

import { toBoolean, toEpochMs, toIsoString } from './normalize';

describe('toBoolean', () => {
  test('normalizes boolean, numeric, and string flags', () => {
    expect(toBoolean(true)).toBe(true);
    expect(toBoolean(false)).toBe(false);
    expect(toBoolean(1)).toBe(true);
    expect(toBoolean(0)).toBe(false);
    expect(toBoolean('yes')).toBe(true);
    expect(toBoolean('off')).toBe(false);
  });

  test('uses fallback for unknown values', () => {
    expect(toBoolean('not-a-flag')).toBe(false);
    expect(toBoolean('not-a-flag', true)).toBe(true);
  });
});

describe('toEpochMs / toIsoString', () => {
  test('normalizes Date, number, and string timestamps', () => {
    const iso = '2026-02-09T17:36:14.297Z';
    const epoch = Date.parse(iso);

    expect(toEpochMs(new Date(iso))).toBe(epoch);
    expect(toEpochMs(epoch)).toBe(epoch);
    expect(toEpochMs(String(epoch))).toBe(epoch);
    expect(toEpochMs(iso)).toBe(epoch);

    expect(toIsoString(new Date(iso))).toBe(iso);
    expect(toIsoString(epoch)).toBe(iso);
    expect(toIsoString(String(epoch))).toBe(iso);
    expect(toIsoString(iso)).toBe(iso);
  });

  test('returns null for invalid timestamps', () => {
    expect(toEpochMs(undefined)).toBeNull();
    expect(toEpochMs(null)).toBeNull();
    expect(toEpochMs(Number.NaN)).toBeNull();
    expect(toEpochMs('invalid-date')).toBeNull();

    expect(toIsoString(undefined)).toBeNull();
    expect(toIsoString(null)).toBeNull();
    expect(toIsoString('invalid-date')).toBeNull();
  });
});
