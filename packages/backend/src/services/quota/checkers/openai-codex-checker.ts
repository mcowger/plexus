import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { OAuthAuthManager, type GetApiKeyOptions } from '../../oauth/oauth-auth-manager';
import { CodexVersionService } from '../../oauth/codex-version-service';
import type { OAuthProvider } from '../../oauth/oauth-providers';
import { logger } from '../../../utils/logger';
import type { Meter } from '../../../types/meter';
import type { MeterContext } from '../checker-registry';

interface CodexUsageWindow {
  used_percent?: number;
  reset_at?: number;
}

type CodexUsageWindowKey = 'primary' | 'secondary';

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

// OpenAI Codex access tokens typically have a 1-hour lifetime. Proactively
// refresh whenever the token will expire within the next 10 minutes.
export const OPENAI_CODEX_OAUTH_EXPIRY_BUFFER_MS = 10 * 60 * 1000;

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

function windowPeriod(key: CodexUsageWindowKey): {
  periodValue: number;
  periodUnit: 'hour' | 'week';
  periodCycle: 'rolling';
} {
  if (key === 'primary') return { periodValue: 5, periodUnit: 'hour', periodCycle: 'rolling' };
  return { periodValue: 1, periodUnit: 'week', periodCycle: 'rolling' };
}

function buildMeterFromWindow(
  window: CodexUsageWindow,
  key: CodexUsageWindowKey,
  label: string,
  ctx: Pick<MeterContext, 'allowance'>
): Meter | null {
  const usedPercent = window.used_percent;
  const used =
    typeof usedPercent === 'number' && Number.isFinite(usedPercent)
      ? Math.min(Math.max(usedPercent, 0), 100)
      : 0;
  const remaining = Math.max(0, 100 - used);
  const period = windowPeriod(key);
  const resetsAt =
    typeof window.reset_at === 'number' && window.reset_at > 0
      ? new Date(window.reset_at * 1000).toISOString()
      : undefined;
  return ctx.allowance({ key, label, unit: 'percentage', used, remaining, ...period, resetsAt });
}

async function resolveApiKey(
  ctx: { getOption<T>(key: string, def: T): T; checkerId: string },
  options?: { forceRefresh?: boolean; signal?: AbortSignal }
): Promise<string> {
  const configured = ctx.getOption<string>('apiKey', '').trim();
  if (configured) return parseAccessToken(configured);

  const provider = ctx.getOption<string>('oauthProvider', 'openai-codex').trim() || 'openai-codex';
  const oauthAccountId = ctx.getOption<string>('oauthAccountId', '').trim();
  const authManager = OAuthAuthManager.getInstance();
  const refreshOptions: GetApiKeyOptions = {
    refreshIfExpiringWithinMs:
      provider === 'openai-codex' ? OPENAI_CODEX_OAUTH_EXPIRY_BUFFER_MS : undefined,
    ...(options?.forceRefresh ? { forceRefresh: true } : {}),
    ...(options?.signal ? { signal: options.signal } : {}),
  };

  logger.debug(`resolveApiKey for '${ctx.checkerId}'`);

  let resolvedAuth: string;
  try {
    resolvedAuth = oauthAccountId
      ? await authManager.getApiKey(provider as OAuthProvider, oauthAccountId, refreshOptions)
      : await authManager.getApiKey(provider as OAuthProvider, undefined, refreshOptions);
  } catch (err) {
    if (options?.signal?.aborted || options?.forceRefresh) throw err;
    await authManager.reload();
    resolvedAuth = oauthAccountId
      ? await authManager.getApiKey(provider as OAuthProvider, oauthAccountId, refreshOptions)
      : await authManager.getApiKey(provider as OAuthProvider, undefined, refreshOptions);
  }
  return parseAccessToken(resolvedAuth);
}

function resolveCodexAccountId(
  ctx: { getOption<T>(key: string, def: T): T },
  rawInput: string
): string | null {
  const accountClaim = extractChatGPTAccountId(rawInput);
  if (accountClaim) return accountClaim;

  const configured = ctx.getOption<string>('apiKey', '').trim();
  if (configured) return null;

  const provider = ctx.getOption<string>('oauthProvider', 'openai-codex').trim() || 'openai-codex';
  const oauthAccountId = ctx.getOption<string>('oauthAccountId', '').trim();
  const authManager = OAuthAuthManager.getInstance();
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
  return fromCreds || null;
}

export default defineChecker({
  type: 'openai-codex',
  displayName: 'OpenAI Codex',
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

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);

    let bodyText: string;
    try {
      let resolvedKey = await resolveApiKey(ctx, { signal: abortController.signal });
      let accountId = resolveCodexAccountId(ctx, resolvedKey);

      const headers: Record<string, string> = {
        Authorization: `Bearer ${resolvedKey}`,
        'Content-Type': 'application/json',
        'User-Agent': userAgent,
        Version: CodexVersionService.getInstance().getVersion(),
      };
      if (accountId) headers['Chatgpt-Account-Id'] = accountId;

      logger.silly(`Requesting usage for '${ctx.checkerId}' from ${endpoint}`);
      let response = await fetch(endpoint, {
        method: 'GET',
        headers,
        signal: abortController.signal,
      });

      const isOAuth = !ctx.getOption<string>('apiKey', '').trim();
      if (response.status === 401 && isOAuth) {
        logger.warn(
          `OpenAI Codex quota checker: received 401 for '${ctx.checkerId}', attempting reactive force-refresh`
        );
        let refreshedKey: string | undefined;
        try {
          refreshedKey = await resolveApiKey(ctx, {
            forceRefresh: true,
            signal: abortController.signal,
          });
        } catch (refreshErr) {
          if (abortController.signal.aborted) throw refreshErr;
          logger.warn(
            `OpenAI Codex quota checker: reactive force-refresh failed for '${ctx.checkerId}': ${refreshErr}`
          );
        }

        if (refreshedKey) {
          resolvedKey = refreshedKey;
          accountId = resolveCodexAccountId(ctx, resolvedKey);
          headers.Authorization = `Bearer ${resolvedKey}`;
          if (accountId) {
            headers['Chatgpt-Account-Id'] = accountId;
          } else {
            delete headers['Chatgpt-Account-Id'];
          }

          response = await fetch(endpoint, {
            method: 'GET',
            headers,
            signal: abortController.signal,
          });
        }
      }

      bodyText = await response.text();
      if (!response.ok)
        throw new Error(`quota request failed with status ${response.status}: ${bodyText}`);
    } finally {
      clearTimeout(timeout);
    }

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
          ...windowPeriod('primary'),
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
