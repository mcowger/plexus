import type { QuotaCheckResult, QuotaWindow, QuotaCheckerConfig } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { logger } from '../../../utils/logger';

interface ApertisCodingPlanResponse {
  has_subscription: boolean;
  subscription: {
    account_balance: {
      quota: number;
      usd_equivalent: string;
    };
    api_token: string;
    billing_cycle: string;
    cancel_at_period_end: boolean;
    current_cycle: {
      limit: number;
      percentage: number;
      remaining: number;
      reset_at: string;
      used: number;
    };
    current_period_end: number;
    dedicated_token: string;
    id: number;
    payg_status: {
      enabled: boolean;
      limit: number;
      spent: number;
    };
    plan_type: string;
    status: string;
    stripe_subscription_id: string;
    subscription_end: null | string;
  };
  success: boolean;
}

const APERTIS_CODING_PLAN_ENDPOINT = 'https://api.stima.tech/api/subscription/status';

export class ApertisCodingPlanQuotaChecker extends QuotaChecker {
  readonly category = 'rate-limit' as const;
  async checkQuota(): Promise<QuotaCheckResult> {
    const session = this.requireOption<string>('session').trim();
    const endpoint = this.getOption<string>('endpoint', APERTIS_CODING_PLAN_ENDPOINT);

    try {
      logger.silly(`[apertis-coding-plan] Calling ${endpoint}`);

      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Cookie: `session=${session}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        return this.errorResult(new Error(`HTTP ${response.status}: ${response.statusText}`));
      }

      const data: ApertisCodingPlanResponse = await response.json();

      if (!data.success || !data.has_subscription) {
        return this.errorResult(
          new Error(
            `Apertis Coding Plan API error: ${!data.success ? 'API failed' : 'no subscription'}`
          )
        );
      }

      const subscription = data.subscription;
      if (!subscription || !subscription.current_cycle) {
        return this.errorResult(new Error('Invalid subscription data in response'));
      }

      const cycle = subscription.current_cycle;
      const resetDate = new Date(cycle.reset_at);

      if (
        !Number.isFinite(cycle.limit) ||
        !Number.isFinite(cycle.used) ||
        !Number.isFinite(cycle.remaining)
      ) {
        return this.errorResult(
          new Error(
            `Invalid cycle data: limit=${cycle.limit}, used=${cycle.used}, remaining=${cycle.remaining}`
          )
        );
      }

      const window: QuotaWindow = this.createWindow(
        'monthly',
        cycle.limit,
        cycle.used,
        cycle.remaining,
        'requests',
        resetDate,
        'Apertis Coding Plan monthly quota'
      );

      return this.successResult([window]);
    } catch (error) {
      return this.errorResult(error as Error);
    }
  }
}
