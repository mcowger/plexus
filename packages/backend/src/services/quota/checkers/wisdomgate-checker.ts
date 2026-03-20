import type { QuotaCheckResult, QuotaWindow, QuotaCheckerConfig } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { logger } from '../../../utils/logger';

interface WisdomGateUsageResponse {
  object: string;
  total_usage: number;
  total_available: number;
  regular_amount: number;
  package_details: Array<{
    package_id: string;
    title: string;
    amount: number;
    total_amount: number;
    expiry_time: number;
    expiry_date: string;
    begin_time: number;
    begin_date: string;
  }>;
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

      const packageDetail = data.package_details?.[0];
      if (!packageDetail) {
        return this.errorResult(new Error('No package details found in response'));
      }

      const limit = packageDetail.total_amount;
      const remaining = packageDetail.amount;
      const used = packageDetail.total_amount - packageDetail.amount;
      const resetsAt = new Date(packageDetail.expiry_time * 1000);

      const window: QuotaWindow = this.createWindow(
        'monthly',
        limit,
        used,
        remaining,
        'dollars',
        resetsAt,
        'Wisdom Gate monthly subscription'
      );

      return this.successResult([window]);
    } catch (error) {
      return this.errorResult(error as Error);
    }
  }
}
