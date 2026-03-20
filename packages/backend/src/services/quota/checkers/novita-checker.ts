import type { QuotaCheckResult, QuotaWindow, QuotaCheckerConfig } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { logger } from '../../../utils/logger';

interface NovitaBalanceResponse {
  availableBalance: string;
  cashBalance: string;
  creditLimit: string;
  pendingCharges: string;
  outstandingInvoices: string;
}

export class NovitaQuotaChecker extends QuotaChecker {
  readonly category = 'balance' as const;
  private endpoint: string;

  constructor(config: QuotaCheckerConfig) {
    super(config);
    this.endpoint = this.getOption<string>(
      'endpoint',
      'https://api.novita.ai/openapi/v1/billing/balance/detail'
    );
  }

  async checkQuota(): Promise<QuotaCheckResult> {
    const apiKey = this.requireOption<string>('apiKey');

    try {
      logger.silly(`[novita] Calling ${this.endpoint}`);

      const response = await fetch(this.endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        return this.errorResult(new Error(`HTTP ${response.status}: ${response.statusText}`));
      }

      const data: NovitaBalanceResponse = await response.json();

      // Balance fields are in 0.0001 USD, convert to USD
      const availableBalance = parseFloat(data.availableBalance) / 10000;

      const window: QuotaWindow = this.createWindow(
        'subscription',
        undefined,
        undefined,
        availableBalance,
        'dollars',
        undefined,
        'Novita account balance'
      );

      return this.successResult([window]);
    } catch (error) {
      return this.errorResult(error as Error);
    }
  }
}
