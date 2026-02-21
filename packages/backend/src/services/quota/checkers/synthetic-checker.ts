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
  freeToolCalls?: {
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
          'five_hour',
          data.subscription.limit,
          data.subscription.requests,
          data.subscription.remaining,
          'requests',
          data.subscription.renewsAt ? new Date(data.subscription.renewsAt) : undefined,
          '5-hour request quota'
        ));
      }

      if (data.search?.hourly) {
        windows.push(this.createWindow(
          'search',
          data.search.hourly.limit,
          data.search.hourly.requests,
          data.search.hourly.remaining,
          'requests',
          data.search.hourly.renewsAt ? new Date(data.search.hourly.renewsAt) : undefined,
          'Search requests (hourly)'
        ));
      }

      if (data.freeToolCalls) {
        windows.push(this.createWindow(
          'toolcalls',
          data.freeToolCalls.limit,
          data.freeToolCalls.requests,
          data.freeToolCalls.remaining,
          'requests',
          data.freeToolCalls.renewsAt ? new Date(data.freeToolCalls.renewsAt) : undefined,
          'Free tool calls (5-hour)'
        ));
      }

      return this.successResult(windows);
    } catch (error) {
      return this.errorResult(error as Error);
    }
  }
}