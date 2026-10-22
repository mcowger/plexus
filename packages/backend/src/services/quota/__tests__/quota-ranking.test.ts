import { describe, expect, test } from 'bun:test';

import {
  constrainedRatio,
  mostConstrained,
  QuotaRatioFields,
  sortMostConstrainedFirst,
} from '@plexus/shared';

const entry = (name: string, limit: number, remaining: number) => ({ name, limit, remaining });

describe('constrainedRatio', () => {
  test('returns remaining/limit for a positive limit', () => {
    expect(constrainedRatio({ limit: 100, remaining: 25 })).toBe(0.25);
  });

  test('treats a zero limit as fully constrained instead of NaN', () => {
    expect(constrainedRatio({ limit: 0, remaining: 0 })).toBe(0);
  });
});

describe('mostConstrained', () => {
  test('returns null for an empty list', () => {
    expect(mostConstrained([])).toBeNull();
  });

  test('returns the sole entry of a single-element list', () => {
    const only = entry('only', 100, 50);
    expect(mostConstrained([only])).toBe(only);
  });

  test('picks the entry with the smallest remaining/limit ratio', () => {
    const loose = entry('loose', 1000, 900); // ratio 0.9
    const tight = entry('tight', 10, 1); // ratio 0.1
    expect(mostConstrained([loose, tight])).toBe(tight);
  });

  test('a zero-limit entry beats a nearly-exhausted positive-limit entry', () => {
    // Regression: the old unguarded `remaining / limit` produced NaN for
    // limit=0, whose comparisons are always false, so the zero-limit entry
    // could never win the reduce.
    const nearlyExhausted = entry('nearly-exhausted', 100, 10); // ratio 0.1
    const zeroLimit = entry('zero-limit', 0, 0); // fully constrained
    expect(mostConstrained([nearlyExhausted, zeroLimit])).toBe(zeroLimit);
  });

  test('an all-zero-limit list returns the first entry, never NaN artifacts', () => {
    const first = entry('first', 0, 0);
    const second = entry('second', 0, 0);
    expect(mostConstrained([first, second])).toBe(first);
  });

  test('first entry wins ties', () => {
    const a = entry('a', 100, 0);
    const b = entry('b', 10, 0);
    expect(mostConstrained([a, b])).toBe(a);
  });
});

describe('sortMostConstrainedFirst', () => {
  test('orders by ascending remaining/limit ratio with zero-limit entries first', () => {
    const loose = entry('loose', 1000, 900); // ratio 0.9
    const tight = entry('tight', 10, 1); // ratio 0.1
    const zeroLimit = entry('zero-limit', 0, 0); // ratio 0
    const sorted = sortMostConstrainedFirst([loose, tight, zeroLimit]);
    expect(sorted.map((e) => e.name)).toEqual(['zero-limit', 'tight', 'loose']);
  });

  test('does not mutate the input array', () => {
    const input: (QuotaRatioFields & { name: string })[] = [
      entry('loose', 1000, 900),
      entry('tight', 10, 1),
    ];
    sortMostConstrainedFirst(input);
    expect(input.map((e) => e.name)).toEqual(['loose', 'tight']);
  });
});
