import type { QuotaCheckResult, QuotaWindow, QuotaCheckerConfig, QuotaWindowType } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { logger } from '../../../utils/logger';

interface KimiUsageWindow {
  name?: string;
  title?: string;
  scope?: string;
  limit?: number;
  used?: number;
  remaining?: number;
  reset_at?: string;
  resetAt?: string;
  reset_time?: string;
  resetTime?: string;
}

interface KimiLimitWindow {
  duration?: number;
  timeUnit?: string;
}

interface KimiLimitDetail {
  limit?: number;
  used?: number;
  remaining?: number;
  reset_at?: string;
  resetAt?: string;
  reset_time?: string;
  resetTime?: string;
}

interface KimiLimit {
  name?: string;
  title?: string;
  scope?: string;
  window?: KimiLimitWindow;
  detail?: KimiLimitDetail;
}

interface KimiUsageResponse {
  usage?: KimiUsageWindow;
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
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        return this.errorResult(new Error(`HTTP ${response.status}: ${response.statusText}`));
      }

      const data: KimiUsageResponse = await response.json();
      const windows: QuotaWindow[] = [];

      // Top-level usage window (typically the weekly limit)
      if (data.usage) {
        const u = data.usage;
        const label = u.name || u.title || u.scope || 'Usage limit';
        const resetStr = u.reset_at || u.resetAt || u.reset_time || u.resetTime;
        const resetsAt = resetStr ? new Date(resetStr) : undefined;
        const windowType = this.inferWindowTypeFromLabel(label);

        windows.push(this.createWindow(
          windowType,
          u.limit,
          u.used,
          u.remaining,
          'tokens',
          resetsAt,
          label,
        ));
      }

      // Per-interval rate limits from limits array
      if (data.limits) {
        for (const limit of data.limits) {
          const label = limit.name || limit.title || limit.scope || 'Rate limit';
          const windowType = limit.window
            ? this.inferWindowTypeFromDuration(limit.window)
            : this.inferWindowTypeFromLabel(label);

          if (!limit.detail) continue;

          const d = limit.detail;
          const resetStr = d.reset_at || d.resetAt || d.reset_time || d.resetTime;
          const resetsAt = resetStr ? new Date(resetStr) : undefined;

          windows.push(this.createWindow(
            windowType,
            d.limit,
            d.used,
            d.remaining,
            'tokens',
            resetsAt,
            label,
          ));
        }
      }

      logger.debug(`[kimi-code] Returning ${windows.length} windows`);
      return this.successResult(windows);
    } catch (error) {
      return this.errorResult(error as Error);
    }
  }

  private inferWindowTypeFromLabel(label: string): QuotaWindowType {
    const lower = label.toLowerCase();
    if (lower.includes('5h') || lower.includes('five hour') || lower.includes('5-hour')) return 'five_hour';
    if (lower.includes('hour')) return 'hourly';
    if (lower.includes('daily') || lower.includes('day')) return 'daily';
    if (lower.includes('weekly') || lower.includes('week')) return 'weekly';
    if (lower.includes('monthly') || lower.includes('month')) return 'monthly';
    return 'custom';
  }

  private inferWindowTypeFromDuration(window: KimiLimitWindow): QuotaWindowType {
    if (!window.duration || !window.timeUnit) return 'custom';

    const unit = window.timeUnit.toUpperCase();
    let totalMinutes = window.duration;

    if (unit === 'HOUR') totalMinutes = window.duration * 60;
    else if (unit === 'DAY') totalMinutes = window.duration * 60 * 24;

    if (totalMinutes === 300) return 'five_hour';
    if (totalMinutes <= 60) return 'hourly';
    if (totalMinutes <= 1440) return 'daily';
    if (totalMinutes <= 10080) return 'weekly';
    return 'monthly';
  }
}
