/**
 * Muse Code subscription quota checker.
 *
 * Meta removed the subscription snapshot (`subs_usage`) from the key-mint
 * endpoint (`POST /muse-code/key`) on 2026-09-11 and exposes no aggregate
 * usage/billing REST route (`/v1/usage`, `/v1/billing`, `/muse-code/{usage,
 * quota,billing,limits}` all 404). The only carrier is an SSE frame on the
 * Model API Responses stream:
 *
 *   POST https://api.meta.ai/v1/responses   (stream: true)
 *   event: response.subscription_usage
 *   data: {"type":"response.subscription_usage",
 *          "subscription":{"tier":"…",
 *            "window":{"used_percent":…,"resets_at":…,"window_duration_mins":300},
 *            "weekly":{"used_percent":…,"resets_at":…}}}
 *
 * This is the same snapshot the Muse CLI's `/usage` panel renders. The
 * checker therefore sends a minimal streamed probe (`input: "ping"`,
 * `max_output_tokens: 16` — the API floor), reads the first usable frame,
 * and closes the stream. The probe spends one model request against the
 * very window it reports, so successful readings are cached for
 * `probeTtlMs` (default one hour) and only re-probed once the cache ages
 * out; the scheduler interval can be shorter than the cache without
 * burning prompts.
 *
 * Auth is the subscription-minted Model API key (pi-ai's meta credential
 * stores it as `access`), resolved through `OAuthAuthManager.getApiKey`,
 * which re-mints it when it expires. Scalar fields can arrive as JSON
 * strings; placeholder frames (`"window":{}`) carry no reading and are
 * skipped rather than recorded as a real 0%.
 *
 * Failure contract: every failure throws — the scheduler records an error
 * sentinel (no fabricated meters, no routing cooldown) and the UI shows
 * the failure in "Needs attention" instead of hiding the panel. A 401/403
 * from the probe triggers one reactive re-mint for OAuth logins; if that
 * still fails, the error says to sign in again. HTTP 429 throws a
 * rate-limit error, and the scheduler retries on interval.
 */

import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { OAuthAuthManager } from '../../oauth/oauth-auth-manager';
import type { OAuthProvider } from '../../oauth/oauth-providers';
import { logger } from '../../../utils/logger';
import type { Meter } from '../../../types/meter';
import type { MeterContext } from '../checker-registry';

const MUSE_RESPONSES_URL = 'https://api.meta.ai/v1/responses';
const MUSE_DEFAULT_MODEL = 'muse-spark-1.3';
/** The Responses API rejects `max_output_tokens` below 16. */
const MUSE_PROBE_MAX_OUTPUT_TOKENS = 16;
const MUSE_PROBE_INPUT = 'ping';
/** Successful readings are reused for this long; one probe per window is costly. */
const MUSE_DEFAULT_PROBE_TTL_MS = 60 * 60 * 1000;

interface MuseUsageWindow {
  used_percent?: number;
  resets_at?: string | number;
  window_duration_mins?: number;
}

interface MuseSubscription {
  tier?: string;
  window?: MuseUsageWindow;
  weekly?: MuseUsageWindow;
}

/** 401/403 from the probe: the key or login is dead, or due for a re-mint. */
class MuseAuthError extends Error {
  constructor(readonly status: number) {
    super(
      `Muse Code subscription is inactive or the login expired (HTTP ${status}); sign in again.`
    );
    this.name = 'MuseAuthError';
  }
}

/** Readings keyed by checker, reused until the probe TTL ages out. */
const probeCache = new Map<string, { at: number; meters: Meter[] }>();

/** Drop cached readings; the scheduler persists its own snapshots. */
export function resetMuseCodeCheckerCacheForTesting(): void {
  probeCache.clear();
}

async function resolveApiKey(
  ctx: {
    getOption<T>(key: string, def: T): T;
    checkerId: string;
  },
  options?: { forceRefresh?: boolean }
): Promise<string> {
  const configured = ctx.getOption<string>('apiKey', '').trim();
  if (configured) return configured;

  const provider = ctx.getOption<string>('oauthProvider', 'meta').trim() || 'meta';
  const oauthAccountId = ctx.getOption<string>('oauthAccountId', '').trim();
  try {
    const authManager = OAuthAuthManager.getInstance();
    if (options?.forceRefresh) {
      return await authManager.getApiKey(provider as OAuthProvider, oauthAccountId || undefined, {
        forceRefresh: true,
      });
    }
    return await authManager.getApiKey(provider as OAuthProvider, oauthAccountId || undefined);
  } catch {
    throw new Error(
      `Muse Code quota checker '${ctx.checkerId}' could not resolve a Meta API key for provider '${provider}'; run OAuth login.`
    );
  }
}

function parseResetsAt(value: string | number | undefined): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const ms = value > 1e12 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return undefined;
    // Meta sends `resets_at` as an epoch-second JSON string on some frames.
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds) && seconds > 0) {
      const ms = seconds > 1e12 ? seconds : seconds * 1000;
      return new Date(ms).toISOString();
    }
    const ms = Date.parse(trimmed);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
  }
  return undefined;
}

/** Rolling-window period from `window_duration_mins` (300 → 5 hours). */
function rollingPeriod(minutes?: number): { periodValue: number; periodUnit: 'minute' | 'hour' } {
  if (typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0) {
    const rounded = Math.round(minutes);
    if (rounded % 60 === 0) return { periodValue: rounded / 60, periodUnit: 'hour' };
    return { periodValue: rounded, periodUnit: 'minute' };
  }
  return { periodValue: 5, periodUnit: 'hour' };
}

function rollingLabel(minutes?: number): string {
  const { periodValue, periodUnit } = rollingPeriod(minutes);
  const unit = periodUnit === 'hour' ? (periodValue === 1 ? 'hour' : 'hours') : 'minutes';
  return `Rolling (${periodValue} ${unit})`;
}

function buildWindowMeter(
  window: MuseUsageWindow,
  key: string,
  label: string,
  period: { periodValue: number; periodUnit: 'minute' | 'hour' | 'day' | 'week' },
  ctx: Pick<MeterContext, 'allowance'>
): Meter | null {
  const usedPercent = window.used_percent;
  if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent) || usedPercent < 0) {
    return null;
  }
  const used = Math.min(usedPercent, 100);
  return ctx.allowance({
    key,
    label,
    unit: 'percentage',
    used,
    limit: 100,
    remaining: Math.max(0, 100 - used),
    periodValue: period.periodValue,
    periodUnit: period.periodUnit,
    periodCycle: 'rolling',
    resetsAt: parseResetsAt(window.resets_at),
  });
}

/** Redacts any `api_key` value so error text is safe to log and display. */
function redactApiKey(bodyText: string): string {
  return bodyText.replace(/("api_key"\s*:\s*")[^"]*(")/g, '$1[redacted]$2');
}

function asFiniteNumber(value: unknown): number | undefined {
  const num = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof num === 'number' && Number.isFinite(num) ? num : undefined;
}

function firstPresent<T>(record: Record<string, unknown>, keys: string[]): T | undefined {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null) return value as T;
  }
  return undefined;
}

/**
 * Normalizes one usage window across observed field-name variants
 * (`used_percent`/`utilization`/`percent`, `resets_at`/`resetsAt`). A bare
 * `used` count is deliberately not accepted: it is not a percentage and
 * would publish a wrong utilization. Values may be JSON strings.
 */
function pickWindow(raw: unknown): MuseUsageWindow | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const used = asFiniteNumber(
    firstPresent<unknown>(record, ['used_percent', 'utilization', 'percent'])
  );
  const resets = firstPresent<string | number>(record, [
    'resets_at',
    'resetsAt',
    'reset_at',
    'reset',
  ]);
  const durationMins = asFiniteNumber(
    firstPresent<unknown>(record, ['window_duration_mins', 'window_duration_minutes'])
  );
  if (used === undefined && resets === undefined && durationMins === undefined) return null;
  return {
    ...(used !== undefined ? { used_percent: used } : {}),
    ...(typeof resets === 'string' || typeof resets === 'number' ? { resets_at: resets } : {}),
    ...(durationMins !== undefined ? { window_duration_mins: durationMins } : {}),
  };
}

/**
 * Whether a window carries an actual percentage reading. A frame that only
 * names a window's duration or reset cannot produce a meter, so it must not
 * terminate the stream read (a later frame may carry the percentages).
 */
function hasUsageReading(window: MuseUsageWindow | null): boolean {
  return typeof window?.used_percent === 'number';
}

/**
 * Parses one `response.subscription_usage` SSE frame out of an accumulated
 * body. Returns null while the frame is still incomplete (JSON parse fails)
 * or when the frame carries no usable window (placeholder `{}` objects),
 * so the caller keeps reading.
 */
function parseSubscriptionEvent(sse: string): MuseSubscription | null {
  for (const line of sse.split('\n')) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const record = parsed as Record<string, unknown>;
    if (record.type !== 'response.subscription_usage') continue;
    const raw = record.subscription;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const subscriptionRecord = raw as Record<string, unknown>;
    const window = pickWindow(firstPresent(subscriptionRecord, ['window', 'rolling']));
    const weekly = pickWindow(firstPresent(subscriptionRecord, ['weekly', 'seven_day']));
    if (!hasUsageReading(window) && !hasUsageReading(weekly)) continue;
    const tier = firstPresent<unknown>(subscriptionRecord, [
      'tier',
      'plan',
      'subs_tier_name',
      'subs_tier_id',
    ]);
    return {
      ...(typeof tier === 'string' && tier.trim() ? { tier: tier.trim() } : {}),
      ...(window ? { window } : {}),
      ...(weekly ? { weekly } : {}),
    };
  }
  return null;
}

/** Reads an SSE body until the first usable subscription frame, then cancels. */
async function readSubscriptionFrame(
  body: ReadableStream<Uint8Array> | null
): Promise<MuseSubscription | null> {
  if (!body) return null;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      const subscription = parseSubscriptionEvent(buffer);
      if (subscription) return subscription;
      if (done) return null;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

/**
 * Human-readable `Retry-After` detail for throttle errors (seconds or HTTP
 * date). Never throws, so a malformed header can't turn a throttle into a
 * crash.
 */
function retryAfterDetail(value: string | null): string | undefined {
  if (!value?.trim()) return undefined;
  const trimmed = value.trim();
  const secs = Number(trimmed);
  if (Number.isFinite(secs) && secs >= 0) {
    const at = Date.now() + secs * 1000;
    if (Number.isFinite(at)) return `retry after ${Math.round(secs)}s`;
  }
  const ms = Date.parse(trimmed);
  if (Number.isFinite(ms)) return `retry after ${new Date(ms).toISOString()}`;
  return undefined;
}

/** Sends one minimal streamed probe and extracts the subscription snapshot. */
async function probeSubscription(
  apiKey: string,
  endpoint: string,
  model: string,
  timeoutMs: number
): Promise<MuseSubscription> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);
  try {
    logger.silly(`Probing Muse Code usage for a subscription snapshot at ${endpoint}`);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: MUSE_PROBE_INPUT,
        stream: true,
        max_output_tokens: MUSE_PROBE_MAX_OUTPUT_TOKENS,
      }),
      signal: abortController.signal,
    });

    if (response.status === 401 || response.status === 403) {
      throw new MuseAuthError(response.status);
    }
    if (response.status === 429) {
      const detail = retryAfterDetail(response.headers.get('retry-after'));
      throw new Error(
        `Muse Code usage probe rate-limited (HTTP 429${detail ? `; ${detail}` : ''}); will retry on the next check`
      );
    }
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new Error(
        `Muse Code usage probe failed with status ${response.status}: ${redactApiKey(bodyText).slice(0, 200)}`
      );
    }

    const subscription = await readSubscriptionFrame(response.body);
    if (!subscription) {
      throw new Error('Muse Code usage probe returned no subscription snapshot');
    }
    return subscription;
  } finally {
    clearTimeout(timeout);
  }
}

export default defineChecker({
  type: 'muse-code',
  displayName: 'Muse Code',
  optionsSchema: z.object({
    apiKey: z.string().optional(),
    oauthAccountId: z.string().optional(),
    oauthProvider: z.string().optional(),
    endpoint: z.string().url().optional(),
    model: z.string().optional(),
    probeTtlMs: z.number().int().nonnegative().optional(),
    timeoutMs: z.number().int().positive().optional(),
  }),
  async check(ctx) {
    const endpoint = ctx.getOption<string>('endpoint', MUSE_RESPONSES_URL);
    const timeoutMs = ctx.getOption<number>('timeoutMs', 15000);
    const model = ctx.getOption<string>('model', MUSE_DEFAULT_MODEL);
    const probeTtlMs = ctx.getOption<number>('probeTtlMs', MUSE_DEFAULT_PROBE_TTL_MS);

    if (probeTtlMs > 0) {
      const cached = probeCache.get(ctx.checkerId);
      if (cached && Date.now() - cached.at < probeTtlMs) {
        return [...cached.meters];
      }
    }

    const isOAuth = !ctx.getOption<string>('apiKey', '').trim();
    let apiKey = await resolveApiKey(ctx);
    let subscription: MuseSubscription;
    try {
      subscription = await probeSubscription(apiKey, endpoint, model, timeoutMs);
    } catch (error) {
      // A key that was revoked but has not expired fails immediately; re-mint
      // once before telling the user to sign in again (mirrors the Codex checker).
      if (!isOAuth || !(error instanceof MuseAuthError)) throw error;
      logger.warn(
        `Muse Code quota checker: received ${error.status} for '${ctx.checkerId}', attempting reactive force-refresh`
      );
      let refreshedKey: string | undefined;
      try {
        refreshedKey = await resolveApiKey(ctx, { forceRefresh: true });
      } catch (refreshError) {
        logger.warn(
          `Muse Code quota checker: reactive force-refresh failed for '${ctx.checkerId}': ${refreshError}`
        );
      }
      if (!refreshedKey) throw error;
      apiKey = refreshedKey;
      subscription = await probeSubscription(apiKey, endpoint, model, timeoutMs);
    }

    const meters: Meter[] = [];
    if (subscription.window) {
      const meter = buildWindowMeter(
        subscription.window,
        'rolling',
        rollingLabel(subscription.window.window_duration_mins),
        rollingPeriod(subscription.window.window_duration_mins),
        ctx
      );
      if (meter) meters.push(meter);
    }
    if (subscription.weekly) {
      const meter = buildWindowMeter(
        subscription.weekly,
        'weekly',
        'Weekly',
        { periodValue: 1, periodUnit: 'week' },
        ctx
      );
      if (meter) meters.push(meter);
    }
    if (meters.length === 0) {
      throw new Error('Muse Code usage probe carried no usable windows');
    }

    if (probeTtlMs > 0) {
      probeCache.set(ctx.checkerId, { at: Date.now(), meters });
    }
    return meters;
  },
});
