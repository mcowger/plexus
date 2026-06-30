import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { logger } from '../../../utils/logger';

// Cline balances are denominated in microcredits; 1,000,000 microcredits = 1 USD credit.
const MICROCREDITS_PER_USD = 1_000_000;

interface ClineBalanceResponse {
  balance: number;
  userId: string;
}

interface ClineSubscriptionPlan {
  id?: string;
  name?: string;
  displayName?: string;
  interval?: string;
  type?: string;
  pricePerSeatCents?: number;
  features?: { included?: string[]; [key: string]: unknown };
  [key: string]: unknown;
}

interface ClineUserCurrentPlan {
  userId?: string;
  subscriptionId?: string;
  planHistoryId?: string;
  plan?: ClineSubscriptionPlan | null;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  cancelAt?: string;
  canceledAt?: string;
  [key: string]: unknown;
}

interface ClineApiEnvelope<T> {
  success?: boolean;
  error?: string;
  data?: T;
}

async function clineRequest<T>(endpoint: string, apiKey: string, init?: RequestInit): Promise<T> {
  const response = await fetch(endpoint, {
    ...init,
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      ...(init?.headers as Record<string, string> | undefined),
    },
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

  const envelope: ClineApiEnvelope<T> = await response.json();
  if (envelope.success === false) {
    throw new Error(envelope.error || 'Cline API request failed');
  }
  if (envelope.data === undefined) {
    throw new Error('Cline API response missing data');
  }
  return envelope.data;
}

export default defineChecker({
  type: 'cline',
  displayName: 'Cline',
  optionsSchema: z.object({
    apiKey: z.string().min(1, 'Cline API key is required'),
    endpoint: z.string().url().optional(),
  }),
  async check(ctx) {
    const apiKey = ctx.requireOption<string>('apiKey');
    const baseEndpoint = ctx.getOption<string>('endpoint', 'https://api.cline.bot');

    const meters = [];

    logger.silly(`Fetching Cline user id`);
    const me = await clineRequest<{ id: string }>(`${baseEndpoint}/api/v1/users/me`, apiKey);
    if (!me.id) throw new Error('Cline API response missing user id');

    logger.silly(`Fetching Cline balance for user ${me.id}`);
    const balance = await clineRequest<ClineBalanceResponse>(
      `${baseEndpoint}/api/v1/users/${encodeURIComponent(me.id)}/balance`,
      apiKey
    );

    if (Number.isFinite(balance.balance)) {
      meters.push(
        ctx.balance({
          key: 'balance',
          label: 'Cost balance',
          unit: 'usd',
          remaining: balance.balance / MICROCREDITS_PER_USD,
        })
      );
    }

    logger.silly(`Fetching Cline subscription plan`);
    const plan = await clineRequest<ClineUserCurrentPlan | null>(
      `${baseEndpoint}/api/v1/users/me/plan`,
      apiKey
    );

    if (plan?.subscriptionId && plan.currentPeriodStart && plan.currentPeriodEnd) {
      const periodStart = new Date(plan.currentPeriodStart).getTime();
      const periodEnd = new Date(plan.currentPeriodEnd).getTime();

      if (Number.isFinite(periodStart) && Number.isFinite(periodEnd) && periodEnd > periodStart) {
        const totalMs = periodEnd - periodStart;
        const elapsedMs = Math.min(Math.max(Date.now() - periodStart, 0), totalMs);
        const used = (elapsedMs / totalMs) * 100;
        const remaining = 100 - used;
        const planName = plan.plan?.displayName || plan.plan?.name || 'Subscription';

        meters.push(
          ctx.allowance({
            key: 'subscription_plan',
            label: `${planName} billing cycle`,
            unit: 'percentage',
            used,
            remaining,
            periodValue: 1,
            periodUnit: 'month',
            periodCycle: 'fixed',
            resetsAt: new Date(periodEnd).toISOString(),
          })
        );
      }
    }

    logger.debug(`Returning ${meters.length} meters`);
    return meters;
  },
});
