import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { OAuthAuthManager } from '../../oauth-auth-manager';
import { CodexVersionService } from '../../codex-version-service';
import type { OAuthProvider } from '@mariozechner/pi-ai/oauth';
import { logger } from '../../../utils/logger';
import type { Meter } from '../../../types/meter';
import type { MeterContext } from '../checker-registry';

interface CodexUsageWindow {
  used_percent?: number;
  reset_at?: number;
  limit_window_seconds?: number;
}

interface CodexRateLimitInfo {
  allowed?: boolean;
  limit_reached?: boolean;
  primary_window?: CodexUsageWindow;
  secondary_window?: CodexUsageWindow;
}

interface CodexUsageResponse {
  plan_type?: string;
  rate_limit?: CodexRateLimitInfo;
}

interface OAuthCredentialsBlob {
  access_token?: string;
}

function parseAccessToken(apiKey: string): string {
  const raw = apiKey.trim();
  if (!raw) throw new Error('OAuth missing access_token');
  if (raw.toLowerCase().startsWith('bearer ')) return raw.slice(7).trim();
  if (!raw.startsWith('{')) return raw;
  try {
    const parsed = JSON.parse(raw) as OAuthCredentialsBlob;
    const token = parsed.access_token?.trim();
    if (token) return token;
  } catch {}
  throw new Error('failed to parse OAuth credentials JSON');
}

function extractChatGPTAccountId(accessToken: string): string | null {
  const parts = accessToken.split('.');
  const payloadSegment = parts[1];
  if (!payloadSegment) return null;
  try {
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as {
      'https://api.openai.com/auth'?: { chatgpt_account_id?: string };
    };
    return payload['https://api.openai.com/auth']?.chatgpt_account_id?.trim() || null;
  } catch {
    return null;
  }
}

function windowPeriod(limitWindowSeconds?: number): {
  periodValue: number;
  periodUnit: 'hour' | 'day';
  periodCycle: 'rolling';
} {
  if (limitWindowSeconds === 5 * 60 * 60)
    return { periodValue: 5, periodUnit: 'hour', periodCycle: 'rolling' };
  return { periodValue: 7, periodUnit: 'day', periodCycle: 'rolling' };
}

function buildMeterFromWindow(
  window: CodexUsageWindow,
  key: string,
  label: string,
  ctx: Pick<MeterContext, 'allowance'>
): Meter | null {
  const usedPercent = window.used_percent;
  const used =
    typeof usedPercent === 'number' && Number.isFinite(usedPercent)
      ? Math.min(Math.max(usedPercent, 0), 100)
      : 0;
  const remaining = Math.max(0, 100 - used);
  const period = windowPeriod(window.limit_window_seconds);
  const resetsAt =
    typeof window.reset_at === 'number' && window.reset_at > 0
      ? new Date(window.reset_at * 1000).toISOString()
      : undefined;
  return ctx.allowance({ key, label, unit: 'percentage', used, remaining, ...period, resetsAt });
}

export default defineChecker({
  type: 'openai-codex',
  optionsSchema: z.object({
    apiKey: z.string().optional(),
    oauthAccountId: z.string().optional(),
    oauthProvider: z.string().optional(),
    endpoint: z.string().url().optional(),
    userAgent: z.string().trim().min(1).optional(),
    timeoutMs: z.number().int().positive().optional(),
  }),
  async check(ctx) {
    const endpoint = ctx.getOption<string>(
      'endpoint',
      'https://chatgpt.com/backend-api/wham/usage'
    );
    const userAgent = ctx.getOption<string>(
      'userAgent',
      CodexVersionService.getInstance().getUserAgent()
    );
    const timeoutMs = ctx.getOption<number>('timeoutMs', 15000);

    let accessToken: string;
    let accountId: string | null = null;

    const configuredApiKey = ctx.getOption<string>('apiKey', '').trim();
    if (configuredApiKey) {
      accessToken = parseAccessToken(configuredApiKey);
    } else {
      const provider =
        ctx.getOption<string>('oauthProvider', 'openai-codex').trim() || 'openai-codex';
      const oauthAccountId = ctx.getOption<string>('oauthAccountId', '').trim();
      const authManager = OAuthAuthManager.getInstance();

      const rawCreds = (
        oauthAccountId
          ? authManager.getCredentials(provider as OAuthProvider, oauthAccountId)
          : authManager.getCredentials(provider as OAuthProvider)
      ) as Record<string, unknown> | null;
      logger.debug(`[openai-codex-checker] resolveApiKey for '${ctx.checkerId}'`);

      let oauthApiKey: string;
      try {
        oauthApiKey = oauthAccountId
          ? await authManager.getApiKey(provider as OAuthProvider, oauthAccountId)
          : await authManager.getApiKey(provider as OAuthProvider);
      } catch {
        authManager.reload();
        oauthApiKey = oauthAccountId
          ? await authManager.getApiKey(provider as OAuthProvider, oauthAccountId)
          : await authManager.getApiKey(provider as OAuthProvider);
      }

      accessToken = parseAccessToken(oauthApiKey);
      const credentials = (
        oauthAccountId
          ? authManager.getCredentials(provider as OAuthProvider, oauthAccountId)
          : authManager.getCredentials(provider as OAuthProvider)
      ) as Record<string, unknown> | null;
      const fromCreds =
        typeof credentials?.accountId === 'string'
          ? credentials.accountId.trim()
          : typeof credentials?.chatgpt_account_id === 'string'
            ? credentials.chatgpt_account_id.trim()
            : '';
      accountId = fromCreds || null;
    }

    accountId = accountId ?? extractChatGPTAccountId(accessToken);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': userAgent,
      Version: CodexVersionService.getInstance().getVersion(),
    };
    if (accountId) headers['Chatgpt-Account-Id'] = accountId;

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);

    logger.silly(`[openai-codex-checker] Requesting usage for '${ctx.checkerId}' from ${endpoint}`);
    const response = await fetch(endpoint, {
      method: 'GET',
      headers,
      signal: abortController.signal,
    }).finally(() => clearTimeout(timeout));

    const bodyText = await response.text();
    if (!response.ok)
      throw new Error(`quota request failed with status ${response.status}: ${bodyText}`);

    let data: CodexUsageResponse;
    try {
      data = JSON.parse(bodyText) as CodexUsageResponse;
    } catch {
      throw new Error(`failed to parse codex usage response`);
    }

    if (!data.rate_limit) throw new Error(`codex usage response missing rate_limit`);

    const rateLimit = data.rate_limit;
    const meters: Meter[] = [];

    if (rateLimit.limit_reached) {
      meters.push(
        ctx.allowance({
          key: 'primary',
          label: 'Primary rate limit',
          unit: 'percentage',
          used: 100,
          remaining: 0,
          periodValue: 5,
          periodUnit: 'hour',
          periodCycle: 'rolling',
        })
      );
      return meters;
    }

    if (rateLimit.primary_window) {
      const m = buildMeterFromWindow(
        rateLimit.primary_window,
        'primary',
        'Primary rate limit',
        ctx
      );
      if (m) meters.push(m);
    }

    if (rateLimit.secondary_window) {
      const m = buildMeterFromWindow(
        rateLimit.secondary_window,
        'secondary',
        'Secondary rate limit',
        ctx
      );
      if (m) meters.push(m);
    }

    return meters;
  },
});
