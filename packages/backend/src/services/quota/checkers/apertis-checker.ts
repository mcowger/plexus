import type { QuotaCheckResult, QuotaWindow, QuotaCheckerConfig } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { logger } from '../../../utils/logger';

interface ApertisBillingCreditsResponse {
  object: 'billing_credits';
  is_subscriber: boolean;
  payg: {
    account_credits: number;
    token_used: number;
    token_total: string | number;
    token_remaining: string | number;
    token_is_unlimited: boolean;
  };
}

const APERTIS_DEFAULT_ENDPOINT = 'https://api.apertis.ai/v1/dashboard/billing/credits';

export class ApertisQuotaChecker extends QuotaChecker {
  readonly category = 'balance' as const;
  async checkQuota(): Promise<QuotaCheckResult> {
    const apiKey = this.requireOption<string>('apiKey');
    const endpoint = this.getOption<string>('endpoint', APERTIS_DEFAULT_ENDPOINT);

    try {
      logger.silly(`[apertis] Calling ${endpoint}`);

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

      logger.debug(`[apertis] Response: ${JSON.stringify(data)}`);

      if (data.object !== 'billing_credits') {
        return this.errorResult(new Error('Invalid response: expected billing_credits object'));
      }

      const payg = data.payg;

      logger.debug(`[apertis] PAYG: account_credits=${payg.account_credits}`);

      // Use account_credits as the PAYG balance
      if (!Number.isFinite(payg.account_credits)) {
        return this.errorResult(
          new Error('Invalid PAYG balance: account_credits is not a valid number')
        );
      }

      const window: QuotaWindow = this.createWindow(
        'subscription',
        undefined,
        undefined,
        payg.account_credits,
        'dollars',
        undefined,
        'Apertis PAYG balance'
      );

      return this.successResult([window]);
    } catch (error) {
      return this.errorResult(error as Error);
    }
  }
}
