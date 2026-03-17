import type { QuotaCheckResult, QuotaWindow, QuotaCheckerConfig } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { logger } from '../../../utils/logger';

interface ApertisBillingCreditsResponse {
  object: 'billing_credits';
  is_subscriber: boolean;
  subscription?: {
    plan_type: 'lite' | 'pro' | 'max';
    status: 'active' | 'suspended' | 'cancelled';
    cycle_quota_limit: number;
    cycle_quota_used: number;
    cycle_quota_remaining: number;
    cycle_end: string;
  };
}

const APERTIS_CODING_PLAN_ENDPOINT = 'https://api.apertis.ai/v1/dashboard/billing/credits';

export class ApertisCodingPlanQuotaChecker extends QuotaChecker {
  readonly category = 'rate-limit' as const;
  async checkQuota(): Promise<QuotaCheckResult> {
    const apiKey = this.requireOption<string>('apiKey');
    const endpoint = this.getOption<string>('endpoint', APERTIS_CODING_PLAN_ENDPOINT);

    try {
      logger.silly(`[apertis-coding-plan] Calling ${endpoint}`);

      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        return this.errorResult(new Error(`HTTP ${response.status}: ${response.statusText}`));
      }

      const data: ApertisBillingCreditsResponse = await response.json();

      logger.debug(`[apertis-coding-plan] Response: ${JSON.stringify(data)}`);

      if (data.object !== 'billing_credits') {
        return this.errorResult(new Error('Invalid response: expected billing_credits object'));
      }

      if (!data.is_subscriber || !data.subscription) {
        return this.errorResult(
          new Error('No active subscription found. This checker requires a subscription plan.')
        );
      }

      const sub = data.subscription;
      const resetsAt = new Date(sub.cycle_end);

      if (
        !Number.isFinite(sub.cycle_quota_limit) ||
        !Number.isFinite(sub.cycle_quota_used) ||
        !Number.isFinite(sub.cycle_quota_remaining)
      ) {
        return this.errorResult(
          new Error(
            `Invalid cycle data: limit=${sub.cycle_quota_limit}, used=${sub.cycle_quota_used}, remaining=${sub.cycle_quota_remaining}`
          )
        );
      }

      const window: QuotaWindow = this.createWindow(
        'monthly',
        sub.cycle_quota_limit,
        sub.cycle_quota_used,
        sub.cycle_quota_remaining,
        'requests',
        resetsAt,
        `Apertis ${sub.plan_type} plan`
      );

      return this.successResult([window]);
    } catch (error) {
      return this.errorResult(error as Error);
    }
  }
}
