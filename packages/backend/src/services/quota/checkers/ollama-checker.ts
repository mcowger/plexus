import { z } from 'zod';

import { logger } from '../../../utils/logger';
import { defineChecker } from '../checker-registry';

const OllamaBalanceSchema = z
  .object({
    included: z
      .union([
        z
          .object({
            balance_usd: z.number().finite(),
            allowance_usd: z.number().finite(),
            period: z.object({ from: z.string(), until: z.string() }).strict(),
          })
          .strict(),
        z
          .object({
            session: z
              .object({
                remaining_percent: z.number().finite().min(0).max(100),
                resets_at: z.string(),
              })
              .strict()
              .optional(),
            weekly: z
              .object({
                remaining_percent: z.number().finite().min(0).max(100),
                resets_at: z.string(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      ])
      .optional(),
    purchased: z.object({ balance_usd: z.number().finite() }).strict().optional(),
  })
  .strict();

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

    const raw: unknown = await response.json();
    const parsed = OllamaBalanceSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Unexpected Ollama balance response: ${parsed.error.message}`);
    }
    const data = parsed.data;
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
    if (typeof purchasedBalance === 'number' && Number.isFinite(purchasedBalance)) {
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
