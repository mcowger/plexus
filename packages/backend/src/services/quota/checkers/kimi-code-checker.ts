import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { logger } from '../../../utils/logger';

interface KimiUsage {
  limit: string;
  used: string;
  remaining: string;
  resetTime: string;
}

interface KimiLimit {
  window: { duration: number; timeUnit: string };
  detail: { limit: string; remaining: string; resetTime: string };
}

interface KimiUsageResponse {
  usage?: KimiUsage;
  limits?: KimiLimit[];
}

function resolvePeriod(window: { duration: number; timeUnit: string }): {
  periodValue: number;
  periodUnit: 'minute' | 'hour' | 'day' | 'week' | 'month';
  periodCycle: 'fixed' | 'rolling';
} {
  let totalMinutes = window.duration;
  if (window.timeUnit === 'TIME_UNIT_HOUR') totalMinutes *= 60;
  else if (window.timeUnit === 'TIME_UNIT_DAY') totalMinutes *= 60 * 24;

  if (totalMinutes === 300) return { periodValue: 5, periodUnit: 'hour', periodCycle: 'rolling' };
  if (totalMinutes <= 60) return { periodValue: 1, periodUnit: 'hour', periodCycle: 'fixed' };
  if (totalMinutes <= 1440) return { periodValue: 1, periodUnit: 'day', periodCycle: 'fixed' };
  if (totalMinutes <= 10080) return { periodValue: 7, periodUnit: 'day', periodCycle: 'rolling' };
  return { periodValue: 1, periodUnit: 'month', periodCycle: 'fixed' };
}

export default defineChecker({
  type: 'kimi-code',
  displayName: 'Kimi Code',
  optionsSchema: z.object({
    apiKey: z.string().min(1, 'Kimi Code API key is required'),
    endpoint: z.string().url().optional(),
  }),
  async check(ctx) {
    const apiKey = ctx.requireOption<string>('apiKey');
    const endpoint = ctx.getOption<string>('endpoint', 'https://api.kimi.com/coding/v1/usages');

    logger.debug(`Fetching usage from ${endpoint}`);
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const data: KimiUsageResponse = await response.json();
    const meters = [];

    if (data.usage) {
      meters.push(
        ctx.allowance({
          key: 'usage_limit',
          label: 'Usage limit',
          unit: 'requests',
          limit: Number(data.usage.limit),
          used: Number(data.usage.used),
          remaining: Number(data.usage.remaining),
          periodValue: 5,
          periodUnit: 'hour',
          periodCycle: 'rolling',
          resetsAt: new Date(data.usage.resetTime).toISOString(),
        })
      );
    }

    if (data.limits) {
      for (let i = 0; i < data.limits.length; i++) {
        const entry = data.limits[i]!;
        if (!entry.detail) continue;
        const limit = Number(entry.detail.limit);
        const remaining = Number(entry.detail.remaining);
        const period = resolvePeriod(entry.window);
        meters.push(
          ctx.allowance({
            key: `rate_limit_${i}`,
            label: 'Rate limit',
            unit: 'requests',
            limit,
            used: limit - remaining,
            remaining,
            ...period,
            resetsAt: new Date(entry.detail.resetTime).toISOString(),
          })
        );
      }
    }

    logger.debug(`Returning ${meters.length} meters`);
    return meters;
  },
});
