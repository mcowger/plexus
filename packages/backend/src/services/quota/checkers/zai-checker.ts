import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { logger } from '../../../utils/logger';

interface ZAILimit {
  type: 'TOKENS_LIMIT' | 'TIME_LIMIT';
  percentage: number;
  currentValue?: number;
  remaining?: number;
  total?: number;
  nextResetTime?: number;
}

interface ZAIQuotaResponse {
  success: boolean;
  data?: { limits?: ZAILimit[] };
}

export default defineChecker({
  type: 'zai',
  optionsSchema: z.object({
    apiKey: z.string().min(1, 'ZAI API key is required'),
    endpoint: z.string().url().optional(),
  }),
  async check(ctx) {
    const apiKey = ctx.requireOption<string>('apiKey');
    const endpoint = ctx.getOption<string>(
      'endpoint',
      'https://api.z.ai/api/monitor/usage/quota/limit'
    );

    logger.silly(`[zai-checker] Calling ${endpoint}`);
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Accept-Language': 'en-US,en',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const data: ZAIQuotaResponse = await response.json();
    const limits = data.data?.limits ?? [];
    const meters = [];

    for (const limit of limits) {
      if (limit.type === 'TOKENS_LIMIT') {
        meters.push(
          ctx.allowance({
            key: 'five_hour',
            label: 'Token usage (5 hour)',
            unit: 'percentage',
            used: limit.percentage,
            remaining: 100 - limit.percentage,
            periodValue: 5,
            periodUnit: 'hour',
            periodCycle: 'rolling',
          })
        );
      } else if (limit.type === 'TIME_LIMIT') {
        meters.push(
          ctx.allowance({
            key: 'monthly',
            label: 'MCP usage (monthly)',
            unit: 'requests',
            limit: limit.total ?? undefined,
            used: limit.currentValue,
            remaining: limit.remaining,
            periodValue: 1,
            periodUnit: 'month',
            periodCycle: 'fixed',
            resetsAt: limit.nextResetTime ? new Date(limit.nextResetTime).toISOString() : undefined,
          })
        );
      }
    }

    logger.silly(`[zai-checker] Returning ${meters.length} meters`);
    return meters;
  },
});
