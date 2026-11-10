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
    expect(meters).toHaveLength(3);
    expect(meters[0]).toMatchObject({ key: 'session', used: 25, remaining: 75 });
    expect(meters[1]).toMatchObject({ key: 'weekly', used: 60, remaining: 40 });
    expect(meters[2]).toMatchObject({
      key: 'purchased',
      remaining: 0,
      status: 'ok',
      utilizationPercent: 'not_applicable',
    });
  });

  it('lets purchased credits keep routing after an allowance runs out only when opted in', async () => {
    const body = {
      included: {
        session: { remaining_percent: 0, resets_at: '2026-10-01T07:00:00Z' },
        weekly: { remaining_percent: 40, resets_at: '2026-10-05T00:00:00Z' },
      },
      purchased: { balance_usd: 12 },
    };
    spyOn(globalThis, 'fetch').mockImplementation(asFetch(async () => Response.json(body)));

    const optedOut = await checker.check(ctx());
    expect(optedOut[0]!.exhaustionThreshold).toBeUndefined();
    expect(optedOut[0]!.status).toBe('exhausted');

    const optedIn = await checker.check(ctx({ usePurchasedCredits: true }));
    expect(optedIn[0]!.exhaustionThreshold).toBe(101);
    expect(optedIn[1]!.exhaustionThreshold).toBe(101);
    expect(optedIn[2]).toMatchObject({ key: 'purchased', remaining: 12, status: 'ok' });
  });

  it('keeps allowance exhaustion blocking when opted in but no credits remain', async () => {
    spyOn(globalThis, 'fetch').mockImplementation(
      asFetch(async () =>
        Response.json({
          included: {
            session: { remaining_percent: 0, resets_at: '2026-10-01T07:00:00Z' },
          },
          purchased: { balance_usd: 0 },
        })
      )
    );

    const meters = await checker.check(ctx({ usePurchasedCredits: true }));
    expect(meters[0]!.exhaustionThreshold).toBeUndefined();
    expect(meters[0]!.status).toBe('exhausted');
  });

  it('returns a zero-balance meter for accounts with exhausted purchased credits', async () => {
    spyOn(globalThis, 'fetch').mockImplementation(
      asFetch(async () => Response.json({ purchased: { balance_usd: 0 } }))
    );

    const meters = await checker.check(ctx());
    expect(meters).toHaveLength(1);
    expect(meters[0]).toMatchObject({
      key: 'purchased',
      kind: 'balance',
      unit: 'USD',
      remaining: 0,
      status: 'exhausted',
    });
  });

  it('rejects malformed balance responses instead of returning invalid meters', async () => {
    spyOn(globalThis, 'fetch').mockImplementation(
      asFetch(async () =>
        Response.json({
          included: {
            session: { resets_at: '2026-10-01T07:00:00Z' },
            weekly: { remaining_percent: 40, resets_at: '2026-10-05T00:00:00Z' },
          },
          purchased: { balance_usd: 0 },
        })
      )
    );

    await expect(checker.check(ctx())).rejects.toThrow('Unexpected Ollama balance response');
  });

  it('rejects monthly responses without period reset data', async () => {
    spyOn(globalThis, 'fetch').mockImplementation(
      asFetch(async () =>
        Response.json({
          included: { balance_usd: 25, allowance_usd: 50 },
          purchased: { balance_usd: 0 },
        })
      )
    );

    await expect(checker.check(ctx())).rejects.toThrow('Unexpected Ollama balance response');
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
