import type { QuotaCheckResult, QuotaWindow, QuotaCheckerConfig } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { logger } from '../../../utils/logger';
import { OAuthAuthManager } from '../../oauth-auth-manager';
import type { OAuthProvider } from '@mariozechner/pi-ai';

export class ClaudeCodeQuotaChecker extends QuotaChecker {
  private endpoint: string;
  private model: string;

  constructor(config: QuotaCheckerConfig) {
    super(config);
    this.endpoint = this.getOption<string>('endpoint', 'https://api.anthropic.com/v1/messages');
    this.model = this.getOption<string>('model', 'claude-haiku-4-5-20251001');
  }

  async checkQuota(): Promise<QuotaCheckResult> {
    try {
      const apiKey = await this.resolveApiKey();
      logger.silly(`[claude-code-checker] Making inference request to ${this.endpoint}?beta=true`);

      const response = await fetch(`${this.endpoint}?beta=true`, {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'anthropic-beta': 'oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,structured-outputs-2025-12-15',
          'anthropic-dangerous-direct-browser-access': 'true',
          'anthropic-version': '2023-06-01',
          'authorization': `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'user-agent': 'claude-cli/2.1.25 (external, cli)',
          'x-app': 'cli',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'Are you online' }] }],
          system: [
            { type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.25.3de; cc_entrypoint=cli;' },
            { type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." },
          ],
          tools: [],
          metadata: { user_id: 'user_24df69fab27b77f1171d5c7e798a1c2aeeb2c810eefa1bbd17f16b5e7e07ab72_account_b37bb5b5-6c73-4586-94c4-44313833d598_session_133180ba-5432-4ab3-ae69-635409fe17f1' },
          max_tokens: 5,
          stream: false,
        }),
      });

      logger.silly(`[claude-code-checker] Response status: ${response.status}`);

      if (!response.ok) {
        return this.errorResult(new Error(`HTTP ${response.status}: ${response.statusText}`));
      }

      await response.body?.cancel();

      const fiveHourReset = response.headers.get('anthropic-ratelimit-unified-5h-reset');
      const fiveHourUtil = response.headers.get('anthropic-ratelimit-unified-5h-utilization');
      const fiveHourLimit = response.headers.get('anthropic-ratelimit-unified-5h-limit');

      const sevenDayReset = response.headers.get('anthropic-ratelimit-unified-7d-reset');
      const sevenDayUtil = response.headers.get('anthropic-ratelimit-unified-7d-utilization');
      const sevenDayLimit = response.headers.get('anthropic-ratelimit-unified-7d-limit');

      logger.silly(`[claude-code-checker] 5h - limit: ${fiveHourLimit}, reset: ${fiveHourReset}, util: ${fiveHourUtil}`);
      logger.silly(`[claude-code-checker] 7d - limit: ${sevenDayLimit}, reset: ${sevenDayReset}, util: ${sevenDayUtil}`);

      const windows: QuotaWindow[] = [];

      if (fiveHourReset && fiveHourUtil) {
        const limit = fiveHourLimit ? parseInt(fiveHourLimit) : 100;
        windows.push(this.createWindow(
          'five_hour',
          limit,
          parseFloat(fiveHourUtil) * 100,
          undefined,
          'percentage',
          new Date(parseInt(fiveHourReset) * 1000),
          '5-hour request quota'
        ));
      }

      if (sevenDayReset && sevenDayUtil) {
        const limit = sevenDayLimit ? parseInt(sevenDayLimit) : 100;
        windows.push(this.createWindow(
          'weekly',
          limit,
          parseFloat(sevenDayUtil) * 100,
          undefined,
          'percentage',
          new Date(parseInt(sevenDayReset) * 1000),
          'Weekly request quota'
        ));
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

    try {
      return oauthAccountId
        ? await authManager.getApiKey(provider as OAuthProvider, oauthAccountId)
        : await authManager.getApiKey(provider as OAuthProvider);
    } catch {
      authManager.reload();
      logger.info(`[claude-code-checker] Reloaded OAuth auth file and retrying token retrieval for provider '${provider}'.`);
      return oauthAccountId
        ? await authManager.getApiKey(provider as OAuthProvider, oauthAccountId)
        : await authManager.getApiKey(provider as OAuthProvider);
    }
  }
}
