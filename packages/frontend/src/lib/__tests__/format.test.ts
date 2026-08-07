import { describe, expect, it } from 'vitest';
import { countdownTickMs, formatResetCountdown } from '../format';

const NOW = Date.parse('2026-08-06T12:00:00.000Z');
const at = (ms: number) => new Date(NOW + ms).toISOString();

describe('formatResetCountdown', () => {
  it('returns null when the meter reports no reset time', () => {
    expect(formatResetCountdown(null, NOW)).toBeNull();
    expect(formatResetCountdown(undefined, NOW)).toBeNull();
    expect(formatResetCountdown('not-a-date', NOW)).toBeNull();
  });

  it('formats hours and minutes for a 5-hour window', () => {
    const reset = formatResetCountdown(at(3 * 3600_000 + 12 * 60_000), NOW);
    expect(reset?.short).toBe('3h 12m');
    expect(reset?.long).toBe('resets in 3h 12m');
    expect(reset?.remainingMs).toBe(3 * 3600_000 + 12 * 60_000);
  });

  it('formats days and hours for a weekly window', () => {
    expect(formatResetCountdown(at(2 * 86400_000 + 4 * 3600_000), NOW)?.short).toBe('2d 4h');
  });

  it('drops to minutes under an hour and seconds under a minute', () => {
    expect(formatResetCountdown(at(47 * 60_000), NOW)?.short).toBe('47m');
    expect(formatResetCountdown(at(41_000), NOW)?.short).toBe('41s');
  });

  it('rolls over between seconds, minutes and hours at the unit boundaries', () => {
    expect(formatResetCountdown(at(59_999), NOW)?.short).toBe('59s');
    expect(formatResetCountdown(at(60_000), NOW)?.short).toBe('1m');
    expect(formatResetCountdown(at(3599_000), NOW)?.short).toBe('59m');
    expect(formatResetCountdown(at(3600_000), NOW)?.short).toBe('1h 0m');
  });

  it('reports a due reset as resetting now', () => {
    const reset = formatResetCountdown(at(-5_000), NOW);
    expect(reset?.short).toBe('now');
    expect(reset?.long).toBe('resetting now');
    expect(reset?.remainingMs).toBe(-5_000);

    expect(formatResetCountdown(at(0), NOW)?.long).toBe('resetting now');
  });

  it('still counts down relatively at exactly 7 days', () => {
    const reset = formatResetCountdown(at(7 * 86400_000), NOW);
    expect(reset?.short).toBe('7d 0h');
    expect(reset?.long).toBe('resets in 7d 0h');
  });

  it('falls back to an absolute date beyond 7 days', () => {
    const iso = at(9 * 86400_000);
    const expected = new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
    const reset = formatResetCountdown(iso, NOW);
    expect(reset?.short).toBe(expected);
    expect(reset?.long).toBe(`resets ${expected}`);
  });

  it('exposes the absolute timestamp for tooltips', () => {
    const iso = at(3600_000);
    expect(formatResetCountdown(iso, NOW)?.absolute).toBe(new Date(iso).toLocaleString());
  });
});

describe('countdownTickMs', () => {
  it('ticks every second only while seconds are displayed', () => {
    expect(countdownTickMs(41_000)).toBe(1_000);
    expect(countdownTickMs(59_999)).toBe(1_000);
  });

  it('ticks every 30s for minute-or-coarser precision', () => {
    expect(countdownTickMs(60_000)).toBe(30_000);
    expect(countdownTickMs(3 * 3600_000)).toBe(30_000);
  });

  it('does not tick every second once the reset is overdue', () => {
    expect(countdownTickMs(0)).toBe(30_000);
    expect(countdownTickMs(-5_000)).toBe(30_000);
  });
});
