import type { QuotaCheckResult, QuotaWindow, QuotaCheckerConfig } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { logger } from '../../../utils/logger';

interface ApertisUserResponse {
  data: {
    id: number;
    username: string;
    display_name: string;
    quota: number;
    used_quota: number;
    request_count: number;
    [key: string]: unknown;
  };
  message: string;
  success: boolean;
}

const APERTIS_DEFAULT_ENDPOINT = 'https://api.stima.tech/api/user/self';
const QUOTA_DIVISOR = 1000000;

export class ApertisQuotaChecker extends QuotaChecker {
  async checkQuota(): Promise<QuotaCheckResult> {
    const session = this.requireOption<string>('session').trim();
    const endpoint = this.getOption<string>('endpoint', APERTIS_DEFAULT_ENDPOINT);

    try {
      logger.silly(`[apertis] Calling ${endpoint}`);

      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'Cookie': `session=${session}`,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        return this.errorResult(new Error(`HTTP ${response.status}: ${response.statusText}`));
      }

      const data: ApertisUserResponse = await response.json();

      if (!data.success) {
        return this.errorResult(new Error(`Apertis API error: ${data.message || 'unknown error'}`));
      }

      const quotaRaw = data.data?.quota;
      if (typeof quotaRaw !== 'number' || !Number.isFinite(quotaRaw)) {
        return this.errorResult(new Error(`Invalid quota value received: ${quotaRaw}`));
      }

      const balanceDollars = quotaRaw / QUOTA_DIVISOR;

      const window: QuotaWindow = this.createWindow(
        'subscription',
        undefined,
        undefined,
        balanceDollars,
        'dollars',
        undefined,
        'Apertis account balance'
      );

      return this.successResult([window]);
    } catch (error) {
      return this.errorResult(error as Error);
    }
  }
}
