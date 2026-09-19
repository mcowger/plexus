/**
 * Muse Code subscription quota checker.
 *
 * Subscription state lives on the same key endpoint as the login mint:
 * re-`POST https://api.meta.ai/muse-code/key` with the account's OAuth
 * access token (no `onboard` flag) returns `subs_usage` with a rolling
 * `window` and a `weekly` window, each carrying `used_percent` and
 * `resets_at`. The minted `api_key` itself carries no quota identity, so the
 * checker always resolves the OAuth token — either the explicitly configured
 * `apiKey` (a raw account access token, paralleling the Codex checker) or the
 * `oauthAccessToken` inside the stored `{oauthAccessToken, apiKey}` login
 * credential — and strips `api_key` from anything logged.
 *
 * Failure contract (agreed: keep last good): every failure throws and the
 * scheduler records a sentinel, leaving the last successful snapshot in
 * place. 401/403 means the device token is dead or the subscription lapsed,
 * so the error says to sign in again instead of retrying — a reactive
 * force-refresh would only burn another call on the aggressively
 * rate-limited key endpoint. `is_subs_active === false` likewise throws
 * rather than publishing zeroed meters.
 */

import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { OAuthAuthManager } from '../../oauth/oauth-auth-manager';
import { parseMuseCodeCredential } from '../../oauth/muse-code';
import type { OAuthProvider } from '../../oauth/oauth-providers';
import { logger } from '../../../utils/logger';
import type { Meter } from '../../../types/meter';
import type { MeterContext } from '../checker-registry';

const MUSE_KEY_URL = 'https://api.meta.ai/muse-code/key';
const MUSE_API_VERSION = '1.0.0';
const MUSE_USER_AGENT = 'muse-code/1.0.2';

interface MuseUsageWindow {
  used_percent?: number;
  resets_at?: string | number;
  window_duration_mins?: number;
}

interface MuseKeyResponse {
  api_key?: string;
  user_email?: string;
  user_id?: string;
  is_subs_active?: boolean;
  subs_tier_id?: string | null;
  subs_tier_name?: string | null;
  subs_usage?: {
    window?: MuseUsageWindow | null;
    weekly?: MuseUsageWindow | null;
  } | null;
  require_payment?: boolean;
}

function resolveOAuthToken(ctx: {
  getOption<T>(key: string, def: T): T;
  checkerId: string;
}): string {
  const configured = ctx.getOption<string>('apiKey', '').trim();
  if (configured) return configured;

  const provider = ctx.getOption<string>('oauthProvider', 'muse-code').trim() || 'muse-code';
  const oauthAccountId = ctx.getOption<string>('oauthAccountId', '').trim();
  const credentials = (
    oauthAccountId
      ? OAuthAuthManager.getInstance().getCredentials(provider as OAuthProvider, oauthAccountId)
      : OAuthAuthManager.getInstance().getCredentials(provider as OAuthProvider)
  ) as { access?: string } | null;
  const access = credentials?.access?.trim();
  if (!access) {
    throw new Error(
      `Muse Code quota checker '${ctx.checkerId}' has no stored login; run OAuth login for provider '${provider}'.`
    );
  }
  try {
    return parseMuseCodeCredential(access).oauthAccessToken;
  } catch {
    throw new Error(
      `Muse Code quota checker '${ctx.checkerId}' found an unusable stored credential; sign in again.`
    );
  }
}

function parseResetsAt(value: string | number | undefined): string | undefined {
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const ms = value > 1e12 ? value : value * 1000;
    return new Date(ms).toISOString();
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

export default defineChecker({
  type: 'muse-code',
  displayName: 'Muse Code',
  optionsSchema: z.object({
    apiKey: z.string().optional(),
    oauthAccountId: z.string().optional(),
    oauthProvider: z.string().optional(),
    endpoint: z.string().url().optional(),
    timeoutMs: z.number().int().positive().optional(),
  }),
  async check(ctx) {
    const endpoint = ctx.getOption<string>('endpoint', MUSE_KEY_URL);
    const timeoutMs = ctx.getOption<number>('timeoutMs', 15000);
    const oauthToken = resolveOAuthToken(ctx);

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);
    try {
      logger.silly(`Requesting usage for '${ctx.checkerId}' from ${endpoint}`);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${oauthToken}`,
          'Content-Type': 'application/json',
          'x-api-version': MUSE_API_VERSION,
          'User-Agent': MUSE_USER_AGENT,
        },
        body: JSON.stringify({}),
        signal: abortController.signal,
      });

      const bodyText = await response.text();
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `Muse Code subscription is inactive or the login expired (HTTP ${response.status}); sign in again.`
        );
      }
      if (!response.ok) {
        throw new Error(`quota request failed with status ${response.status}: ${bodyText}`);
      }

      let data: MuseKeyResponse;
      try {
        data = JSON.parse(bodyText) as MuseKeyResponse;
      } catch {
        throw new Error('failed to parse Muse Code quota response');
      }

      if (data.is_subs_active === false || data.require_payment === true) {
        throw new Error('Muse Code subscription is inactive; sign in again.');
      }

      const usage = data.subs_usage;
      if (!usage) throw new Error('Muse Code quota response is missing subs_usage');

      const meters: Meter[] = [];
      if (usage.window) {
        const meter = buildWindowMeter(
          usage.window,
          'rolling',
          rollingLabel(usage.window.window_duration_mins),
          rollingPeriod(usage.window.window_duration_mins),
          ctx
        );
        if (meter) meters.push(meter);
      }
      if (usage.weekly) {
        const meter = buildWindowMeter(
          usage.weekly,
          'weekly',
          'Weekly',
          { periodValue: 1, periodUnit: 'week' },
          ctx
        );
        if (meter) meters.push(meter);
      }
      if (meters.length === 0) {
        throw new Error('Muse Code quota response carries no usable windows');
      }
      return meters;
    } finally {
      clearTimeout(timeout);
    }
  },
});
