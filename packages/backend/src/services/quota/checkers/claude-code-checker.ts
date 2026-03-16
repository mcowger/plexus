import type { QuotaCheckResult, QuotaWindow, QuotaCheckerConfig } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { logger } from '../../../utils/logger';
import { OAuthAuthManager } from '../../oauth-auth-manager';
import type { OAuthProvider } from '@mariozechner/pi-ai/oauth';

interface UsageWindow {
  utilization: number;
  resets_at: string;
}

interface OAuthUsageResponse {
  five_hour: UsageWindow | null;
  seven_day: UsageWindow | null;
  seven_day_oauth_apps: UsageWindow | null;
  seven_day_opus: UsageWindow | null;
  seven_day_sonnet: UsageWindow | null;
  seven_day_cowork: UsageWindow | null;
  extra_usage: {
    is_enabled: boolean;
    monthly_limit: number | null;
    used_credits: number | null;
    utilization: number | null;
  } | null;
  [key: string]: unknown;
}

export class ClaudeCodeQuotaChecker extends QuotaChecker {
  readonly category = 'rate-limit' as const;
  private endpoint: string;

  constructor(config: QuotaCheckerConfig) {
    super(config);
    this.endpoint = this.getOption<string>('endpoint', 'https://api.anthropic.com/api/oauth/usage');
  }

  async checkQuota(): Promise<QuotaCheckResult> {
    try {
      const apiKey = await this.resolveApiKey();
      logger.silly(`[claude-code-checker] Fetching usage from ${this.endpoint}`);

      const response = await fetch(this.endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'anthropic-beta': 'oauth-2025-04-20',
        },
      });

      logger.silly(`[claude-code-checker] Response status: ${response.status}`);

      if (!response.ok) {
        return this.errorResult(new Error(`HTTP ${response.status}: ${response.statusText}`));
      }

      const usage = (await response.json()) as OAuthUsageResponse;
      logger.silly(`[claude-code-checker] Usage response: ${JSON.stringify(usage)}`);

      const windows: QuotaWindow[] = [];

      if (usage.five_hour) {
        logger.silly(
          `[claude-code-checker] 5h - utilization: ${usage.five_hour.utilization}, resets_at: ${usage.five_hour.resets_at}`
        );
        windows.push(
          this.createWindow(
            'five_hour',
            100,
            usage.five_hour.utilization,
            undefined,
            'percentage',
            new Date(usage.five_hour.resets_at),
            '5-hour request quota'
          )
        );
      }

      if (usage.seven_day) {
        logger.silly(
          `[claude-code-checker] 7d - utilization: ${usage.seven_day.utilization}, resets_at: ${usage.seven_day.resets_at}`
        );
        windows.push(
          this.createWindow(
            'weekly',
            100,
            usage.seven_day.utilization,
            undefined,
            'percentage',
            new Date(usage.seven_day.resets_at),
            'Weekly request quota'
          )
        );
      }

      logger.silly(`[claude-code-checker] Returning ${windows.length} windows`);
      return this.successResult(windows);
    } catch (error) {
      return this.errorResult(error as Error);
    }
  }

  private async resolveApiKey(): Promise<string> {
    const configuredApiKey = this.getOption<string>('apiKey', '').trim();
    if (configuredApiKey) {
      return configuredApiKey;
    }

    const provider = this.getOption<string>('oauthProvider', 'anthropic').trim() || 'anthropic';
    const oauthAccountId = this.getOption<string>('oauthAccountId', '').trim();
    const authManager = OAuthAuthManager.getInstance();

    const rawCreds = oauthAccountId
      ? authManager.getCredentials(provider as OAuthProvider, oauthAccountId)
      : authManager.getCredentials(provider as OAuthProvider);
    logger.debug(
      `[claude-code-checker] resolveApiKey for '${this.id}' — ` +
        `refresh=${rawCreds?.refresh ? `present(${rawCreds.refresh.length} chars)` : 'MISSING'}, ` +
        `access=${rawCreds?.access ? `present(${rawCreds.access.length} chars)` : 'MISSING'}, ` +
        `expires=${rawCreds?.expires} (${rawCreds && rawCreds.expires > Date.now() ? 'valid' : 'EXPIRED or missing'})`
    );

    try {
      return oauthAccountId
        ? await authManager.getApiKey(provider as OAuthProvider, oauthAccountId)
        : await authManager.getApiKey(provider as OAuthProvider);
    } catch {
      authManager.reload();
      logger.info(
        `[claude-code-checker] Reloaded OAuth auth file and retrying token retrieval for provider '${provider}'.`
      );
      return oauthAccountId
        ? await authManager.getApiKey(provider as OAuthProvider, oauthAccountId)
        : await authManager.getApiKey(provider as OAuthProvider);
    }
  }
}
