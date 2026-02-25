import type { QuotaCheckResult, QuotaWindow } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { logger } from '../../../utils/logger';

interface WisdomGateBalanceResponse {
  available_balance: number;
  package_balance: number;
  cash_balance: number;
  token_balance: number;
  is_token_unlimited_quota: boolean;
}

export class WisdomGateQuotaChecker extends QuotaChecker {
  async checkQuota(): Promise<QuotaCheckResult> {
    const apiKey = this.requireOption<string>('apiKey');
    const endpoint =
      this.getOption<string>('endpoint', undefined) ??
      'https://wisdom-gate.juheapi.com/v1/users/me/balance';

    try {
      logger.silly(`[wisdomgate] Calling ${endpoint}`);

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

      const data: WisdomGateBalanceResponse = await response.json();

      const window: QuotaWindow = this.createWindow(
        'subscription',
        undefined,
        undefined,
        data.available_balance,
        'dollars',
        undefined,
        'Wisdom Gate account balance'
      );

      return this.successResult([window]);
    } catch (error) {
      return this.errorResult(error as Error);
    }
  }
}
