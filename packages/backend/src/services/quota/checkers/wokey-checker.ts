import { z } from 'zod';

import { logger } from '../../../utils/logger';
import { defineChecker } from '../checker-registry';

interface WokeyBalanceResponse {
  userId?: string;
  availableUsd: number;
  reservedUsd?: number;
}

export default defineChecker({
  type: 'wokey',
  displayName: 'Wokey',
  optionsSchema: z.object({
    apiKey: z.string().min(1, 'Wokey API key is required'),
    endpoint: z.string().url().optional(),
  }),
  async check(ctx) {
    const apiKey = ctx.requireOption<string>('apiKey');
    const endpoint = ctx.getOption<string>('endpoint', 'https://api.wokey.ai/v1/dashboard/balance');

    logger.silly(`Calling ${endpoint}`);
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `HTTP ${response.status}: ${response.statusText}${body ? ` - ${body.slice(0, 200)}` : ''}`
      );
    }

    const data: WokeyBalanceResponse = await response.json();
    if (typeof data.availableUsd !== 'number' || !Number.isFinite(data.availableUsd)) {
      throw new Error('Unexpected response: missing availableUsd');
    }

    return [
      ctx.balance({
        key: 'balance',
        label: 'Account balance',
        unit: 'usd',
        remaining: data.availableUsd,
      }),
    ];
  },
});
