import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { logger } from '../../../utils/logger';

interface HyperCreditsResponse {
  balance: number;
}

export default defineChecker({
  type: 'hyper',
  displayName: 'Hyper',
  optionsSchema: z.object({
    apiKey: z.string().min(1, 'Hyper API key is required'),
    endpoint: z.url().optional(),
  }),
  async check(ctx) {
    const apiKey = ctx.requireOption<string>('apiKey');
    const endpoint = ctx.getOption<string>('endpoint', 'https://hyper.charm.land/v1/credits');

    logger.silly(`Calling ${endpoint}`);
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `HTTP ${response.status}: ${response.statusText}${body ? ` - ${body.slice(0, 200)}` : ''}`
      );
    }

    const data: HyperCreditsResponse = await response.json();
    const remaining = Number(data.balance);
    if (!Number.isFinite(remaining)) {
      throw new Error(`Invalid balance: ${String(data.balance)}`);
    }

    return [
      ctx.balance({
        key: 'balance',
        label: 'Account balance',
        unit: 'credits',
        remaining,
      }),
    ];
  },
});
