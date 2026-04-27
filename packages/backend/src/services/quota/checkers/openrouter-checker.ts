import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { logger } from '../../../utils/logger';

interface OpenRouterCreditsResponse {
  data: {
    total_credits: number;
    total_usage: number;
  };
}

export default defineChecker({
  type: 'openrouter',
  optionsSchema: z.object({
    apiKey: z.string().min(1, 'OpenRouter management key is required'),
    endpoint: z.string().url().optional(),
  }),
  async check(ctx) {
    const apiKey = ctx.requireOption<string>('apiKey');
    const endpoint = ctx.getOption<string>('endpoint', 'https://openrouter.ai/api/v1/credits');

    logger.silly(`[openrouter] Calling ${endpoint}`);
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const data: OpenRouterCreditsResponse = await response.json();
    const { total_credits, total_usage } = data.data;
    const remaining = total_credits - total_usage;

    return [
      ctx.balance({
        key: 'balance',
        label: 'Account credits',
        unit: 'usd',
        limit: total_credits,
        used: total_usage,
        remaining,
      }),
    ];
  },
});
