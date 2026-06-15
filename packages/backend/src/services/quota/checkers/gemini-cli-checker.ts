import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { OAuthAuthManager } from '../../oauth-auth-manager';
import type { OAuthProvider } from '@earendil-works/pi-ai/oauth';
import { logger } from '../../../utils/logger';

interface GeminiBucket {
  name?: string;
  limit?: string;
  remaining?: string;
  resetAt?: string | number;
  remainingFraction?: number;
  description?: string;
}

interface GeminiQuotaResponse {
  buckets?: GeminiBucket[];
  quota?: { buckets?: GeminiBucket[] };
  userQuota?: { buckets?: GeminiBucket[] };
}

async function resolveApiKey(ctx: {
  getOption<T>(key: string, def: T): T;
  checkerId: string;
}): Promise<string> {
  const configuredApiKey = ctx.getOption<string>('apiKey', '').trim();
  if (configuredApiKey) return configuredApiKey;

  const provider =
    ctx.getOption<string>('oauthProvider', 'google-gemini-cli').trim() || 'google-gemini-cli';
  const oauthAccountId = ctx.getOption<string>('oauthAccountId', '').trim();
  const authManager = OAuthAuthManager.getInstance();

  logger.debug(`resolveApiKey for '${ctx.checkerId}'`);

  let apiKeyResult: string;
  try {
    apiKeyResult = oauthAccountId
      ? await authManager.getApiKey(provider as OAuthProvider, oauthAccountId)
      : await authManager.getApiKey(provider as OAuthProvider);
  } catch {
    authManager.reload();
    logger.info(`Reloaded OAuth auth file and retrying for provider '${provider}'.`);
    apiKeyResult = oauthAccountId
      ? await authManager.getApiKey(provider as OAuthProvider, oauthAccountId)
      : await authManager.getApiKey(provider as OAuthProvider);
  }

  // Handle object or JSON-encoded token from pi-ai
  if (
    typeof apiKeyResult === 'object' &&
    apiKeyResult !== null &&
    'token' in (apiKeyResult as object)
  ) {
    return (apiKeyResult as { token: string }).token;
  }
  if (typeof apiKeyResult === 'string' && apiKeyResult.startsWith('{')) {
    try {
      const parsed = JSON.parse(apiKeyResult) as { token?: string };
      if (parsed.token) return parsed.token;
    } catch {}
  }
  return apiKeyResult;
}

function extractBuckets(data: GeminiQuotaResponse): GeminiBucket[] {
  if (Array.isArray(data.buckets)) return data.buckets;
  if (data.quota && Array.isArray(data.quota.buckets)) return data.quota.buckets;
  if (data.userQuota && Array.isArray(data.userQuota.buckets)) return data.userQuota.buckets;
  return [];
}

export default defineChecker({
  type: 'gemini-cli',
  displayName: 'Gemini CLI',
  optionsSchema: z.object({
    apiKey: z.string().optional(),
    oauthAccountId: z.string().optional(),
    oauthProvider: z.string().optional(),
    endpoint: z.string().url().optional(),
  }),
  async check(ctx) {
    const apiKey = await resolveApiKey(ctx);
    const endpoint = ctx.getOption<string>(
      'endpoint',
      'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota'
    );

    logger.silly(`Requesting quota from ${endpoint}`);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: '{}',
    });

    const bodyText = await response.text();
    if (!response.ok)
      throw new Error(`quota request failed with status ${response.status}: ${bodyText}`);

    let data: GeminiQuotaResponse;
    try {
      data = JSON.parse(bodyText) as GeminiQuotaResponse;
    } catch {
      throw new Error('failed to parse gemini quota response');
    }

    const buckets = extractBuckets(data);
    if (!buckets || buckets.length === 0) {
      logger.debug(`No buckets found in response`);
      return [];
    }

    // Aggregate by model type, keeping worst (lowest) remaining fraction
    let proMin = 1;
    let flashMin = 1;
    let hasProModel = false;
    let hasFlashModel = false;

    for (const bucket of buckets) {
      const model = bucket.name || bucket.description || 'unknown';
      const frac = bucket.remainingFraction ?? 1;
      if (model.toLowerCase().includes('pro')) {
        hasProModel = true;
        if (frac < proMin) proMin = frac;
      }
      if (model.toLowerCase().includes('flash')) {
        hasFlashModel = true;
        if (frac < flashMin) flashMin = frac;
      }
    }

    const meters = [];

    if (hasProModel) {
      meters.push(
        ctx.allowance({
          key: 'pro',
          label: 'Pro Plan Quota',
          scope: 'pro',
          unit: 'percentage',
          used: (1 - proMin) * 100,
          remaining: proMin * 100,
          periodValue: 5,
          periodUnit: 'hour',
          periodCycle: 'rolling',
        })
      );
    }

    if (hasFlashModel) {
      meters.push(
        ctx.allowance({
          key: 'flash',
          label: 'Flash Plan Quota',
          scope: 'flash',
          unit: 'percentage',
          used: (1 - flashMin) * 100,
          remaining: flashMin * 100,
          periodValue: 5,
          periodUnit: 'hour',
          periodCycle: 'rolling',
        })
      );
    }

    // Fall back to per-bucket meters if no Pro/Flash matched
    if (meters.length === 0) {
      for (let i = 0; i < buckets.length; i++) {
        const bucket = buckets[i]!;
        const remainingFraction = bucket.remainingFraction ?? 1;
        const label = bucket.description || bucket.name || `Gemini Quota ${i + 1}`;
        meters.push(
          ctx.allowance({
            key: `bucket_${i}`,
            label,
            unit: 'percentage',
            used: (1 - remainingFraction) * 100,
            remaining: remainingFraction * 100,
            periodValue: 5,
            periodUnit: 'hour',
            periodCycle: 'rolling',
          })
        );
      }
    }

    return meters;
  },
});
