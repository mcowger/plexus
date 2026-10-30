import { describe, expect, it, spyOn } from 'bun:test';

import { asFetch } from '../../../../../test/test-utils';
import { createMeterContext } from '../../checker-registry';
import checker from '../ollama-checker';

const ctx = (options: Record<string, unknown> = {}) =>
  createMeterContext('ollama-test', 'ollama', { apiKey: 'ollama-api-key', ...options });

describe('Ollama quota checker', () => {
  it('reads monthly included balance and purchased credits from the balance API', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
      asFetch(async () =>
        Response.json({
          included: {
            balance_usd: 72.5,
            allowance_usd: 100,
            period: { from: '2026-09-15T09:30:00Z', until: '2026-10-15T09:30:00Z' },
          },
          purchased: { balance_usd: 25 },
        })
      )
    );

    const meters = await checker.check(ctx());

    expect(fetchSpy).toHaveBeenCalledWith('https://ollama.com/api/balance', {
      method: 'GET',
      headers: { Authorization: 'Bearer ollama-api-key', Accept: 'application/json' },
    });
    expect(meters).toHaveLength(2);
    expect(meters[0]).toMatchObject({
      key: 'monthly',
      remaining: 72.5,
      periodUnit: 'month',
      resetsAt: '2026-10-15T09:30:00Z',
    });
    expect(meters[0]!.used).toBeCloseTo(27.5);
    expect(meters[1]).toMatchObject({ key: 'purchased', unit: 'USD', remaining: 25 });
  });

  it('supports legacy session and weekly limits', async () => {
    spyOn(globalThis, 'fetch').mockImplementation(
      asFetch(async () =>
        Response.json({
          included: {
            session: { remaining_percent: 75, resets_at: '2026-10-01T07:00:00Z' },
            weekly: { remaining_percent: 40, resets_at: '2026-10-05T00:00:00Z' },
          },
          purchased: { balance_usd: 0 },
        })
      )
    );

    const meters = await checker.check(ctx());
    expect(meters).toHaveLength(2);
    expect(meters[0]).toMatchObject({ key: 'session', used: 25, remaining: 75 });
    expect(meters[1]).toMatchObject({ key: 'weekly', used: 60, remaining: 40 });
  });

  it('throws for unsuccessful responses and does not request HTML', async () => {
    spyOn(globalThis, 'fetch').mockImplementation(
      asFetch(async () => new Response('Unauthorized', { status: 401 }))
    );

    await expect(checker.check(ctx())).rejects.toThrow('HTTP 401');
  });

  it('requires a provider API key', async () => {
    await expect(checker.check(createMeterContext('ollama-test', 'ollama', {}))).rejects.toThrow(
      "Required option 'apiKey' not provided"
    );
  });
});
