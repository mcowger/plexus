import { z } from 'zod';

import { defineChecker } from '../checker-registry';

interface SyntheticWeeklyPercentLimit {
  nextRegenAt?: string;
  percentRemaining?: number;
  nextRegenPercent?: number;
}

interface SyntheticQuotaResponse {
  search?: {
    hourly?: {
      limit?: number;
      requests?: number;
      remaining?: number;
      renewsAt?: string;
    };
  };
  planWeeklyLimit?: SyntheticWeeklyPercentLimit | null;
  rollingFiveHourLimit?: {
    nextTickAt?: string;
    remaining?: number;
    max?: number;
  };
}

function parsePercent(val: unknown): number | undefined {
  if (typeof val !== 'number' || !Number.isFinite(val)) return undefined;
  return Math.min(100, Math.max(0, val));
}

function toIsoDate(val?: string): string | undefined {
  if (!val) return undefined;
  const date = new Date(val);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export default defineChecker({
  type: 'synthetic',
  displayName: 'Synthetic',
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
          label: '5-hour',
          unit: 'requests',
          limit: max,
          used,
          remaining,
          periodValue: 5,
          periodUnit: 'hour',
          periodCycle: 'rolling',
          resetsAt: toIsoDate(nextTickAt),
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
          resetsAt: toIsoDate(renewsAt),
        })
      );
    }

    const planPercent = parsePercent(data.planWeeklyLimit?.percentRemaining);
    if (planPercent !== undefined) {
      meters.push(
        ctx.allowance({
          key: 'weekly_credits',
          label: 'Weekly credits',
          unit: 'percentage',
          used: 100 - planPercent,
          remaining: planPercent,
          periodValue: 7,
          periodUnit: 'day',
          periodCycle: 'rolling',
          resetsAt: toIsoDate(data.planWeeklyLimit?.nextRegenAt),
        })
      );
    }

    return meters;
  },
});
