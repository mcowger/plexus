import { describe, expect, test, vi } from 'vitest';

vi.mock('../../config', () => ({
  getConfig: () => ({ timeout: { defaultSeconds: 4 } }),
}));

import { wireUpstreamTimeout } from '../timeout';

describe('wireUpstreamTimeout', () => {
  test('per-provider timeout can be longer than global timeout', () => {
    const abortController = new AbortController();
    const { resolveTimeoutMs, signal } = wireUpstreamTimeout(abortController);

    expect(resolveTimeoutMs(35_000)).toBe(35_000);
    expect(signal.aborted).toBe(false);
  });

  test('null provider timeout resolves to global timeout', () => {
    const abortController = new AbortController();
    const { resolveTimeoutMs } = wireUpstreamTimeout(abortController);

    expect(resolveTimeoutMs(null)).toBe(4_000);
  });
});
