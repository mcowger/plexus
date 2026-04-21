import type { QuotaCheckResult, QuotaWindow, QuotaCheckerConfig } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { logger } from '../../../utils/logger';

interface ZenmuxQuotaData {
  usage_percentage: number;
  resets_at: string;
  max_flows: number;
  used_flows: number;
  remaining_flows: number;
  used_value_usd: number;
  max_value_usd: number;
}

interface ZenmuxPlan {
  tier: string;
  amount_usd: number;
  interval: string;
  expires_at: string;
}

interface ZenmuxSubscriptionResponse {
  success: boolean;
  data: {
    plan: ZenmuxPlan;
    currency: string;
    base_usd_per_flow: number;
    effective_usd_per_flow: number;
    account_status: string;
    quota_5_hour: ZenmuxQuotaData;
    quota_7_day: ZenmuxQuotaData;
    quota_monthly: {
      max_flows: number;
      max_value_usd: number;
    };
  };
}

export class ZenmuxQuotaChecker extends QuotaChecker {
  readonly category = 'rate-limit' as const;
  private endpoint: string;

  constructor(config: QuotaCheckerConfig) {
    super(config);
    this.endpoint = this.getOption<string>(
      'endpoint',
      'https://zenmux.ai/api/v1/management/subscription/detail'
    );
  }

  async checkQuota(): Promise<QuotaCheckResult> {
    const apiKey = this.requireOption<string>('apiKey');

    try {
      logger.debug(`[zenmux] Checking quota at ${this.endpoint}`);

      const response = await fetch(this.endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => null);
        logger.error(`[zenmux] HTTP error ${response.status}: ${errorBody || response.statusText}`);
        return this.errorResult(new Error(`HTTP ${response.status}: ${response.statusText}`));
      }

      const data: ZenmuxSubscriptionResponse = await response.json();

      if (!data.success || !data.data) {
        return this.errorResult(new Error('Invalid response from Zenmux API'));
      }

      const subscription = data.data;
      const windows: QuotaWindow[] = [];

      // Add 5-hour quota window
      if (subscription.quota_5_hour) {
        windows.push(
          this.createWindow(
            'five_hour',
            subscription.quota_5_hour.max_flows,
            subscription.quota_5_hour.used_flows,
            subscription.quota_5_hour.remaining_flows,
            'points',
            new Date(subscription.quota_5_hour.resets_at),
            `Zenmux 5-hour quota (${subscription.plan.tier} plan)`
          )
        );
      }

      // Add 7-day quota window (mapped to weekly)
      if (subscription.quota_7_day) {
        windows.push(
          this.createWindow(
            'weekly',
            subscription.quota_7_day.max_flows,
            subscription.quota_7_day.used_flows,
            subscription.quota_7_day.remaining_flows,
            'points',
            new Date(subscription.quota_7_day.resets_at),
            `Zenmux 7-day quota (${subscription.plan.tier} plan)`
          )
        );
      }

      // Add monthly quota window
      if (subscription.quota_monthly) {
        windows.push(
          this.createWindow(
            'monthly',
            subscription.quota_monthly.max_flows,
            undefined,
            undefined,
            'points',
            undefined,
            `Zenmux monthly quota (${subscription.plan.tier} plan)`
          )
        );
      }

      logger.debug(
        `[zenmux] Returning ${windows.length} window(s) for tier ${subscription.plan.tier}`
      );

      return {
        ...this.successResult(windows),
        rawResponse: data,
      };
    } catch (error) {
      logger.error(`[zenmux] Error checking quota: ${(error as Error).message}`);
      return this.errorResult(error as Error);
    }
  }
}
