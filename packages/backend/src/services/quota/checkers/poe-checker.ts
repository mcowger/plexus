import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { logger } from '../../../utils/logger';

interface PoeBalanceResponse {
  current_point_balance?: number;
}

export default defineChecker({
  type: 'poe',
  optionsSchema: z.object({
    apiKey: z.string().min(1, 'POE API key is required'),
    endpoint: z.string().url().optional(),
  }),
  async check(ctx) {
    const apiKey = ctx.requireOption<string>('apiKey');
    const endpoint = ctx.getOption<string>('endpoint', 'https://api.poe.com/usage/current_balance');

    logger.silly(`[poe] Calling ${endpoint}`);
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const data: PoeBalanceResponse = await response.json();
    const remaining = Number(data.current_point_balance);
    if (!Number.isFinite(remaining)) {
      throw new Error(`Invalid balance: ${String(data.current_point_balance)}`);
    }

    return [ctx.balance({ key: 'balance', label: 'POE point balance', unit: 'points', remaining })];
  },
});
