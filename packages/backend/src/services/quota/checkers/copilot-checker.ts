import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { OAuthAuthManager } from '../../oauth-auth-manager';
import type { OAuthProvider } from '@earendil-works/pi-ai/oauth';
import { logger } from '../../../utils/logger';

interface CopilotUsageResponse {
  quota_reset_date_utc?: string;
  quota_snapshots?: {
    premium_interactions?: {
      percent_remaining?: number;
      remaining?: number;
      entitlement?: number;
    };
  };
}

async function resolveApiKey(
  getOption: <T>(key: string, def: T) => T,
  checkerId: string
): Promise<string> {
  const configured = getOption<string>('apiKey', '').trim();
  if (configured) return configured;

  const provider = getOption<string>('oauthProvider', 'github-copilot').trim() || 'github-copilot';
  const oauthAccountId = getOption<string>('oauthAccountId', '').trim();
  const authManager = OAuthAuthManager.getInstance();

  const credentials = oauthAccountId
    ? authManager.getCredentials(provider as OAuthProvider, oauthAccountId)
    : authManager.getCredentials(provider as OAuthProvider);

  if (!credentials) {
    throw new Error(`No OAuth credentials found for provider '${provider}'`);
  }

  const refreshToken = (credentials as Record<string, unknown>)?.refresh as string | undefined;
  logger.debug(
    `resolveApiKey for '${checkerId}' — ` +
      `refresh=${refreshToken ? `present(${refreshToken.length} chars)` : 'MISSING'}`
  );
  if (refreshToken) return refreshToken;

  try {
    return oauthAccountId
      ? await authManager.getApiKey(provider as OAuthProvider, oauthAccountId)
      : await authManager.getApiKey(provider as OAuthProvider);
  } catch {
    authManager.reload();
    return oauthAccountId
      ? await authManager.getApiKey(provider as OAuthProvider, oauthAccountId)
      : await authManager.getApiKey(provider as OAuthProvider);
  }
}

export default defineChecker({
  type: 'copilot',
  displayName: 'GitHub Copilot',
  optionsSchema: z.object({
    apiKey: z.string().optional(),
    oauthAccountId: z.string().optional(),
    oauthProvider: z.string().optional(),
    endpoint: z.string().url().optional(),
    userAgent: z.string().trim().min(1).optional(),
    editorVersion: z.string().trim().min(1).optional(),
    apiVersion: z.string().trim().min(1).optional(),
    timeoutMs: z.number().int().positive().optional(),
  }),
  async check(ctx) {
    const apiKey = await resolveApiKey(ctx.getOption.bind(ctx), ctx.checkerId);
    const endpoint = ctx.getOption<string>(
      'endpoint',
      'https://api.github.com/copilot_internal/user'
    );
    const userAgent = ctx.getOption<string>('userAgent', 'GitHubCopilotChat/0.26.7');
    const editorVersion = ctx.getOption<string>('editorVersion', 'vscode/1.96.2');
    const apiVersion = ctx.getOption<string>('apiVersion', '2025-04-01');
    const timeoutMs = ctx.getOption<number>('timeoutMs', 15000);

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);

    logger.silly(`Requesting quota from ${endpoint}`);

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `token ${apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Editor-Version': editorVersion,
        'User-Agent': userAgent,
        'X-Github-Api-Version': apiVersion,
      },
      signal: abortController.signal,
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const data: CopilotUsageResponse = await response.json();
    logger.silly(`API response: ${JSON.stringify(data)}`);

    const resetDate = data.quota_reset_date_utc
      ? new Date(data.quota_reset_date_utc).toISOString()
      : undefined;
    const pi = data.quota_snapshots?.premium_interactions;
    if (!pi) return [];

    if (pi.entitlement !== undefined && pi.remaining !== undefined) {
      const limit = pi.entitlement;
      const remaining = pi.remaining;
      const used = limit - remaining;
      return [
        ctx.allowance({
          key: 'premium_interactions',
          label: 'Premium interactions',
          unit: 'requests',
          limit,
          used,
          remaining,
          periodValue: 1,
          periodUnit: 'month',
          periodCycle: 'fixed',
          resetsAt: resetDate,
        }),
      ];
    }

    if (pi.percent_remaining !== undefined) {
      const remaining = pi.percent_remaining;
      const used = 100 - remaining;
      return [
        ctx.allowance({
          key: 'premium_interactions',
          label: 'Premium interactions',
          unit: 'percentage',
          used,
          remaining,
          periodValue: 1,
          periodUnit: 'month',
          periodCycle: 'fixed',
          resetsAt: resetDate,
        }),
      ];
    }

    return [];
  },
});
