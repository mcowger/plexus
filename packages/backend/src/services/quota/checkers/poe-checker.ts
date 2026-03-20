import type { QuotaCheckResult, QuotaWindow, QuotaCheckerConfig } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { logger } from '../../../utils/logger';

interface PoeBalanceResponse {
  current_point_balance?: number;
}

export class PoeQuotaChecker extends QuotaChecker {
  readonly category = 'balance' as const;
  private endpoint: string;

  constructor(config: QuotaCheckerConfig) {
    super(config);
    this.endpoint = this.getOption<string>('endpoint', 'https://api.poe.com/usage/current_balance');
  }

  async checkQuota(): Promise<QuotaCheckResult> {
    const apiKey = this.requireOption<string>('apiKey');

    try {
      logger.silly(`[poe] Calling ${this.endpoint}`);

      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      };

      const response = await fetch(this.endpoint, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        return this.errorResult(new Error(`HTTP ${response.status}: ${response.statusText}`));
      }

      const data: PoeBalanceResponse = await response.json();
      const balance = Number(data.current_point_balance);

      if (!Number.isFinite(balance)) {
        return this.errorResult(
          new Error(`Invalid balance received: ${String(data.current_point_balance)}`)
        );
      }

      const window: QuotaWindow = this.createWindow(
        'subscription',
        undefined,
        undefined,
        balance,
        'points',
        undefined,
        'POE point balance'
      );

      return this.successResult([window]);
    } catch (error) {
      return this.errorResult(error as Error);
    }
  }
}
