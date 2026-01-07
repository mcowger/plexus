import { UsageStorageService } from './usage-storage.js';
import { OAuthService } from './oauth-service.js';
import { ClaudeOAuthService } from './oauth-service-claude.js';
import { logger } from '../utils/logger.js';

/**
 * TokenRefreshService
 *
 * Background service that periodically checks for expiring OAuth tokens
 * and refreshes them automatically to prevent authentication failures.
 */
export class TokenRefreshService {
  private intervalId?: Timer;
  private isRunning = false;
  private readonly CHECK_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes
  private readonly REFRESH_THRESHOLD_ANTIGRAVITY = 5; // Refresh Antigravity tokens expiring within 5 minutes
  private readonly REFRESH_THRESHOLD_CLAUDE = 240; // Refresh Claude Code tokens 4 hours before expiry

  constructor(
    private usageStorage: UsageStorageService,
    private oauthService: OAuthService,
    private claudeOAuthService?: ClaudeOAuthService
  ) {}

  /**
   * Start the token refresh service
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('TokenRefreshService is already running');
      return;
    }

    logger.info('Starting TokenRefreshService');
    this.isRunning = true;

    // Run immediately on start
    this.checkAndRefreshTokens();

    // Then schedule periodic checks
    this.intervalId = setInterval(() => {
      this.checkAndRefreshTokens();
    }, this.CHECK_INTERVAL);
  }

  /**
   * Stop the token refresh service
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping TokenRefreshService');
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.isRunning = false;
  }

  /**
   * Check for expiring tokens and refresh them
   */
  private async checkAndRefreshTokens(): Promise<void> {
    try {
      logger.debug('Checking for expiring OAuth tokens');

      // Get Antigravity credentials expiring within 5 minutes
      const expiringAntigravity = this.usageStorage.listExpiringSoonCredentials(
        this.REFRESH_THRESHOLD_ANTIGRAVITY
      ).filter(c => c.provider === 'antigravity');

      // Get Claude Code credentials expiring within 4 hours
      const expiringClaude = this.usageStorage.listExpiringSoonCredentials(
        this.REFRESH_THRESHOLD_CLAUDE
      ).filter(c => c.provider === 'claude-code');

      const totalExpiring = expiringAntigravity.length + expiringClaude.length;

      if (totalExpiring === 0) {
        logger.debug('No tokens need refreshing');
        return;
      }

      logger.info(`Found ${totalExpiring} token(s) that need refreshing (${expiringAntigravity.length} Antigravity, ${expiringClaude.length} Claude Code)`);

      // Refresh each token
      for (const credential of [...expiringAntigravity, ...expiringClaude]) {
        await this.refreshToken(credential);
      }
    } catch (error) {
      logger.error('Error in token refresh check:', error);
    }
  }

  /**
   * Refresh a specific OAuth credential
   */
  private async refreshToken(credential: any): Promise<void> {
    const { provider, user_identifier, refresh_token } = credential;

    try {
      logger.info(`Refreshing token for ${provider}:${user_identifier}`);

      let tokenResponse: any;
      let expiresAt: number;

      if (provider === 'antigravity') {
        // Call the Antigravity OAuth service to refresh the token
        tokenResponse = await this.oauthService.refreshToken(
          provider,
          refresh_token
        );
        expiresAt = Date.now() + tokenResponse.expires_in * 1000;
      } else if (provider === 'claude-code') {
        if (!this.claudeOAuthService) {
          logger.error('Claude OAuth service not available');
          return;
        }

        // Call the Claude OAuth service to refresh the token
        tokenResponse = await this.claudeOAuthService.refreshAccessToken(
          refresh_token
        );
        expiresAt = Date.now() + tokenResponse.expires_in * 1000;
      } else {
        logger.warn(`Unsupported provider for token refresh: ${provider}`);
        return;
      }

      // Update the token in the database
      this.usageStorage.updateOAuthToken(
        provider,
        user_identifier,
        tokenResponse.access_token,
        expiresAt
      );

      logger.info(
        `Successfully refreshed token for ${provider}:${user_identifier}. New expiry: ${new Date(expiresAt).toISOString()}`
      );
    } catch (error) {
      logger.error(
        `Failed to refresh token for ${provider}:${user_identifier}:`,
        error
      );

      // If refresh fails, the token may be invalid
      // The user will need to re-authenticate manually
      logger.error(
        `Token refresh failed for ${provider}:${user_identifier}. User may need to re-authenticate.`
      );
    }
  }

  /**
   * Manually trigger a refresh check (for testing or on-demand refresh)
   */
  async triggerRefresh(): Promise<void> {
    await this.checkAndRefreshTokens();
  }

  /**
   * Get service status
   */
  getStatus(): { running: boolean; checkInterval: number; refreshThresholdAntigravity: number; refreshThresholdClaude: number } {
    return {
      running: this.isRunning,
      checkInterval: this.CHECK_INTERVAL,
      refreshThresholdAntigravity: this.REFRESH_THRESHOLD_ANTIGRAVITY,
      refreshThresholdClaude: this.REFRESH_THRESHOLD_CLAUDE,
    };
  }
}
