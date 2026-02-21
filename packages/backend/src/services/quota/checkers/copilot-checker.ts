import type { QuotaCheckResult, QuotaCheckerConfig, QuotaWindow } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { logger } from '../../../utils/logger';
import { OAuthAuthManager } from '../../oauth-auth-manager';
import type { OAuthProvider } from '@mariozechner/pi-ai';

interface CopilotUsageResponse {
  quota_reset_date_utc?: string;
  quota_snapshots?: {
    premium_interactions?: {
      percent_remaining?: number;
      remaining?: number;
      entitlement?: number;
    };
  };
}

export class CopilotQuotaChecker extends QuotaChecker {
  private endpoint: string;
  private userAgent: string;
  private editorVersion: string;
  private apiVersion: string;
  private timeoutMs: number;

  constructor(config: QuotaCheckerConfig) {
    super(config);
    this.endpoint = this.getOption<string>('endpoint', 'https://api.github.com/copilot_internal/user');
    this.userAgent = this.getOption<string>('userAgent', 'GitHubCopilotChat/0.26.7');
    this.editorVersion = this.getOption<string>('editorVersion', 'vscode/1.96.2');
    this.apiVersion = this.getOption<string>('apiVersion', '2025-04-01');
    this.timeoutMs = this.getOption<number>('timeoutMs', 15000);
  }

  async checkQuota(): Promise<QuotaCheckResult> {
    try {
      const apiKey = await this.resolveApiKey();

      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), this.timeoutMs);

      logger.silly(`[copilot-checker] Requesting usage for '${this.id}' from ${this.endpoint}`);
      logger.silly(`[copilot-checker] Token length: ${apiKey.length}, starts with: ${apiKey.substring(0, 10)}...`);

      const headers = {
        'Authorization': `token ${apiKey}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Editor-Version': this.editorVersion,
        'User-Agent': this.userAgent,
        'X-Github-Api-Version': this.apiVersion,
      };
      logger.silly(`[copilot-checker] Request headers: ${JSON.stringify(headers, null, 2)}`);

      const response = await fetch(this.endpoint, {
        method: 'GET',
        headers,
        signal: abortController.signal,
      }).finally(() => clearTimeout(timeout));

      logger.silly(`[copilot-checker] Response status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        return this.errorResult(new Error(`HTTP ${response.status}: ${response.statusText}`));
      }

      const data: CopilotUsageResponse = await response.json();
      
      const windows: QuotaWindow[] = [];
      const resetDate = data.quota_reset_date_utc ? new Date(data.quota_reset_date_utc) : undefined;

      if (data.quota_snapshots?.premium_interactions) {
        const pi = data.quota_snapshots.premium_interactions;
        const percentRemaining = pi.percent_remaining ?? 0;
        const usedPercent = Math.max(0, 100 - percentRemaining);

        windows.push(this.createWindow(
          'monthly',
          100,
          usedPercent,
          percentRemaining,
          'percentage',
          resetDate,
          'GitHub Copilot premium interactions'
        ));
      }

      if (windows.length === 0) {
        return this.errorResult(new Error('No quota data found in response'));
      }

      return this.successResult(windows);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return this.errorResult(new Error(`Request timed out after ${this.timeoutMs}ms`));
      }
      return this.errorResult(error as Error);
    }
  }

  private async resolveApiKey(): Promise<string> {
    const configuredApiKey = this.getOption<string>('apiKey', '').trim();
    if (configuredApiKey) {
      return configuredApiKey;
    }

    const provider = this.getOption<string>('oauthProvider', 'github-copilot').trim() || 'github-copilot';
    const oauthAccountId = this.getOption<string>('oauthAccountId', '').trim();
    const authManager = OAuthAuthManager.getInstance();

    // Get credentials directly to access the 'refresh' token
    const credentials = oauthAccountId
      ? authManager.getCredentials(provider as OAuthProvider, oauthAccountId)
      : authManager.getCredentials(provider as OAuthProvider);

    if (!credentials) {
      throw new Error(`No OAuth credentials found for provider '${provider}'${oauthAccountId ? ` account '${oauthAccountId}'` : ''}`);
    }

    // For Copilot, we need the 'refresh' token (ghu_...) not the 'access' cookie
    const refreshToken = (credentials as Record<string, unknown>)?.refresh as string | undefined;
    if (refreshToken) {
      return refreshToken;
    }

    // Fallback to the standard API key method if refresh is not available
    try {
      return oauthAccountId
        ? await authManager.getApiKey(provider as OAuthProvider, oauthAccountId)
        : await authManager.getApiKey(provider as OAuthProvider);
    } catch {
      authManager.reload();
      logger.info(`[copilot-checker] Reloaded OAuth auth file and retrying token retrieval for provider '${provider}'.`);
      return oauthAccountId
        ? await authManager.getApiKey(provider as OAuthProvider, oauthAccountId)
        : await authManager.getApiKey(provider as OAuthProvider);
    }
  }
}
