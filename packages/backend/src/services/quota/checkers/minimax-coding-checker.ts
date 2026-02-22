import type { QuotaCheckResult, QuotaWindow, QuotaCheckerConfig } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { logger } from '../../../utils/logger';

interface MiniMaxCodingModelRemain {
  start_time: number;
  end_time: number;
  remains_time: number;
  current_interval_total_count: number;
  current_interval_usage_count: number;
  model_name: string;
}

interface MiniMaxCodingResponse {
  model_remains: MiniMaxCodingModelRemain[];
  base_resp: {
    status_code: number;
    status_msg: string;
  };
}

export class MiniMaxCodingQuotaChecker extends QuotaChecker {
  private endpoint: string;

  constructor(config: QuotaCheckerConfig) {
    super(config);
    this.endpoint = this.getOption<string>('endpoint', 'https://www.minimax.io/v1/api/openplatform/coding_plan/remains');
  }

  async checkQuota(): Promise<QuotaCheckResult> {
    const apiKey = this.requireOption<string>('apiKey');

    try {
      logger.debug(`[minimax-coding] Calling ${this.endpoint}`);

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

      const data: MiniMaxCodingResponse = await response.json();

      if (data.base_resp?.status_code !== 0) {
        return this.errorResult(new Error(`MiniMax API error: ${data.base_resp?.status_msg || 'unknown error'}`));
      }

      // All models share the same quota pool - use first entry
      const firstModel = data.model_remains[0];
    if (!firstModel) {
        return this.successResult([]);
      }

      const limit = firstModel.current_interval_total_count;
      // API field is misleading: "usage_count" is actually REMAINING, not used
      const remaining = firstModel.current_interval_usage_count;
      const used = limit - remaining;
      const resetsAt = new Date(firstModel.end_time);

      const window = this.createWindow(
        'custom',
        limit,
        used,
        remaining,
        'requests',
        resetsAt,
        'Coding plan'
      );

      return this.successResult([window]);
    } catch (error) {
      return this.errorResult(error as Error);
    }
  }
}
