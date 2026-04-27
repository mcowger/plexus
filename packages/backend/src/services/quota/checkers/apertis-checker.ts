import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { logger } from '../../../utils/logger';

interface ApertisBillingCreditsResponse {
  object: 'billing_credits';
  is_subscriber: boolean;
  payg: {
    account_credits: number;
    token_used: number;
    token_total: string | number;
    token_remaining: string | number;
    token_is_unlimited: boolean;
  };
  subscription?: {
    plan_type: 'lite' | 'pro' | 'max';
    status: 'active' | 'suspended' | 'cancelled';
    cycle_quota_limit: number;
    cycle_quota_used: number;
    cycle_quota_remaining: number;
    cycle_end: string;
  };
}

export default defineChecker({
  type: 'apertis',
  optionsSchema: z.object({
    apiKey: z.string().min(1, 'Apertis API key is required'),
    endpoint: z.string().url().optional(),
  }),
  async check(ctx) {
    const apiKey = ctx.requireOption<string>('apiKey');
    const endpoint = ctx.getOption<string>('endpoint', 'https://api.apertis.ai/v1/dashboard/billing/credits');

    logger.silly(`[apertis] Calling ${endpoint}`);
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const data: ApertisBillingCreditsResponse = await response.json();

    if (data.object !== 'billing_credits') throw new Error('Invalid response: expected billing_credits object');

    const meters = [];

    if (Number.isFinite(data.payg.account_credits)) {
      meters.push(
        ctx.balance({
          key: 'payg',
          label: 'PAYG balance',
          unit: 'usd',
          remaining: data.payg.account_credits,
        })
      );
    }

    if (data.is_subscriber && data.subscription) {
      const sub = data.subscription;
      meters.push(
        ctx.allowance({
          key: 'cycle_quota',
          label: `${sub.plan_type.charAt(0).toUpperCase() + sub.plan_type.slice(1)} plan quota`,
          unit: 'requests',
          limit: sub.cycle_quota_limit,
          used: sub.cycle_quota_used,
          remaining: sub.cycle_quota_remaining,
          periodValue: 1,
          periodUnit: 'month',
          periodCycle: 'fixed',
          resetsAt: new Date(sub.cycle_end).toISOString(),
        })
      );
    }

    logger.debug(`[apertis] Returning ${meters.length} meters`);
    return meters;
  },
});
