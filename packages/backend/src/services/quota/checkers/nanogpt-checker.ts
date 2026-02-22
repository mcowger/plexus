import type { QuotaCheckResult, QuotaWindow, QuotaCheckerConfig } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';

interface NanoGPTUsageWindow {
  used?: number;
  remaining?: number;
  percentUsed?: number;
  resetAt?: number;
}

interface NanoGPTQuotaResponse {
  active?: boolean;
  limits?: {
    daily?: number;
    monthly?: number;
  };
  enforceDailyLimit?: boolean;
  daily?: NanoGPTUsageWindow;
  monthly?: NanoGPTUsageWindow;
  period?: {
    currentPeriodEnd?: string;
  };
  state?: 'active' | 'grace' | 'inactive';
  graceUntil?: string | null;
}

export class NanoGPTQuotaChecker extends QuotaChecker {
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
    const windows: QuotaWindow[] = [];

    if (data.daily) {
      windows.push(
        this.createWindow(
          'daily',
          data.limits?.daily,
          data.daily.used,
          data.daily.remaining,
          'requests',
          typeof data.daily.resetAt === 'number' ? new Date(data.daily.resetAt) : undefined,
          'NanoGPT daily subscription usage quota'
        )
      );
    }

    if (data.monthly) {
      windows.push(
        this.createWindow(
          'monthly',
          data.limits?.monthly,
          data.monthly.used,
          data.monthly.remaining,
          'requests',
          typeof data.monthly.resetAt === 'number' ? new Date(data.monthly.resetAt) : undefined,
          'NanoGPT monthly subscription usage quota'
        )
      );
    }

    if (windows.length === 0) {
      return this.errorResult(
        'NanoGPT quota response did not include daily or monthly usage windows'
      );
    }

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
