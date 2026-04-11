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
  weeklyTokenLimit?: {
    nextRegenAt?: string;
    percentRemaining?: number;
    maxCredits?: string;
    remainingCredits?: string;
    nextRegenCredits?: string;
  };
  rollingFiveHourLimit?: {
    nextTickAt?: string;
    tickPercent?: number;
    remaining?: number;
    max?: number;
    limited?: boolean;
  };
}

export class SyntheticQuotaChecker extends QuotaChecker {
  readonly category = 'rate-limit' as const;
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
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        return this.errorResult(new Error(`HTTP ${response.status}: ${response.statusText}`));
      }

      const data: SyntheticQuotaResponse = await response.json();
      const windows: QuotaWindow[] = [];

      if (data.rollingFiveHourLimit) {
        const { remaining, max, nextTickAt } = data.rollingFiveHourLimit;
        windows.push(
          this.createWindow(
            'rolling_five_hour',
            max,
            max !== undefined && remaining !== undefined ? max - remaining : undefined,
            remaining,
            'requests',
            nextTickAt ? new Date(nextTickAt) : undefined,
            'Rolling 5-hour limit'
          )
        );
      }

      if (data.search?.hourly) {
        windows.push(
          this.createWindow(
            'search',
            data.search.hourly.limit,
            data.search.hourly.requests,
            data.search.hourly.remaining,
            'requests',
            data.search.hourly.renewsAt ? new Date(data.search.hourly.renewsAt) : undefined,
            'Search requests (hourly)'
          )
        );
      }

      if (data.weeklyTokenLimit) {
        const { maxCredits, remainingCredits, nextRegenAt } = data.weeklyTokenLimit;
        const parseCredits = (val?: string) => {
          if (!val) return undefined;
          const num = parseFloat(val.replace('$', ''));
          return isNaN(num) ? undefined : num;
        };
        const parsedMax = parseCredits(maxCredits);
        const parsedRemaining = parseCredits(remainingCredits);
        windows.push(
          this.createWindow(
            'rolling_weekly',
            parsedMax,
            parsedMax !== undefined && parsedRemaining !== undefined
              ? parsedMax - parsedRemaining
              : undefined,
            parsedRemaining,
            'dollars',
            nextRegenAt ? new Date(nextRegenAt) : undefined,
            'Weekly token credits'
          )
        );
      }

      return this.successResult(windows);
    } catch (error) {
      return this.errorResult(error as Error);
    }
  }
}
