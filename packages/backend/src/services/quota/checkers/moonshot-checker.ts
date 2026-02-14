import type { QuotaCheckResult, QuotaWindow, QuotaCheckerConfig } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { logger } from '../../../utils/logger';

interface MoonshotBalanceResponse {
  code: number;
  data: {
    available_balance: number;
    voucher_balance: number;
    cash_balance: number;
  };
  scode: string;
  status: boolean;
}

export class MoonshotQuotaChecker extends QuotaChecker {
  private endpoint: string;

  constructor(config: QuotaCheckerConfig) {
    super(config);
    this.endpoint = this.getOption<string>('endpoint', 'https://api.moonshot.ai/v1/users/me/balance');
  }

  async checkQuota(): Promise<QuotaCheckResult> {
    const apiKey = this.requireOption<string>('apiKey');

    try {
      logger.silly(`[moonshot] Calling ${this.endpoint}`);

      const response = await fetch(this.endpoint, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        return this.errorResult(new Error(`HTTP ${response.status}: ${response.statusText}`));
      }

      const data: MoonshotBalanceResponse = await response.json();

      if (!data.status || data.code !== 0) {
        return this.errorResult(new Error(`Moonshot API error: code=${data.code}, scode=${data.scode}`));
      }

      const { available_balance, voucher_balance, cash_balance } = data.data;

      const window: QuotaWindow = this.createWindow(
        'subscription',
        undefined,
        undefined,
        available_balance,
        'dollars',
        undefined,
        'Moonshot account balance'
      );

      return this.successResult([window]);
    } catch (error) {
      return this.errorResult(error as Error);
    }
  }
}
