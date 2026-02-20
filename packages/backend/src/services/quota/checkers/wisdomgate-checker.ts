import type { QuotaCheckResult, QuotaWindow, QuotaCheckerConfig } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { logger } from '../../../utils/logger';

interface WisdomGatePackageDetail {
  package_id: string;
  title: string;
  amount: number;
  total_amount: number;
  expiry_time: number;
  expiry_date: string;
  begin_time: number;
  begin_date: string;
}

interface WisdomGateUsageResponse {
  object: string;
  total_usage: number;
  total_available: number;
  regular_amount: number;
  package_details: WisdomGatePackageDetail[];
}

export class WisdomGateQuotaChecker extends QuotaChecker {
  async checkQuota(): Promise<QuotaCheckResult> {
    const sessionCookie = this.requireOption<string>('session').trim();

    try {
      const endpoint = 'https://wisdom-gate.juheapi.com/api/dashboard/billing/usage/details';
      logger.silly(`[wisdomgate] Calling ${endpoint}`);

      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'Cookie': `session=${sessionCookie}`,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        return this.errorResult(new Error(`HTTP ${response.status}: ${response.statusText}`));
      }

      const data: WisdomGateUsageResponse = await response.json();

      const packageDetail = data.package_details?.[0];
      if (!packageDetail) {
        return this.errorResult(new Error('No package details found in response'));
      }

      const limit = packageDetail.total_amount;
      const remaining = packageDetail.amount;
      const used = limit - remaining;
      const resetsAt = new Date(packageDetail.expiry_time * 1000);

      const window: QuotaWindow = this.createWindow(
        'monthly',
        limit,
        used,
        remaining,
        'dollars',
        resetsAt,
        'Wisdom Gate monthly credits'
      );

      return this.successResult([window]);
    } catch (error) {
      return this.errorResult(error as Error);
    }
  }
}
