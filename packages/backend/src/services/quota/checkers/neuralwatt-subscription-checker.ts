import type { QuotaCheckResult, QuotaWindow, QuotaCheckerConfig } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { logger } from '../../../utils/logger';

interface NeuralwattSubscriptionResponse {
  balance?: {
    credits_remaining_usd: number;
    total_credits_usd: number;
    credits_used_usd: number;
    accounting_method: string;
  };
  subscription: {
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
  key?: {
    name: string;
    allowance: number | null;
  };
  limits?: {
    overage_limit_usd: number | null;
    rate_limit_tier: string;
  };
}

const NEURALWATT_DEFAULT_ENDPOINT = 'https://api.neuralwatt.com/v1/quota';

export class NeuralwattSubscriptionQuotaChecker extends QuotaChecker {
  readonly category = 'rate-limit' as const;
  private endpoint: string;

  constructor(config: QuotaCheckerConfig) {
    super(config);
    this.endpoint = this.getOption<string>('endpoint', NEURALWATT_DEFAULT_ENDPOINT);
  }

  async checkQuota(): Promise<QuotaCheckResult> {
    const apiKey = this.requireOption<string>('apiKey');

    try {
      logger.silly(`[neuralwatt-subscription] Calling ${this.endpoint}`);

      const response = await fetch(this.endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        return this.errorResult(new Error(`HTTP ${response.status}: ${response.statusText}`));
      }

      const data: NeuralwattSubscriptionResponse = await response.json();

      if (!data.subscription) {
        return this.errorResult(new Error('No subscription data found in Neuralwatt API response'));
      }

      const sub = data.subscription;

      logger.debug(
        `[neuralwatt-subscription] plan=${sub.plan} status=${sub.status} ` +
          `kwh_included=${sub.kwh_included} kwh_used=${sub.kwh_used} ` +
          `kwh_remaining=${sub.kwh_remaining} in_overage=${sub.in_overage}`
      );

      if (
        !Number.isFinite(sub.kwh_included) ||
        !Number.isFinite(sub.kwh_used) ||
        !Number.isFinite(sub.kwh_remaining)
      ) {
        return this.errorResult(
          new Error(
            `Invalid subscription data: kwh_included=${sub.kwh_included}, kwh_used=${sub.kwh_used}, kwh_remaining=${sub.kwh_remaining}`
          )
        );
      }

      const resetsAt = new Date(sub.current_period_end);

      const window: QuotaWindow = this.createWindow(
        'monthly',
        sub.kwh_included,
        sub.kwh_used,
        sub.kwh_remaining,
        'points',
        resetsAt,
        `Neuralwatt ${sub.plan} plan energy quota`
      );

      return {
        ...this.successResult([window]),
        rawResponse: data,
      };
    } catch (error) {
      return this.errorResult(error as Error);
    }
  }
}
