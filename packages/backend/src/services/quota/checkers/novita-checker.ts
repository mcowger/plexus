import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { logger } from '../../../utils/logger';

interface NovitaBalanceResponse {
  availableBalance: string;
}

export default defineChecker({
  type: 'novita',
  optionsSchema: z.object({
    apiKey: z.string().min(1, 'Novita API key is required'),
    endpoint: z.string().url().optional(),
  }),
  async check(ctx) {
    const apiKey = ctx.requireOption<string>('apiKey');
    const endpoint = ctx.getOption<string>(
      'endpoint',
      'https://api.novita.ai/openapi/v1/billing/balance/detail'
    );

    logger.silly(`[novita] Calling ${endpoint}`);
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const data: NovitaBalanceResponse = await response.json();
    // Balance fields are in 0.0001 USD, convert to USD
    const remaining = parseFloat(data.availableBalance) / 10000;

    return [
      ctx.balance({
        key: 'balance',
        label: 'Account balance',
        unit: 'usd',
        remaining,
      }),
    ];
  },
});
