import type { QuotaCheckResult, QuotaWindow, QuotaCheckerConfig } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { logger } from '../../../utils/logger';

interface NeuralwattBalanceResponse {
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

      const data: NeuralwattBalanceResponse = await response.json();

      logger.debug(
        `[neuralwatt] balance: remaining=$${data.balance?.credits_remaining_usd} ` +
          `total=$${data.balance?.total_credits_usd} used=$${data.balance?.credits_used_usd} ` +
          `method=${data.balance?.accounting_method}`
      );

      if (
        !data.balance ||
        typeof data.balance.credits_remaining_usd !== 'number' ||
        !Number.isFinite(data.balance.credits_remaining_usd)
      ) {
        return this.errorResult(new Error('Invalid balance data received from Neuralwatt API'));
      }

      const window: QuotaWindow = this.createWindow(
        'subscription',
        data.balance.total_credits_usd,
        data.balance.credits_used_usd,
        data.balance.credits_remaining_usd,
        'dollars',
        undefined,
        'Neuralwatt credit balance'
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
