import type { QuotaCheckResult, QuotaCheckerConfig, QuotaWindow, QuotaWindowType } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { OAuthAuthManager } from '../../oauth-auth-manager';
import type { OAuthProvider } from '@mariozechner/pi-ai';
import { logger } from '../../../utils/logger';

interface OAuthCredentialsBlob {
  access_token?: string;
}

interface CodexUsageWindow {
  used_percent?: number;
  reset_at?: number;
  reset_after_seconds?: number;
  limit_window_seconds?: number;
}

interface CodexRateLimitInfo {
  allowed?: boolean;
  limit_reached?: boolean;
  primary_window?: CodexUsageWindow;
  secondary_window?: CodexUsageWindow;
}

interface CodexUsageResponse {
  plan_type?: string;
  rate_limit?: CodexRateLimitInfo;
  code_review_rate_limit?: CodexRateLimitInfo;
}

export class OpenAICodexQuotaChecker extends QuotaChecker {
  private endpoint: string;
  private userAgent: string;
  private timeoutMs: number;

  constructor(config: QuotaCheckerConfig) {
    super(config);
    this.endpoint = this.getOption<string>('endpoint', 'https://chatgpt.com/backend-api/wham/usage');
    this.userAgent = this.getOption<string>('userAgent', 'codex_cli_rs/0.101.0 (Debian 13.0.0; x86_64) WindowsTerminal');
    this.timeoutMs = this.getOption<number>('timeoutMs', 15000);
  }

  async checkQuota(): Promise<QuotaCheckResult> {
    try {
      const { accessToken, accountId: accountIdFromAuth } = await this.resolveAuthContext();
      const accountId = this.extractChatGPTAccountId(accessToken) ?? accountIdFromAuth;

      if (!accountId) {
        logger.warn(`[openai-codex-checker] Unable to extract chatgpt_account_id from token for '${this.id}'. Continuing without Chatgpt-Account-Id header.`);
      }

      const headers: Record<string, string> = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': this.userAgent,
        'Version': '0.101.0',
      };

      if (accountId) {
        headers['Chatgpt-Account-Id'] = accountId;
      }

      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), this.timeoutMs);

      logger.silly(`[openai-codex-checker] Requesting usage for '${this.id}' from ${this.endpoint}`);

      const response = await fetch(this.endpoint, {
        method: 'GET',
        headers,
        signal: abortController.signal,
      }).finally(() => clearTimeout(timeout));

      const bodyText = await response.text();
      if (!response.ok) {
        return this.errorResult(new Error(`quota request failed with status ${response.status}: ${bodyText}`));
      }

      let data: CodexUsageResponse;
      try {
        data = JSON.parse(bodyText) as CodexUsageResponse;
      } catch (error) {
        return this.errorResult(new Error(`failed to parse codex usage response: ${String(error)}`));
      }

      if (!data.rate_limit) {
        return this.errorResult(new Error(`codex usage response missing rate_limit: ${bodyText}`));
      }

      const windows = this.buildWindows(data.rate_limit);
      return {
        ...this.successResult(windows),
        rawResponse: data,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return this.errorResult(new Error(`codex usage request timed out after ${this.timeoutMs}ms`));
      }
      return this.errorResult(error as Error);
    }
  }

  private async resolveAuthContext(): Promise<{ accessToken: string; accountId: string | null }> {
    const configuredApiKey = this.getOption<string>('apiKey', '').trim();
    if (configuredApiKey) {
      return {
        accessToken: this.parseAccessTokenFromApiKey(configuredApiKey),
        accountId: null,
      };
    }

    const provider = this.getOption<string>('oauthProvider', 'openai-codex').trim() || 'openai-codex';
    const oauthAccountId = this.getOption<string>('oauthAccountId', '').trim();
    const authManager = OAuthAuthManager.getInstance();

    let oauthApiKey: string;
    try {
      oauthApiKey = oauthAccountId
        ? await authManager.getApiKey(provider as OAuthProvider, oauthAccountId)
        : await authManager.getApiKey(provider as OAuthProvider);
    } catch (error) {
      authManager.reload();
      oauthApiKey = oauthAccountId
        ? await authManager.getApiKey(provider as OAuthProvider, oauthAccountId)
        : await authManager.getApiKey(provider as OAuthProvider);
      logger.info(`[openai-codex-checker] Reloaded OAuth auth file and retrieved token for provider '${provider}'.`);
    }

    const credentials = (oauthAccountId
      ? authManager.getCredentials(provider as OAuthProvider, oauthAccountId)
      : authManager.getCredentials(provider as OAuthProvider)) as Record<string, unknown> | null;
    const accountId = typeof credentials?.accountId === 'string'
      ? credentials.accountId.trim()
      : (typeof credentials?.chatgpt_account_id === 'string' ? credentials.chatgpt_account_id.trim() : '');

    return {
      accessToken: this.parseAccessTokenFromApiKey(oauthApiKey),
      accountId: accountId || null,
    };
  }

  private parseAccessTokenFromApiKey(apiKey: string): string {
    const raw = apiKey.trim();
    if (!raw) {
      throw new Error('OAuth missing access_token');
    }

    if (raw.toLowerCase().startsWith('bearer ')) {
      const bearerToken = raw.slice(7).trim();
      if (!bearerToken) {
        throw new Error('OAuth missing access_token');
      }
      return bearerToken;
    }

    if (!raw.startsWith('{')) {
      return raw;
    }

    let parsed: OAuthCredentialsBlob;
    try {
      parsed = JSON.parse(raw) as OAuthCredentialsBlob;
    } catch {
      throw new Error('failed to parse OAuth credentials JSON');
    }

    const token = parsed.access_token?.trim();
    if (!token) {
      throw new Error('OAuth missing access_token');
    }

    return token;
  }

  private extractChatGPTAccountId(accessToken: string): string | null {
    const parts = accessToken.split('.');
    const payloadSegment = parts[1];
    if (!payloadSegment) {
      return null;
    }

    try {
      const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
      const payloadText = Buffer.from(padded, 'base64').toString('utf8');
      const payload = JSON.parse(payloadText) as {
        'https://api.openai.com/auth'?: {
          chatgpt_account_id?: string;
        };
      };

      return payload['https://api.openai.com/auth']?.chatgpt_account_id?.trim() || null;
    } catch {
      return null;
    }
  }

  private buildWindows(rateLimit?: CodexRateLimitInfo): QuotaWindow[] {
    if (!rateLimit) {
      return [];
    }

    const isExhausted = rateLimit.limit_reached === true || rateLimit.allowed === false;
    const windows: QuotaWindow[] = [];

    const primary = this.buildWindowFromUsage(
      rateLimit.primary_window,
      isExhausted,
      this.resolveWindowType(rateLimit.primary_window?.limit_window_seconds, 'five_hour'),
      'OpenAI Codex primary rate limit usage'
    );
    if (primary) windows.push(primary);

    const secondary = this.buildWindowFromUsage(
      rateLimit.secondary_window,
      isExhausted,
      this.resolveWindowType(rateLimit.secondary_window?.limit_window_seconds, 'weekly'),
      'OpenAI Codex secondary rate limit usage'
    );
    if (secondary) windows.push(secondary);

    if (windows.length === 0) {
      windows.push(this.createWindow('custom', 100, isExhausted ? 100 : 0, isExhausted ? 0 : 100, 'percentage', undefined, 'OpenAI Codex rate limit usage'));
    }

    return windows;
  }

  private buildWindowFromUsage(
    usageWindow: CodexUsageWindow | undefined,
    isExhausted: boolean,
    windowType: QuotaWindowType,
    description: string
  ): QuotaWindow | null {
    if (!usageWindow) {
      return null;
    }

    const usedPercent = usageWindow.used_percent;
    const used = isExhausted
      ? 100
      : (typeof usedPercent === 'number' && Number.isFinite(usedPercent)
        ? Math.min(Math.max(usedPercent, 0), 100)
        : 0);
    const remaining = isExhausted ? 0 : Math.max(0, 100 - used);

    const resetAtUnix = usageWindow.reset_at;
    const resetsAt = typeof resetAtUnix === 'number' && resetAtUnix > 0
      ? new Date(resetAtUnix * 1000)
      : undefined;

    return this.createWindow(windowType, 100, used, remaining, 'percentage', resetsAt, description);
  }

  private resolveWindowType(limitWindowSeconds: number | undefined, fallback: QuotaWindowType): QuotaWindowType {
    if (limitWindowSeconds === 5 * 60 * 60) return 'five_hour';
    if (limitWindowSeconds === 7 * 24 * 60 * 60) return 'weekly';
    return fallback;
  }
}
