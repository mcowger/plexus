import { describe, expect, test } from 'bun:test';

import { toBoolean, toDbBoolean, toEpochMs, toIsoString } from '../normalize';

describe('toBoolean', () => {
  test('handles boolean and numeric values', () => {
    expect(toBoolean(true)).toBe(true);
    expect(toBoolean(false)).toBe(false);
    expect(toBoolean(1)).toBe(true);
    expect(toBoolean(0)).toBe(false);
    expect(toBoolean(2)).toBe(true);
  });

  test('handles string variants', () => {
    expect(toBoolean('true')).toBe(true);
    expect(toBoolean('TRUE')).toBe(true);
    expect(toBoolean('1')).toBe(true);
    expect(toBoolean('yes')).toBe(true);
    expect(toBoolean('on')).toBe(true);

    expect(toBoolean('false')).toBe(false);
    expect(toBoolean('FALSE')).toBe(false);
    expect(toBoolean('0')).toBe(false);
    expect(toBoolean('no')).toBe(false);
    expect(toBoolean('off')).toBe(false);
  });

  test('falls back for nullish/unknown values', () => {
    expect(toBoolean(undefined)).toBe(false);
    expect(toBoolean(null)).toBe(false);
    expect(toBoolean('not-a-boolean')).toBe(false);
    expect(toBoolean('not-a-boolean', true)).toBe(true);
  });
});

describe('toDbBoolean', () => {
  test('maps truthy/falsy to 1/0', () => {
    expect(toDbBoolean(true)).toBe(1);
    expect(toDbBoolean(1)).toBe(1);
    expect(toDbBoolean('yes')).toBe(1);

    expect(toDbBoolean(false)).toBe(0);
    expect(toDbBoolean(0)).toBe(0);
    expect(toDbBoolean('off')).toBe(0);
  });
});

describe('toEpochMs', () => {
  test('converts Date, number, and numeric string', () => {
    const date = new Date('2026-02-09T17:36:14.297Z');
    const expected = date.getTime();

    expect(toEpochMs(date)).toBe(expected);
    expect(toEpochMs(expected)).toBe(expected);
    expect(toEpochMs(String(expected))).toBe(expected);
  });

  test('converts ISO string and rejects invalid values', () => {
    const iso = '2026-02-09T17:36:14.297Z';
    expect(toEpochMs(iso)).toBe(Date.parse(iso));

    expect(toEpochMs(undefined)).toBeNull();
    expect(toEpochMs(null)).toBeNull();
    expect(toEpochMs(Number.NaN)).toBeNull();
    expect(toEpochMs('not-a-date')).toBeNull();
  });
});

describe('toIsoString', () => {
  test('normalizes supported timestamp inputs to ISO', () => {
    const iso = '2026-02-09T17:36:14.297Z';
    const epoch = Date.parse(iso);

    expect(toIsoString(epoch)).toBe(iso);
    expect(toIsoString(String(epoch))).toBe(iso);
    expect(toIsoString(new Date(iso))).toBe(iso);
  });

  test('returns null for invalid input', () => {
    expect(toIsoString(undefined)).toBeNull();
    expect(toIsoString(null)).toBeNull();
    expect(toIsoString('not-a-date')).toBeNull();
  });
});
