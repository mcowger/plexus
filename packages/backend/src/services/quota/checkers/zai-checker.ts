import type { QuotaCheckResult, QuotaWindow, QuotaCheckerConfig } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { logger } from '../../../utils/logger';

interface ZAIQuotaLimitResponse {
  code: number;
  msg: string;
  success: boolean;
  data?: {
    limits?: Array<{
      type: 'TOKENS_LIMIT' | 'TIME_LIMIT';
      percentage: number;
      currentValue?: number;
      remaining?: number;
      total?: number;
      usageDetails?: Array<{ type: string; usage: number }>;
      nextResetTime?: number;
    }>;
    level?: string;
  };
}

export class ZAIQuotaChecker extends QuotaChecker {
  private endpoint: string;

  constructor(config: QuotaCheckerConfig) {
    super(config);
    this.endpoint = this.getOption<string>('endpoint', 'https://api.z.ai/api/monitor/usage/quota/limit');
  }

  async checkQuota(): Promise<QuotaCheckResult> {
    const apiKey = this.requireOption<string>('apiKey');

    try {
      logger.silly(`[zai-checker] Calling ${this.endpoint}`);
      
      const response = await fetch(this.endpoint, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept-Language': 'en-US,en',
          'Content-Type': 'application/json',
        },
      });

      logger.silly(`[zai-checker] Response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        logger.silly(`[zai-checker] Error response: ${errorText}`);
        return this.errorResult(new Error(`HTTP ${response.status}: ${response.statusText}`));
      }

      const data: ZAIQuotaLimitResponse = await response.json();
      logger.silly(`[zai-checker] Response data: ${JSON.stringify(data)}`);
      
      const windows: QuotaWindow[] = [];
      const limits = data.data?.limits ?? [];

      if (limits) {
        for (const limit of limits) {
          if (limit.type === 'TOKENS_LIMIT') {
            windows.push(this.createWindow(
              'five_hour',
              100,
              limit.percentage,
              undefined,
              'percentage',
              undefined,
              'Token usage (5 Hour)'
            ));
          } else if (limit.type === 'TIME_LIMIT') {
            windows.push(this.createWindow(
              'monthly',
              limit.total ?? limit.remaining,
              limit.currentValue,
              limit.remaining,
              'requests',
              limit.nextResetTime ? new Date(limit.nextResetTime) : undefined,
              'MCP usage (1 Month)'
            ));
          }
        }
      }

      logger.silly(`[zai-checker] Returning ${windows.length} windows`);
      return this.successResult(windows);
    } catch (error) {
      return this.errorResult(error as Error);
    }
  }
}
