/**
 * Muse Code subscription quota checker.
 *
 * What must hold:
 *   - the usage snapshot is read from the `response.subscription_usage` SSE
 *     frame of a minimal streamed probe (`POST /v1/responses`), because Meta
 *     no longer returns `subs_usage` from the key-mint endpoint;
 *   - the rolling `window` and `weekly` windows map to percentage allowance
 *     meters with reset times (rolling label derived from
 *     `window_duration_mins`), tolerating string-encoded scalars and
 *     placeholder frames that carry no reading;
 *   - the probe sends the subscription-minted key as Bearer, resolved from
 *     the configured OAuth account, or from an explicitly configured key;
 *   - successful readings are cached for the probe TTL so the scheduler
 *     interval never re-probes inside it;
 *   - auth failures, throttling, an absent snapshot, and unusable payloads
 *     throw (surfacing an error state in the UI) instead of publishing
 *     zeroed meters.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSpy } from '../../../../test/test-utils';
import { OAuthAuthManager } from '../../oauth/oauth-auth-manager';
import { createMeterContext } from '../checker-registry';
import checker, { resetMuseCodeCheckerCacheForTesting } from '../checkers/muse-code-checker';

const CHECKER_ID = 'muse-quota-test';
const MINTED_KEY = 'mk_live_abc';

const SUBSCRIPTION = {
  tier: 'High Usage',
  window: {
    used_percent: 12,
    resets_at: '2026-09-19T12:00:00.000Z',
    window_duration_mins: 300,
  },
  weekly: { used_percent: 31, resets_at: '2026-09-21T00:00:00.000Z' },
};

function subscriptionFrame(subscription: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ type: 'response.subscription_usage', subscription })}\n\n`;
}

function sseResponse(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/event-stream', ...headers },
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('muse-code quota checker', () => {
  let getApiKey: ReturnType<typeof registerSpy>;
  let fetchSpy: ReturnType<typeof registerSpy>;

  beforeEach(() => {
    OAuthAuthManager.resetForTesting();
    resetMuseCodeCheckerCacheForTesting();
    getApiKey = registerSpy(OAuthAuthManager.getInstance(), 'getApiKey').mockResolvedValue(
      MINTED_KEY
    );
    // Fresh Response per call: a Response body is single-use, and the
    // TTL-disabled test probes twice.
    fetchSpy = registerSpy(globalThis, 'fetch').mockImplementation(async () =>
      sseResponse(subscriptionFrame(SUBSCRIPTION))
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetMuseCodeCheckerCacheForTesting();
    OAuthAuthManager.resetForTesting();
  });

  it('maps rolling + weekly windows to percentage meters', async () => {
    const ctx = createMeterContext(CHECKER_ID, 'meta', { oauthProvider: 'meta' });

    const meters = await checker.check(ctx);
    expect(meters).toHaveLength(2);
    const rolling = meters.find((m) => m.key === 'rolling')!;
    expect(rolling.label).toBe('Rolling (5 hours)');
    expect(rolling.used).toBe(12);
    expect(rolling.limit).toBe(100);
    expect(rolling.remaining).toBe(88);
    expect(rolling.periodValue).toBe(5);
    expect(rolling.periodUnit).toBe('hour');
    expect(rolling.periodCycle).toBe('rolling');
    expect(rolling.resetsAt).toBe('2026-09-19T12:00:00.000Z');
    const weekly = meters.find((m) => m.key === 'weekly')!;
    expect(weekly.label).toBe('Weekly');
    expect(weekly.used).toBe(31);
    expect(weekly.periodUnit).toBe('week');
  });

  it('sends the minted key as Bearer with the minimal probe body', async () => {
    const ctx = createMeterContext(CHECKER_ID, 'meta', {
      oauthProvider: 'meta',
      oauthAccountId: 'Personal',
    });

    await checker.check(ctx);
    expect(getApiKey).toHaveBeenCalledWith('meta', 'Personal');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://api.meta.ai/v1/responses');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${MINTED_KEY}`);
    expect(headers.Accept).toBe('text/event-stream');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.stream).toBe(true);
    expect(body.max_output_tokens).toBe(16);
    expect(typeof body.input).toBe('string');
    expect(body.model).toBe('muse-spark-1.3');
  });

  it('uses an explicitly configured key without a stored login', async () => {
    const ctx = createMeterContext(CHECKER_ID, 'meta', { apiKey: 'raw-model-key' });

    await checker.check(ctx);
    expect(getApiKey).not.toHaveBeenCalled();
    const headers = fetchSpy.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer raw-model-key');
  });

  it('throws a sign-in error on 401/403 for a configured key without retrying', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(401, { error: 'unauthorized' }));
    const ctx = createMeterContext(CHECKER_ID, 'meta', { apiKey: 'stale-key' });
    await expect(checker.check(ctx)).rejects.toThrow(/sign in again/);
    expect(getApiKey).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('re-mints once and retries when an OAuth probe gets 401', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }))
      .mockResolvedValue(sseResponse(subscriptionFrame(SUBSCRIPTION)));
    const ctx = createMeterContext(CHECKER_ID, 'meta', {
      oauthProvider: 'meta',
      oauthAccountId: 'Personal',
    });

    const meters = await checker.check(ctx);
    expect(meters).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(getApiKey).toHaveBeenCalledTimes(2);
    expect(getApiKey).toHaveBeenLastCalledWith('meta', 'Personal', { forceRefresh: true });
  });

  it('throws the original auth error when the reactive force-refresh fails', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(401, { error: 'unauthorized' }));
    getApiKey.mockResolvedValueOnce('mk_first').mockRejectedValueOnce(new Error('refresh failed'));
    const ctx = createMeterContext(CHECKER_ID, 'meta', { oauthProvider: 'meta' });

    await expect(checker.check(ctx)).rejects.toThrow(/sign in again/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('throws a token error when no key can be resolved', async () => {
    getApiKey.mockRejectedValue(new Error("OAuth: Not authenticated for provider 'meta'."));
    const ctx = createMeterContext(CHECKER_ID, 'meta', { oauthProvider: 'meta' });
    await expect(checker.check(ctx)).rejects.toThrow(/run OAuth login/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws a throttled error on HTTP 429 without publishing meters', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'retry-after': '120' },
      })
    );
    const ctx = createMeterContext(CHECKER_ID, 'meta', { apiKey: 'dca_tok' });

    const error = (await checker.check(ctx).catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/rate-limited.*429/);
    expect(error.message).toContain('retry after 120s');
  });

  it('tolerates string scalars and epoch-second resets_at', async () => {
    fetchSpy.mockResolvedValue(
      sseResponse(
        subscriptionFrame({
          tier: '27681527378179523',
          window: {
            used_percent: '34',
            window_duration_mins: '300',
            resets_at: '1789078632',
          },
          weekly: { used_percent: '12.5', resets_at: '1789344000' },
        })
      )
    );
    const ctx = createMeterContext(CHECKER_ID, 'meta', { apiKey: 'dca_tok' });

    const meters = await checker.check(ctx);
    expect(meters.find((m) => m.key === 'rolling')?.used).toBe(34);
    expect(meters.find((m) => m.key === 'rolling')?.resetsAt).toBe(
      new Date(1789078632 * 1000).toISOString()
    );
    expect(meters.find((m) => m.key === 'weekly')?.used).toBe(12.5);
    expect(meters.find((m) => m.key === 'weekly')?.resetsAt).toBe(
      new Date(1789344000 * 1000).toISOString()
    );
  });

  it('skips placeholder frames and reads a later usable snapshot', async () => {
    fetchSpy.mockResolvedValue(
      sseResponse(
        subscriptionFrame({ window: {}, weekly: {} }) +
          'data: {"type":"response.output_text.delta","delta":"pi"}\n\n' +
          subscriptionFrame({ window: { used_percent: 5, window_duration_mins: 300 } })
      )
    );
    const ctx = createMeterContext(CHECKER_ID, 'meta', { apiKey: 'dca_tok' });

    const meters = await checker.check(ctx);
    expect(meters).toHaveLength(1);
    expect(meters[0]!.key).toBe('rolling');
    expect(meters[0]!.used).toBe(5);
  });

  it('skips a duration-only frame and prefers a later frame with a percentage', async () => {
    fetchSpy.mockResolvedValue(
      sseResponse(
        subscriptionFrame({ window: { window_duration_mins: 300 } }) +
          subscriptionFrame({ weekly: { used_percent: 44, resets_at: 1789344000 } })
      )
    );
    const ctx = createMeterContext(CHECKER_ID, 'meta', { apiKey: 'dca_tok' });

    const meters = await checker.check(ctx);
    expect(meters).toHaveLength(1);
    expect(meters[0]!.key).toBe('weekly');
    expect(meters[0]!.used).toBe(44);
  });

  it('throws when the stream carries no subscription snapshot', async () => {
    fetchSpy.mockResolvedValue(
      sseResponse('data: {"type":"response.output_text.delta","delta":"no usage here"}\n\n')
    );
    const ctx = createMeterContext(CHECKER_ID, 'meta', { apiKey: 'dca_tok' });
    await expect(checker.check(ctx)).rejects.toThrow(/no subscription snapshot/);
  });

  it('reuses a cached reading inside the probe TTL', async () => {
    const ctx = createMeterContext(CHECKER_ID, 'meta', { apiKey: 'dca_tok' });

    await checker.check(ctx);
    await checker.check(ctx);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('re-probes when the probe TTL is disabled', async () => {
    const ctx = createMeterContext(CHECKER_ID, 'meta', { apiKey: 'dca_tok', probeTtlMs: 0 });

    await checker.check(ctx);
    await checker.check(ctx);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('redacts the minted api_key from upstream error bodies', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(500, { message: 'boom', api_key: 'mk_live_secret' }));
    const ctx = createMeterContext(CHECKER_ID, 'meta', { apiKey: 'dca_tok' });

    const error = (await checker.check(ctx).catch((e: unknown) => e)) as Error;
    expect(error.message).toMatch(/status 500/);
    expect(error.message).toContain('[redacted]');
    expect(error.message).not.toContain('mk_live_secret');
  });
});
