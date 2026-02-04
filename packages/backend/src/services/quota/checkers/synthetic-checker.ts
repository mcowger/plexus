import type { QuotaCheckResult, QuotaWindow, QuotaCheckerConfig } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';

interface SyntheticQuotaResponse {
  subscription?: {
    limit?: number;
    requests?: number;
    remaining?: number;
    renewsAt?: string;
  };
  search?: {
    hourly?: {
      limit?: number;
      requests?: number;
      remaining?: number;
      renewsAt?: string;
    };
  };
  toolCallDiscounts?: {
    limit?: number;
    requests?: number;
    remaining?: number;
    renewsAt?: string;
  };
}

export class SyntheticQuotaChecker extends QuotaChecker {
  private endpoint: string;

  constructor(config: QuotaCheckerConfig) {
    super(config);
    this.endpoint = this.getOption<string>('endpoint', 'https://api.synthetic.new/v2/quotas');
  }

  async checkQuota(): Promise<QuotaCheckResult> {
    const apiKey = this.requireOption<string>('apiKey');

    try {
      const response = await fetch(this.endpoint, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        return this.errorResult(new Error(`HTTP ${response.status}: ${response.statusText}`));
      }

      const data: SyntheticQuotaResponse = await response.json();
      const windows: QuotaWindow[] = [];

      if (data.subscription) {
        windows.push(this.createWindow(
          'subscription',
          data.subscription.limit,
          data.subscription.requests,
          data.subscription.remaining,
          'dollars',
          data.subscription.renewsAt ? new Date(data.subscription.renewsAt) : undefined,
          'Monthly subscription quota'
        ));
      }

      if (data.search?.hourly) {
        windows.push(this.createWindow(
          'hourly',
          data.search.hourly.limit,
          data.search.hourly.requests,
          data.search.hourly.remaining,
          'requests',
          data.search.hourly.renewsAt ? new Date(data.search.hourly.renewsAt) : undefined,
          'Hourly search request quota'
        ));
      }

      if (data.toolCallDiscounts) {
        windows.push(this.createWindow(
          'daily',
          data.toolCallDiscounts.limit,
          data.toolCallDiscounts.requests,
          data.toolCallDiscounts.remaining,
          'requests',
          data.toolCallDiscounts.renewsAt ? new Date(data.toolCallDiscounts.renewsAt) : undefined,
          'Daily tool call discount quota'
        ));
      }

      return this.successResult(windows);
    } catch (error) {
      return this.errorResult(error as Error);
    }
  }
}