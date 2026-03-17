import type { QuotaCheckResult, QuotaWindow, QuotaCheckerConfig } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { logger } from '../../../utils/logger';

interface ApertisBillingCreditsResponse {
  object: 'billing_credits';
  is_subscriber: boolean;
  payg: {
    remaining_usd: number | null;
    used_usd: number;
    total_usd: number | null;
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

      logger.debug(
        `[apertis] PAYG: remaining_usd=${payg.remaining_usd}, used_usd=${payg.used_usd}, total_usd=${payg.total_usd}`
      );

      // Handle PAYG balance - use values directly, ignore is_unlimited
      if (payg.remaining_usd === null) {
        return this.errorResult(new Error('Invalid PAYG balance: remaining_usd is null'));
      }

      const window: QuotaWindow = this.createWindow(
        'subscription',
        payg.total_usd ?? undefined,
        payg.used_usd,
        payg.remaining_usd,
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
