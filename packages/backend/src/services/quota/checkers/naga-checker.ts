import type { QuotaCheckResult, QuotaWindow, QuotaCheckerConfig } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';

interface NagaBalanceResponse {
  balance: string;
}

export class NagaQuotaChecker extends QuotaChecker {
  private endpoint: string;

  constructor(config: QuotaCheckerConfig) {
    super(config);
    this.endpoint = this.getOption<string>('endpoint', 'https://api.naga.ac/v1/account/balance');
  }

  async checkQuota(): Promise<QuotaCheckResult> {
    const apiKey = this.requireOption<string>('apiKey');

    try {
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

      const data: NagaBalanceResponse = await response.json();
      const currentBalance = parseFloat(data.balance);

      if (isNaN(currentBalance)) {
        return this.errorResult(new Error(`Invalid balance value received: ${data.balance}`));
      }

      const window: QuotaWindow = this.createWindow(
        'subscription',
        undefined,
        undefined,
        currentBalance,
        'dollars',
        undefined,
        'Naga.ac account balance'
      );

      return this.successResult([window]);
    } catch (error) {
      return this.errorResult(error as Error);
    }
  }
}
