import { z } from 'zod';

import { logger } from '../../../utils/logger';
import { defineChecker } from '../checker-registry';

interface OllamaBalanceResponse {
  included?:
    | {
        balance_usd: number;
        allowance_usd: number;
        period: { from: string; until: string };
      }
    | {
        session?: { remaining_percent: number; resets_at: string };
        weekly?: { remaining_percent: number; resets_at: string };
      };
  purchased?: { balance_usd: number };
}

export default defineChecker({
  type: 'ollama',
  displayName: 'Ollama',
  optionsSchema: z.object({
    apiKey: z.string().min(1, 'Ollama API key is required'),
    endpoint: z.string().url().optional(),
  }),
  async check(ctx) {
    const apiKey = ctx.requireOption<string>('apiKey');
    const endpoint = ctx.getOption<string>('endpoint', 'https://ollama.com/api/balance');

    logger.debug(`Fetching Ollama balance from ${endpoint}`);
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const data: OllamaBalanceResponse = await response.json();
    const meters = [];
    const included = data.included;

    if (included && 'allowance_usd' in included) {
      const allowance = included.allowance_usd;
      const balance = included.balance_usd;
      if (allowance > 0 && Number.isFinite(allowance) && Number.isFinite(balance)) {
        const usedPercent = Math.min(100, Math.max(0, ((allowance - balance) / allowance) * 100));
        meters.push(
          ctx.allowance({
            key: 'monthly',
            label: 'Monthly usage',
            unit: 'percentage',
            used: usedPercent,
            remaining: 100 - usedPercent,
            periodValue: 1,
            periodUnit: 'month',
            periodCycle: 'fixed',
            resetsAt: included.period.until,
          })
        );
      }
    } else if (included) {
      if (included.session) {
        meters.push(
          ctx.allowance({
            key: 'session',
            label: 'Session usage',
            unit: 'percentage',
            used: 100 - included.session.remaining_percent,
            remaining: included.session.remaining_percent,
            periodValue: 5,
            periodUnit: 'hour',
            periodCycle: 'rolling',
            resetsAt: included.session.resets_at,
          })
        );
      }
      if (included.weekly) {
        meters.push(
          ctx.allowance({
            key: 'weekly',
            label: 'Weekly usage',
            unit: 'percentage',
            used: 100 - included.weekly.remaining_percent,
            remaining: included.weekly.remaining_percent,
            periodValue: 7,
            periodUnit: 'day',
            periodCycle: 'rolling',
            resetsAt: included.weekly.resets_at,
          })
        );
      }
    }

    const purchasedBalance = data.purchased?.balance_usd;
    if (
      typeof purchasedBalance === 'number' &&
      Number.isFinite(purchasedBalance) &&
      purchasedBalance > 0
    ) {
      meters.push(
        ctx.balance({
          key: 'purchased',
          label: 'Purchased credits',
          unit: 'USD',
          remaining: Math.max(0, purchasedBalance),
        })
      );
    }

    if (meters.length === 0) throw new Error('Ollama balance response contains no usage data');
    logger.debug(`Returning ${meters.length} Ollama meters`);
    return meters;
  },
});
