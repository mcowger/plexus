import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { OAuthAuthManager } from '../../oauth-auth-manager';
import type { OAuthProvider } from '@earendil-works/pi-ai/oauth';
import { logger } from '../../../utils/logger';

interface UsageWindow {
  utilization: number;
  resets_at: string;
}

interface OAuthUsageResponse {
  five_hour: UsageWindow | null;
  seven_day: UsageWindow | null;
  [key: string]: unknown;
}

async function resolveApiKey(ctx: {
  getOption<T>(key: string, def: T): T;
  checkerId: string;
}): Promise<string> {
  const configured = ctx.getOption<string>('apiKey', '').trim();
  if (configured) return configured;

  const provider = ctx.getOption<string>('oauthProvider', 'anthropic').trim() || 'anthropic';
  const oauthAccountId = ctx.getOption<string>('oauthAccountId', '').trim();
  const authManager = OAuthAuthManager.getInstance();

  try {
    return oauthAccountId
      ? await authManager.getApiKey(provider as OAuthProvider, oauthAccountId)
      : await authManager.getApiKey(provider as OAuthProvider);
  } catch {
    authManager.reload();
    logger.info(`Reloaded OAuth auth file and retrying for '${provider}'`);
    return oauthAccountId
      ? await authManager.getApiKey(provider as OAuthProvider, oauthAccountId)
      : await authManager.getApiKey(provider as OAuthProvider);
  }
}

export default defineChecker({
  type: 'claude-code',
  displayName: 'Claude Code',
  optionsSchema: z.object({
    apiKey: z.string().optional(),
    oauthAccountId: z.string().optional(),
    oauthProvider: z.string().optional(),
    endpoint: z.string().url().optional(),
  }),
  async check(ctx) {
    const apiKey = await resolveApiKey(ctx);
    const endpoint = ctx.getOption<string>('endpoint', 'https://api.anthropic.com/api/oauth/usage');

    logger.silly(`Fetching usage from ${endpoint}`);
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'anthropic-beta': 'oauth-2025-04-20',
      },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const usage = (await response.json()) as OAuthUsageResponse;
    logger.silly(`Usage: ${JSON.stringify(usage)}`);

    const meters = [];

    if (usage.five_hour) {
      meters.push(
        ctx.allowance({
          key: 'five_hour',
          label: '5-hour quota',
          unit: 'percentage',
          used: usage.five_hour.utilization,
          remaining: 100 - usage.five_hour.utilization,
          periodValue: 5,
          periodUnit: 'hour',
          periodCycle: 'rolling',
          resetsAt: new Date(usage.five_hour.resets_at).toISOString(),
        })
      );
    }

    if (usage.seven_day) {
      meters.push(
        ctx.allowance({
          key: 'weekly',
          label: 'Weekly quota',
          unit: 'percentage',
          used: usage.seven_day.utilization,
          remaining: 100 - usage.seven_day.utilization,
          periodValue: 7,
          periodUnit: 'day',
          periodCycle: 'rolling',
          resetsAt: new Date(usage.seven_day.resets_at).toISOString(),
        })
      );
    }

    logger.silly(`Returning ${meters.length} meters`);
    return meters;
  },
});
