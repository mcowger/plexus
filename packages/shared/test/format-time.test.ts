import { describe, it, expect } from 'bun:test';
import {
  formatMinutesToMinSec,
  formatMsToMinSec,
  INDEFINITE_COOLDOWN_MS,
  INDEFINITE_COOLDOWN_THRESHOLD_MS,
} from '../src/format-time';

describe('formatMinutesToMinSec', () => {
  it('formats whole minutes', () => {
    expect(formatMinutesToMinSec(2)).toBe('2m');
  });

  it('formats fractional minutes to seconds', () => {
    expect(formatMinutesToMinSec(0.5)).toBe('30s');
    expect(formatMinutesToMinSec(1.5)).toBe('1m 30s');
  });

  it('handles zero or negative inputs', () => {
    expect(formatMinutesToMinSec(0)).toBe('0s');
    expect(formatMinutesToMinSec(-1)).toBe('0s');
  });
});

describe('formatMsToMinSec', () => {
  it('formats standard millisecond durations', () => {
    expect(formatMsToMinSec(120000)).toBe('2m');
    expect(formatMsToMinSec(30000)).toBe('30s');
    expect(formatMsToMinSec(90000)).toBe('1m 30s');
  });

  it('formats indefinite cooldowns for balance errors', () => {
    expect(formatMsToMinSec(INDEFINITE_COOLDOWN_MS, 'quota exhausted - Account balance')).toBe(
      'until positive balance'
    );
    expect(formatMsToMinSec(INDEFINITE_COOLDOWN_MS, 'Low credit balance')).toBe(
      'until positive balance'
    );
  });

  it('formats indefinite cooldowns for non-balance errors', () => {
    expect(formatMsToMinSec(INDEFINITE_COOLDOWN_MS, 'Quota limit reached')).toBe('until reset');
    expect(formatMsToMinSec(INDEFINITE_COOLDOWN_THRESHOLD_MS)).toBe('until reset');
  });
});
