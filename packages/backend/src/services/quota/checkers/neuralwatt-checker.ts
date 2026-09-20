import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { logger } from '../../../utils/logger';
import type { Meter } from '../../../types/meter';

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
  } | null;
  key?: { name: string; allowance: number | null };
}

export default defineChecker({
  type: 'neuralwatt',
  displayName: 'Neuralwatt',
  optionsSchema: z.object({
    apiKey: z.string().min(1, 'Neuralwatt API key is required'),
    endpoint: z.string().url().optional(),
  }),
  async check(ctx) {
    const apiKey = ctx.requireOption<string>('apiKey');
    const endpoint = ctx.getOption<string>('endpoint', 'https://api.neuralwatt.com/v1/quota');

    logger.silly(`Calling ${endpoint}`);
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const data: NeuralwattQuotaResponse = await response.json();
    const meters: Meter[] = [];

    // Availability is OR-based (see https://portal.neuralwatt.com/docs/billing/faq
    // "How do my subscription allowance and credit balance work together?"):
    // the subscription allowance is consumed first and credits are only touched
    // once the allowance is exhausted. A $0 credit balance must not block the
    // provider while subscription kWh remains, and vice versa — exhausted quota
    // must not block while credits remain. The quota scheduler marks the
    // provider exhausted when ANY meter is exhausted, so when either funding
    // source is usable we downgrade the other (exhausted) meter to non-blocking
    // to avoid a false provider-wide cooldown (issue #898).
    const creditRemaining = data.balance?.credits_remaining_usd;
    const hasUsableCredit = Number.isFinite(creditRemaining) && (creditRemaining as number) > 0;

    const subForAvailability = data.subscription;
    // Statuses that still grant usable allowance: active, trialing, and
    // canceling (still active until period end). past_due / paused do not.
    const USABLE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'canceling']);
    let hasUsableSubscription = false;
    if (subForAvailability) {
      const statusUsable = USABLE_SUBSCRIPTION_STATUSES.has(
        String(subForAvailability.status ?? '').toLowerCase()
      );
      const quotaNumbersValid =
        Number.isFinite(subForAvailability.kwh_included) &&
        Number.isFinite(subForAvailability.kwh_used) &&
        Number.isFinite(subForAvailability.kwh_remaining);
      const quotaRemaining = quotaNumbersValid && (subForAvailability.kwh_remaining as number) > 0;
      let periodValid = true;
      if (subForAvailability.current_period_end) {
        const endMs = Date.parse(subForAvailability.current_period_end);
        periodValid = Number.isFinite(endMs) && endMs > Date.now();
      }
      hasUsableSubscription = statusUsable && quotaRemaining && periodValid;
    }

    const eitherSourceUsable = hasUsableCredit || hasUsableSubscription;

    if (data.balance && Number.isFinite(data.balance.credits_remaining_usd)) {
      meters.push(
        ctx.balance({
          key: 'credit_balance',
          label: 'Credit balance',
          unit: 'usd',
          limit: Number.isFinite(data.balance.total_credits_usd)
            ? data.balance.total_credits_usd
            : undefined,
          used: Number.isFinite(data.balance.credits_used_usd)
            ? data.balance.credits_used_usd
            : undefined,
          remaining: data.balance.credits_remaining_usd,
        })
      );
    }

    if (data.subscription) {
      const sub = data.subscription;
      if (
        Number.isFinite(sub.kwh_included) &&
        Number.isFinite(sub.kwh_used) &&
        Number.isFinite(sub.kwh_remaining)
      ) {
        const endMs = sub.current_period_end ? Date.parse(sub.current_period_end) : NaN;
        const quotaMeter = ctx.allowance({
          key: 'energy_quota',
          label: `${sub.plan} plan energy quota`,
          unit: 'kwh',
          limit: sub.kwh_included,
          used: sub.kwh_used,
          remaining: sub.kwh_remaining,
          periodValue: 1,
          periodUnit: 'month',
          periodCycle: 'fixed',
          ...(Number.isFinite(endMs) ? { resetsAt: new Date(endMs).toISOString() } : {}),
        });
        // A subscription in a non-usable status (past_due/paused) or with an
        // expired period grants no usable allowance even when kwh_remaining > 0,
        // so force the meter exhausted. The OR-normalization below still
        // downgrades it when credits cover (eitherSourceUsable).
        if (!hasUsableSubscription && quotaMeter.status !== 'exhausted') {
          quotaMeter.status = 'exhausted';
          quotaMeter.utilizationPercent = 100;
        }
        meters.push(quotaMeter);
      }
    }

    if (meters.length === 0)
      throw new Error('No valid balance or subscription data received from Neuralwatt API');

    if (eitherSourceUsable) {
      for (const meter of meters) {
        if (meter.status === 'exhausted') {
          meter.status = 'ok';
          if (typeof meter.utilizationPercent === 'number') {
            meter.utilizationPercent = 'not_applicable';
          }
        }
      }
    }

    logger.debug(`Returning ${meters.length} meters`);
    return meters;
  },
});
