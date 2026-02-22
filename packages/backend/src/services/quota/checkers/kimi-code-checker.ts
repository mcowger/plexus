import type { QuotaCheckResult, QuotaWindow, QuotaCheckerConfig, QuotaWindowType } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { logger } from '../../../utils/logger';

// Matches the actual Kimi Coding API response shape.
// Note: numeric fields are returned as strings by the API.
interface KimiUsage {
  limit: string;
  used: string;
  remaining: string;
  resetTime: string;
}

interface KimiLimitDetail {
  limit: string;
  remaining: string;
  resetTime: string;
}

interface KimiLimit {
  window: {
    duration: number;
    timeUnit: string;
  };
  detail: KimiLimitDetail;
}

interface KimiUsageResponse {
  usage?: KimiUsage;
  limits?: KimiLimit[];
}

export class KimiCodeQuotaChecker extends QuotaChecker {
  private endpoint: string;

  constructor(config: QuotaCheckerConfig) {
    super(config);
    this.endpoint = this.getOption<string>('endpoint', 'https://api.kimi.com/coding/v1/usages');
  }

  async checkQuota(): Promise<QuotaCheckResult> {
    const apiKey = this.requireOption<string>('apiKey');

    try {
      logger.debug(`[kimi-code] Fetching usage from ${this.endpoint}`);

      const response = await fetch(this.endpoint, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        return this.errorResult(new Error(`HTTP ${response.status}: ${response.statusText}`));
      }

      const data: KimiUsageResponse = await response.json();
      const windows: QuotaWindow[] = [];

      if (data.usage) {
        windows.push(this.createWindow(
          'custom',
          Number(data.usage.limit),
          Number(data.usage.used),
          Number(data.usage.remaining),
          'requests',
          new Date(data.usage.resetTime),
          'Usage limit',
        ));
      }

      if (data.limits) {
        for (const entry of data.limits) {
          if (!entry.detail) continue;

          const limit = Number(entry.detail.limit);
          const remaining = Number(entry.detail.remaining);

          windows.push(this.createWindow(
            this.windowTypeFromDuration(entry.window),
            limit,
            limit - remaining,
            remaining,
            'requests',
            new Date(entry.detail.resetTime),
            'Rate limit',
          ));
        }
      }

      logger.debug(`[kimi-code] Returning ${windows.length} windows`);
      return this.successResult(windows);
    } catch (error) {
      return this.errorResult(error as Error);
    }
  }

  private windowTypeFromDuration(window: { duration: number; timeUnit: string }): QuotaWindowType {
    let totalMinutes = window.duration;

    // API uses TIME_UNIT_MINUTE, TIME_UNIT_HOUR, etc.
    if (window.timeUnit === 'TIME_UNIT_HOUR') totalMinutes *= 60;
    else if (window.timeUnit === 'TIME_UNIT_DAY') totalMinutes *= 60 * 24;

    if (totalMinutes === 300) return 'five_hour';
    if (totalMinutes <= 60) return 'hourly';
    if (totalMinutes <= 1440) return 'daily';
    if (totalMinutes <= 10080) return 'weekly';
    return 'monthly';
  }
}
