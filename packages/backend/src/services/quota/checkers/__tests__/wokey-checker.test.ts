import { beforeEach, describe, expect, it, jest, mock, spyOn } from 'bun:test';

import { createMeterContext, isCheckerRegistered } from '../../checker-registry';
import checkerDef from '../wokey-checker';

const makeCtx = () => createMeterContext('wokey-test', 'wokey', { apiKey: 'sk-test' });

describe('wokey checker', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('is registered under wokey', () => {
    expect(isCheckerRegistered('wokey')).toBe(true);
  });

  it('maps availableUsd to a USD balance meter with bearer auth', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
      mock(
        async () =>
          new Response(JSON.stringify({ userId: '1', availableUsd: 12.345678, reservedUsd: 0.1 }), {
            status: 200,
          })
      ) as unknown as typeof fetch
    );

    const meters = await checkerDef.check(makeCtx());

    expect(meters).toHaveLength(1);
    expect(meters[0]!.kind).toBe('balance');
    expect(meters[0]!.unit).toBe('usd');
    expect(meters[0]!.remaining).toBe(12.345678);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.wokey.ai/v1/dashboard/balance');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
  });

  it('throws on HTTP errors', async () => {
    spyOn(globalThis, 'fetch').mockImplementation(
      mock(
        async () => new Response('bad key', { status: 401, statusText: 'Unauthorized' })
      ) as unknown as typeof fetch
    );

    await expect(checkerDef.check(makeCtx())).rejects.toThrow('HTTP 401');
  });
});
