import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { logger } from '../../../utils/logger';

interface NeuralwattQuotaResponse {
  balance: {
    credits_remaining_usd: number;
    total_credits_usd: number;
    credits_used_usd: number;
    accounting_method: string;
  };
  usage?: {
    lifetime?: { cost_usd: number; requests: number; tokens: number; energy_kwh: number };
    current_month?: { cost_usd: number; requests: number; tokens: number; energy_kwh: number };
  };
  limits?: { overage_limit_usd: number | null; rate_limit_tier: string };
  subscription?: {
    plan: string;
    status: string;
    billing_interval: string;
    current_period_start: string;
    current_period_end: string;
    auto_renew: boolean;
    kwh_included: number;
    kwh_used: number;
    kwh_remaining: number;
    in_overage: boolean;
  };
  key?: { name: string; allowance: number | null };
}

export default defineChecker({
  type: 'neuralwatt',
  optionsSchema: z.object({
    apiKey: z.string().min(1, 'Neuralwatt API key is required'),
    endpoint: z.string().url().optional(),
  }),
  async check(ctx) {
    const apiKey = ctx.requireOption<string>('apiKey');
    const endpoint = ctx.getOption<string>('endpoint', 'https://api.neuralwatt.com/v1/quota');

    logger.silly(`[neuralwatt] Calling ${endpoint}`);
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const data: NeuralwattQuotaResponse = await response.json();
    const meters = [];

    if (data.balance && Number.isFinite(data.balance.credits_remaining_usd)) {
      meters.push(
        ctx.balance({
          key: 'credit_balance',
          label: 'Credit balance',
          unit: 'usd',
          limit: Number.isFinite(data.balance.total_credits_usd) ? data.balance.total_credits_usd : undefined,
          used: Number.isFinite(data.balance.credits_used_usd) ? data.balance.credits_used_usd : undefined,
          remaining: data.balance.credits_remaining_usd,
        })
      );
    }

    if (data.subscription) {
      const sub = data.subscription;
      if (Number.isFinite(sub.kwh_included) && Number.isFinite(sub.kwh_used) && Number.isFinite(sub.kwh_remaining)) {
        meters.push(
          ctx.allowance({
            key: 'energy_quota',
            label: `${sub.plan} plan energy quota`,
            unit: 'kwh',
            limit: sub.kwh_included,
            used: sub.kwh_used,
            remaining: sub.kwh_remaining,
            periodValue: 1,
            periodUnit: 'month',
            periodCycle: 'fixed',
            resetsAt: new Date(sub.current_period_end).toISOString(),
          })
        );
      }
    }

    if (meters.length === 0) throw new Error('No valid balance or subscription data received from Neuralwatt API');

    logger.debug(`[neuralwatt] Returning ${meters.length} meters`);
    return meters;
  },
});
