import type { QuotaCheckResult, QuotaWindow } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { logger } from '../../../utils/logger';

interface WisdomGateUsageResponse {
  object: string;
  total_usage: number;
  total_available: number;
  regular_amount: number;
}

export class WisdomGateQuotaChecker extends QuotaChecker {
  readonly category = 'rate-limit' as const;

  async checkQuota(): Promise<QuotaCheckResult> {
    const session = this.requireOption<string>('session');
    const endpoint =
      this.getOption<string>(
        'endpoint',
        'https://wisgate.ai/api/dashboard/billing/usage/details'
      ) || 'https://wisgate.ai/api/dashboard/billing/usage/details';

    try {
      logger.silly(`[wisdomgate] Calling ${endpoint}`);

      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Cookie: `session=${session}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        return this.errorResult(new Error(`HTTP ${response.status}: ${response.statusText}`));
      }

      const data: WisdomGateUsageResponse = await response.json();

      logger.silly(`[wisdomgate] Response: ${JSON.stringify(data)}`);

      const used = data.total_usage;
      const remaining = data.total_available;
      const limit = used + remaining;

      const window: QuotaWindow = this.createWindow(
        'subscription',
        limit,
        used,
        remaining,
        'dollars',
        undefined,
        'Wisdom Gate subscription'
      );

      return this.successResult([window]);
    } catch (error) {
      return this.errorResult(error as Error);
    }
  }
}
