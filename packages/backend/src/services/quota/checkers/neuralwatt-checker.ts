import type { QuotaCheckResult, QuotaWindow, QuotaCheckerConfig } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { logger } from '../../../utils/logger';

interface NeuralwattQuotaResponse {
  balance: {
    credits_remaining_usd: number;
    total_credits_usd: number;
    credits_used_usd: number;
    accounting_method: string;
  };
  usage?: {
    lifetime?: {
      cost_usd: number;
      requests: number;
      tokens: number;
      energy_kwh: number;
    };
    current_month?: {
      cost_usd: number;
      requests: number;
      tokens: number;
      energy_kwh: number;
    };
  };
  limits?: {
    overage_limit_usd: number | null;
    rate_limit_tier: string;
  };
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
  key?: {
    name: string;
    allowance: number | null;
  };
}

const NEURALWATT_DEFAULT_ENDPOINT = 'https://api.neuralwatt.com/v1/quota';

export class NeuralwattQuotaChecker extends QuotaChecker {
  readonly category = 'balance' as const;
  private endpoint: string;

  constructor(config: QuotaCheckerConfig) {
    super(config);
    this.endpoint = this.getOption<string>('endpoint', NEURALWATT_DEFAULT_ENDPOINT);
  }

  async checkQuota(): Promise<QuotaCheckResult> {
    const apiKey = this.requireOption<string>('apiKey');

    try {
      logger.silly(`[neuralwatt] Calling ${this.endpoint}`);

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

      const data: NeuralwattQuotaResponse = await response.json();
      const windows: QuotaWindow[] = [];

      // Balance window (always present)
      if (
        data.balance &&
        typeof data.balance.credits_remaining_usd === 'number' &&
        Number.isFinite(data.balance.credits_remaining_usd)
      ) {
        logger.debug(
          `[neuralwatt] balance: remaining=$${data.balance.credits_remaining_usd} ` +
            `total=$${data.balance.total_credits_usd} used=$${data.balance.credits_used_usd} ` +
            `method=${data.balance.accounting_method}`
        );

        windows.push(
          this.createWindow(
            'subscription',
            data.balance.total_credits_usd,
            data.balance.credits_used_usd,
            data.balance.credits_remaining_usd,
            'dollars',
            undefined,
            'Neuralwatt credit balance'
          )
        );
      } else {
        logger.debug(`[neuralwatt] No valid balance data in API response`);
      }

      // Subscription window (if present)
      if (data.subscription) {
        const sub = data.subscription;

        logger.debug(
          `[neuralwatt] subscription: plan=${sub.plan} status=${sub.status} ` +
            `kwh_included=${sub.kwh_included} kwh_used=${sub.kwh_used} ` +
            `kwh_remaining=${sub.kwh_remaining} in_overage=${sub.in_overage}`
        );

        if (
          Number.isFinite(sub.kwh_included) &&
          Number.isFinite(sub.kwh_used) &&
          Number.isFinite(sub.kwh_remaining)
        ) {
          const resetsAt = new Date(sub.current_period_end);

          windows.push(
            this.createWindow(
              'monthly',
              sub.kwh_included,
              sub.kwh_used,
              sub.kwh_remaining,
              'points',
              resetsAt,
              `Neuralwatt ${sub.plan} plan energy quota`
            )
          );
        }
      }

      if (windows.length === 0) {
        return this.errorResult(
          new Error('No valid balance or subscription data received from Neuralwatt API')
        );
      }

      return {
        ...this.successResult(windows),
        rawResponse: data,
      };
    } catch (error) {
      return this.errorResult(error as Error);
    }
  }
}
