import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { logger } from '../../../utils/logger';

interface WisdomGateUsageResponse {
  object: string;
  total_usage: number;
  total_available: number;
}

export default defineChecker({
  type: 'wisdomgate',
  optionsSchema: z.object({
    session: z.string().trim().min(1, 'Session cookie is required'),
    endpoint: z.string().url().optional(),
  }),
  async check(ctx) {
    const session = ctx.requireOption<string>('session');
    const endpoint = ctx.getOption<string>(
      'endpoint',
      'https://wisgate.ai/api/dashboard/billing/usage/details'
    );

    logger.silly(`[wisdomgate] Calling ${endpoint}`);
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Cookie: `session=${session}`, Accept: 'application/json' },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const data: WisdomGateUsageResponse = await response.json();
    const used = data.total_usage;
    const remaining = data.total_available;
    const limit = used + remaining;

    return [
      ctx.allowance({
        key: 'monthly_credits',
        label: 'Wisdom Gate subscription',
        unit: 'usd',
        limit,
        used,
        remaining,
        periodValue: 1,
        periodUnit: 'month',
        periodCycle: 'fixed',
      }),
    ];
  },
});
