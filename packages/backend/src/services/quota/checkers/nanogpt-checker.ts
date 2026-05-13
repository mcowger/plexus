import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { logger } from '../../../utils/logger';

interface NanoGPTUsageWindow {
  used?: number;
  remaining?: number;
  resetAt?: number;
}

interface NanoGPTQuotaResponse {
  active?: boolean;
  limits?: {
    weeklyInputTokens?: number | null;
    dailyInputTokens?: number | null;
    dailyImages?: number | null;
  };
  period?: { currentPeriodEnd?: string };
  dailyImages?: NanoGPTUsageWindow | null;
  dailyInputTokens?: NanoGPTUsageWindow | null;
  weeklyInputTokens?: NanoGPTUsageWindow | null;
  state?: 'active' | 'grace' | 'inactive';
  graceUntil?: string | null;
}

function normalizeApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  const unquoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1).trim()
      : trimmed;
  const bearerStripped = unquoted.toLowerCase().startsWith('bearer ')
    ? unquoted.slice(7).trim()
    : unquoted;
  const normalized = bearerStripped.replace(/\s+/g, '');
  if (!normalized) throw new Error('NanoGPT API key is empty after normalization');
  return normalized;
}

export default defineChecker({
  type: 'nanogpt',
  displayName: 'NanoGPT',
  optionsSchema: z.object({
    apiKey: z.string().min(1, 'NanoGPT API key is required'),
    endpoint: z.string().url().optional(),
  }),
  async check(ctx) {
    const rawApiKey = ctx.requireOption<string>('apiKey');
    const apiKey = normalizeApiKey(rawApiKey);
    const endpoint = ctx.getOption<string>(
      'endpoint',
      'https://nano-gpt.com/api/subscription/v1/usage'
    );

    const authStrategies: HeadersInit[] = [
      { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      { 'x-api-key': apiKey, Accept: 'application/json' },
      { Authorization: `Bearer ${apiKey}`, 'x-api-key': apiKey, Accept: 'application/json' },
    ];

    let data: NanoGPTQuotaResponse | null = null;
    let lastError: string | null = null;

    for (const headers of authStrategies) {
      const response = await fetch(endpoint, { method: 'GET', headers });
      if (response.ok) {
        data = await response.json();
        break;
      }
      const body = await response.text().catch(() => '');
      lastError = `HTTP ${response.status}: ${response.statusText}${body ? ` - ${body.slice(0, 200)}` : ''}`;
      if (response.status !== 401 && response.status !== 403) throw new Error(lastError);
    }

    if (!data) throw new Error(lastError ?? 'NanoGPT quota check failed');

    if (data.active === false && data.state === 'inactive') {
      throw new Error('NanoGPT subscription is inactive');
    }

    if (data.state === 'grace') {
      logger.debug(
        `Account is in grace period${data.graceUntil ? ` until ${data.graceUntil}` : ''}`
      );
    }

    const meters = [];

    if (data.weeklyInputTokens) {
      const w = data.weeklyInputTokens;
      meters.push(
        ctx.allowance({
          key: 'weekly_tokens',
          label: 'Weekly input tokens',
          unit: 'tokens',
          limit: data.limits?.weeklyInputTokens ?? undefined,
          used: w.used,
          remaining: w.remaining,
          periodValue: 7,
          periodUnit: 'day',
          periodCycle: 'rolling',
          resetsAt: typeof w.resetAt === 'number' ? new Date(w.resetAt).toISOString() : undefined,
        })
      );
    }

    if (data.dailyInputTokens) {
      const d = data.dailyInputTokens;
      meters.push(
        ctx.allowance({
          key: 'daily_tokens',
          label: 'Daily input tokens',
          unit: 'tokens',
          limit: data.limits?.dailyInputTokens ?? undefined,
          used: d.used,
          remaining: d.remaining,
          periodValue: 1,
          periodUnit: 'day',
          periodCycle: 'fixed',
          resetsAt: typeof d.resetAt === 'number' ? new Date(d.resetAt).toISOString() : undefined,
        })
      );
    }

    if (data.dailyImages) {
      const i = data.dailyImages;
      meters.push(
        ctx.allowance({
          key: 'daily_images',
          label: 'Daily image generations',
          unit: 'images',
          limit: data.limits?.dailyImages ?? undefined,
          used: i.used,
          remaining: i.remaining,
          periodValue: 1,
          periodUnit: 'day',
          periodCycle: 'fixed',
          resetsAt: typeof i.resetAt === 'number' ? new Date(i.resetAt).toISOString() : undefined,
        })
      );
    }

    if (meters.length === 0) {
      throw new Error(
        `NanoGPT quota response (state=${data.state ?? 'unknown'}) had no usage windows`
      );
    }

    logger.debug(`Returning ${meters.length} meter(s)`);
    return meters;
  },
});
