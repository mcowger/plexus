import type { QuotaCheckResult, QuotaWindow, QuotaCheckerConfig } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { logger } from '../../../utils/logger';

interface KiloBalanceResponse {
  balance?: number;
}

export class KiloQuotaChecker extends QuotaChecker {
  private endpoint: string;
  private organizationId?: string;

  constructor(config: QuotaCheckerConfig) {
    super(config);
    this.endpoint = this.getOption<string>('endpoint', 'https://api.kilo.ai/api/profile/balance');
    this.organizationId =
      this.getOption<string | undefined>('organizationId', undefined)?.trim() || undefined;
  }

  async checkQuota(): Promise<QuotaCheckResult> {
    const apiKey = this.requireOption<string>('apiKey');

    try {
      logger.silly(`[kilo] Calling ${this.endpoint}`);

      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      };

      if (this.organizationId) {
        headers['x-kilocode-organizationid'] = this.organizationId;
      }

      const response = await fetch(this.endpoint, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        return this.errorResult(new Error(`HTTP ${response.status}: ${response.statusText}`));
      }

      const data: KiloBalanceResponse = await response.json();
      const balance = Number(data.balance);

      if (!Number.isFinite(balance)) {
        return this.errorResult(new Error(`Invalid balance received: ${String(data.balance)}`));
      }

      const window: QuotaWindow = this.createWindow(
        'subscription',
        undefined,
        undefined,
        balance,
        'dollars',
        undefined,
        'Kilo account balance'
      );

      return this.successResult([window]);
    } catch (error) {
      return this.errorResult(error as Error);
    }
  }
}
