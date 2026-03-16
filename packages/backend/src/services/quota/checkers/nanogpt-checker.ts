import type { QuotaCheckResult, QuotaWindow, QuotaCheckerConfig } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { logger } from '../../../utils/logger';

interface NanoGPTUsageWindow {
  used?: number;
  remaining?: number;
  percentUsed?: number;
  resetAt?: number;
}

interface NanoGPTQuotaResponse {
  active?: boolean;
  provider?: string;
  providerStatus?: string;
  providerStatusRaw?: string;
  stripeSubscriptionId?: string;
  cancellationReason?: string | null;
  canceledAt?: string | null;
  endedAt?: string | null;
  cancelAt?: string | null;
  cancelAtPeriodEnd?: boolean;
  limits?: {
    weeklyInputTokens?: number | null;
    dailyInputTokens?: number | null;
    dailyImages?: number | null;
  };
  allowOverage?: boolean;
  period?: {
    currentPeriodEnd?: string;
  };
  dailyImages?: NanoGPTUsageWindow | null;
  dailyInputTokens?: NanoGPTUsageWindow | null;
  weeklyInputTokens?: NanoGPTUsageWindow | null;
  state?: 'active' | 'grace' | 'inactive';
  graceUntil?: string | null;
}

export class NanoGPTQuotaChecker extends QuotaChecker {
  readonly category = 'rate-limit' as const;
  private endpoint: string;

  constructor(config: QuotaCheckerConfig) {
    super(config);
    this.endpoint = this.getOption<string>(
      'endpoint',
      'https://nano-gpt.com/api/subscription/v1/usage'
    );
  }

  async checkQuota(): Promise<QuotaCheckResult> {
    const rawApiKey = this.requireOption<string>('apiKey');
    const apiKey = this.normalizeApiKey(rawApiKey);
    const authHeaderStrategies: HeadersInit[] = [
      {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      {
        'x-api-key': apiKey,
        Accept: 'application/json',
      },
      {
        Authorization: `Bearer ${apiKey}`,
        'x-api-key': apiKey,
        Accept: 'application/json',
      },
    ];

    let lastAuthError: Error | null = null;

    try {
      for (const headers of authHeaderStrategies) {
        const response = await fetch(this.endpoint, {
          method: 'GET',
          headers,
        });

        if (response.ok) {
          const data: NanoGPTQuotaResponse = await response.json();
          return this.buildSuccessResult(data);
        }

        const bodyPreview = await this.readBodyPreview(response);
        const errorMessage = bodyPreview
          ? `HTTP ${response.status}: ${response.statusText} - ${bodyPreview}`
          : `HTTP ${response.status}: ${response.statusText}`;

        if (response.status === 401 || response.status === 403) {
          lastAuthError = new Error(errorMessage);
          continue;
        }

        return this.errorResult(new Error(errorMessage));
      }

      if (lastAuthError) {
        return this.errorResult(lastAuthError);
      }

      return this.errorResult('NanoGPT quota check failed due to unknown authentication error');
    } catch (error) {
      return this.errorResult(error as Error);
    }
  }

  private buildSuccessResult(data: NanoGPTQuotaResponse): QuotaCheckResult {
    logger.debug(
      `[nanogpt] subscription state=${data.state ?? 'unknown'} active=${data.active} ` +
        `hasWeeklyTokens=${!!data.weeklyInputTokens} hasDailyTokens=${!!data.dailyInputTokens} ` +
        `hasDailyImages=${!!data.dailyImages} allowOverage=${data.allowOverage} ` +
        `graceUntil=${data.graceUntil ?? 'none'}`
    );

    // Account is inactive — no subscription at all
    if (data.active === false && data.state === 'inactive') {
      return this.errorResult(
        'NanoGPT subscription is inactive. No quota windows are available for this account.'
      );
    }

    // Account is in grace period — log a note but continue
    if (data.state === 'grace') {
      const graceNote = data.graceUntil ? ` Grace access ends at ${data.graceUntil}.` : '';
      logger.debug(`[nanogpt] Account is in grace period.${graceNote}`);
    }

    const windows: QuotaWindow[] = [];

    if (data.weeklyInputTokens) {
      windows.push(
        this.createWindow(
          'weekly',
          data.limits?.weeklyInputTokens ?? undefined,
          data.weeklyInputTokens.used,
          data.weeklyInputTokens.remaining,
          'tokens',
          typeof data.weeklyInputTokens.resetAt === 'number'
            ? new Date(data.weeklyInputTokens.resetAt)
            : undefined,
          'NanoGPT weekly input token quota'
        )
      );
    }

    if (data.dailyInputTokens) {
      windows.push(
        this.createWindow(
          'daily',
          data.limits?.dailyInputTokens ?? undefined,
          data.dailyInputTokens.used,
          data.dailyInputTokens.remaining,
          'tokens',
          typeof data.dailyInputTokens.resetAt === 'number'
            ? new Date(data.dailyInputTokens.resetAt)
            : undefined,
          'NanoGPT daily input token quota'
        )
      );
    }

    if (data.dailyImages) {
      windows.push(
        this.createWindow(
          'daily',
          data.limits?.dailyImages ?? undefined,
          data.dailyImages.used,
          data.dailyImages.remaining,
          'requests',
          typeof data.dailyImages.resetAt === 'number'
            ? new Date(data.dailyImages.resetAt)
            : undefined,
          'NanoGPT daily image generation quota'
        )
      );
    }

    if (windows.length === 0) {
      return this.errorResult(
        `NanoGPT quota response (state=${data.state ?? 'unknown'}, active=${data.active}) ` +
          'did not include any usage windows (weeklyInputTokens, dailyInputTokens, dailyImages). ' +
          'This account may not have an active subscription.'
      );
    }

    logger.debug(`[nanogpt] Returning ${windows.length} window(s)`);
    return {
      ...this.successResult(windows),
      rawResponse: data,
    };
  }

  private async readBodyPreview(response: Response): Promise<string | null> {
    try {
      const text = (await response.text()).trim();
      if (!text) return null;
      return text.slice(0, 500);
    } catch {
      return null;
    }
  }

  private normalizeApiKey(apiKey: string): string {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      throw new Error('NanoGPT API key is required');
    }

    const withoutWrapperQuotes =
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
        ? trimmed.slice(1, -1).trim()
        : trimmed;

    if (!withoutWrapperQuotes) {
      throw new Error('NanoGPT API key is required');
    }

    const bearerStripped = withoutWrapperQuotes.toLowerCase().startsWith('bearer ')
      ? withoutWrapperQuotes.slice(7).trim()
      : withoutWrapperQuotes;

    const normalized = bearerStripped.replace(/\s+/g, '');

    if (!normalized) {
      throw new Error('NanoGPT API key is empty after normalization');
    }

    return normalized;
  }
}
