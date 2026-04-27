import { defineChecker } from '../checker-registry';
import { z } from 'zod';

interface SyntheticQuotaResponse {
  search?: {
    hourly?: {
      limit?: number;
      requests?: number;
      remaining?: number;
      renewsAt?: string;
    };
  };
  weeklyTokenLimit?: {
    nextRegenAt?: string;
    maxCredits?: string;
    remainingCredits?: string;
  };
  rollingFiveHourLimit?: {
    nextTickAt?: string;
    remaining?: number;
    max?: number;
  };
}

function parseCredits(val?: string): number | undefined {
  if (!val) return undefined;
  const num = parseFloat(val.replace('$', ''));
  return isNaN(num) ? undefined : num;
}

export default defineChecker({
  type: 'synthetic',
  optionsSchema: z.object({
    apiKey: z.string().optional(),
    endpoint: z.string().url().optional(),
    maxUtilizationPercent: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .describe(
        'Maximum utilization percentage before the provider is placed on cooldown (default: 99).'
      ),
  }),
  async check(ctx) {
    const apiKey = ctx.getOption<string>('apiKey', '');
    const endpoint = ctx.getOption<string>('endpoint', 'https://api.synthetic.new/v2/quotas');

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const data: SyntheticQuotaResponse = await response.json();
    const meters = [];

    if (data.rollingFiveHourLimit) {
      const { remaining, max, nextTickAt } = data.rollingFiveHourLimit;
      const used = max !== undefined && remaining !== undefined ? max - remaining : undefined;
      meters.push(
        ctx.allowance({
          key: 'rolling_5h',
          label: 'Rolling 5-hour limit',
          unit: 'requests',
          limit: max,
          used,
          remaining,
          periodValue: 5,
          periodUnit: 'hour',
          periodCycle: 'rolling',
          resetsAt: nextTickAt ? new Date(nextTickAt).toISOString() : undefined,
        })
      );
    }

    if (data.search?.hourly) {
      const { limit, requests: used, remaining, renewsAt } = data.search.hourly;
      meters.push(
        ctx.allowance({
          key: 'search_hourly',
          label: 'Search',
          scope: 'search',
          unit: 'requests',
          limit,
          used,
          remaining,
          periodValue: 1,
          periodUnit: 'hour',
          periodCycle: 'fixed',
          resetsAt: renewsAt ? new Date(renewsAt).toISOString() : undefined,
        })
      );
    }

    if (data.weeklyTokenLimit) {
      const { maxCredits, remainingCredits, nextRegenAt } = data.weeklyTokenLimit;
      const parsedMax = parseCredits(maxCredits);
      const parsedRemaining = parseCredits(remainingCredits);
      const parsedUsed =
        parsedMax !== undefined && parsedRemaining !== undefined
          ? parsedMax - parsedRemaining
          : undefined;
      meters.push(
        ctx.allowance({
          key: 'weekly_credits',
          label: 'Weekly token credits',
          unit: 'usd',
          limit: parsedMax,
          used: parsedUsed,
          remaining: parsedRemaining,
          periodValue: 7,
          periodUnit: 'day',
          periodCycle: 'rolling',
          resetsAt: nextRegenAt ? new Date(nextRegenAt).toISOString() : undefined,
        })
      );
    }

    return meters;
  },
});
