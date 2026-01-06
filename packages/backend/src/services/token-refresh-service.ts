import { UsageStorageService } from './usage-storage.js';
import { OAuthService } from './oauth-service.js';
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
  private readonly REFRESH_THRESHOLD = 10; // Refresh tokens expiring within 10 minutes

  constructor(
    private usageStorage: UsageStorageService,
    private oauthService: OAuthService
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

      // Get all credentials expiring within the threshold
      const expiringCredentials = this.usageStorage.listExpiringSoonCredentials(
        this.REFRESH_THRESHOLD
      );

      if (expiringCredentials.length === 0) {
        logger.debug('No tokens need refreshing');
        return;
      }

      logger.info(`Found ${expiringCredentials.length} token(s) that need refreshing`);

      // Refresh each token
      for (const credential of expiringCredentials) {
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

      // Only Antigravity is currently supported
      if (provider !== 'antigravity') {
        logger.warn(`Unsupported provider for token refresh: ${provider}`);
        return;
      }

      // Call the OAuth service to refresh the token
      const tokenResponse = await this.oauthService.refreshToken(
        provider,
        refresh_token
      );

      // Calculate new expiry time
      const expiresAt = Date.now() + tokenResponse.expires_in * 1000;

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
  getStatus(): { running: boolean; checkInterval: number; refreshThreshold: number } {
    return {
      running: this.isRunning,
      checkInterval: this.CHECK_INTERVAL,
      refreshThreshold: this.REFRESH_THRESHOLD,
    };
  }
}
