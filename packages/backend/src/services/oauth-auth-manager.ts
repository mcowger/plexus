import { logger } from '../utils/logger';
import {
  getOAuthApiKey,
  type OAuthProvider,
  type OAuthCredentials,
} from '@mariozechner/pi-ai/oauth';
import { ConfigService } from './config-service';

const LEGACY_ACCOUNT_ID = 'legacy';

export class OAuthAuthManager {
  private static instance: OAuthAuthManager;
  // In-memory cache for fast lookups
  private authData: Record<string, { accounts: Record<string, OAuthCredentials> }> = {};
  private initPromise: Promise<void>;

  private constructor() {
    this.initPromise = this.loadFromDatabaseAsync();
  }

  static getInstance(): OAuthAuthManager {
    if (!this.instance) {
      this.instance = new OAuthAuthManager();
    }
    return this.instance;
  }

  static resetForTesting(): void {
    this.instance = undefined as unknown as OAuthAuthManager;
  }

  async initialize(): Promise<void> {
    await this.initPromise;
  }

  private async loadFromDatabaseAsync(): Promise<void> {
    try {
      const configService = ConfigService.getInstance();
      const providers = await configService.getAllOAuthProviders();
      const newAuthData: Record<string, { accounts: Record<string, OAuthCredentials> }> = {};

      for (const { providerType, accountId } of providers) {
        const creds = await configService.getOAuthCredentials(providerType, accountId);
        if (creds) {
          if (!newAuthData[providerType]) {
            newAuthData[providerType] = { accounts: {} };
          }
          newAuthData[providerType].accounts[accountId] = {
            type: 'oauth',
            access: creds.accessToken,
            refresh: creds.refreshToken,
            expires: creds.expiresAt,
          } as OAuthCredentials;
        }
      }

      this.authData = newAuthData;

      const totalAccounts = Object.values(newAuthData).reduce(
        (sum, p) => sum + Object.keys(p.accounts).length,
        0
      );
      if (totalAccounts > 0) {
        logger.info(`OAuth: Loaded ${totalAccounts} credential(s) from database`);
      }
    } catch (error: any) {
      // If the oauth_credentials table doesn't exist yet (e.g. pre-migration or test environment),
      // treat as empty — don't crash startup.
      if (error?.message?.includes('no such table')) {
        logger.debug('OAuth: oauth_credentials table not yet available, starting with empty state');
        return;
      }
      logger.error('OAuth: Failed to load from database:', error);
      throw error;
    }
  }

  private async saveToDatabase(
    provider: OAuthProvider,
    accountId: string,
    credentials: OAuthCredentials
  ): Promise<void> {
    try {
      const configService = ConfigService.getInstance();
      await configService.setOAuthCredentials(provider, accountId, {
        accessToken: credentials.access,
        refreshToken: credentials.refresh,
        expiresAt: credentials.expires,
      });
    } catch (error: any) {
      logger.error('OAuth: Failed to save credentials to database:', error);
    }
  }

  private resolveAccountId(provider: OAuthProvider, accountId?: string | null): string | null {
    const trimmed = accountId?.trim();
    if (trimmed) {
      return trimmed;
    }

    const providerRecord = this.authData[provider];
    if (!providerRecord) {
      return null;
    }

    if (providerRecord.accounts[LEGACY_ACCOUNT_ID]) {
      return LEGACY_ACCOUNT_ID;
    }

    const accountIds = Object.keys(providerRecord.accounts);
    if (accountIds.length === 1) {
      return accountIds[0] ?? null;
    }

    return null;
  }

  async setCredentials(
    provider: OAuthProvider,
    accountId: string,
    credentials: OAuthCredentials
  ): Promise<void> {
    if (!accountId?.trim()) {
      throw new Error('OAuth: accountId is required to store credentials');
    }

    if (!this.authData[provider]) {
      this.authData[provider] = { accounts: {} };
    }

    this.authData[provider].accounts[accountId] = {
      type: 'oauth',
      ...credentials,
    } as OAuthCredentials;

    await this.saveToDatabase(provider, accountId, credentials);
  }

  async getApiKey(provider: OAuthProvider, accountId?: string | null): Promise<string> {
    const providerRecord = this.authData[provider];
    if (!providerRecord) {
      throw new Error(
        `OAuth: Not authenticated for provider '${provider}'. Please run OAuth login for this provider.`
      );
    }

    const resolvedAccountId = this.resolveAccountId(provider, accountId);
    if (!resolvedAccountId) {
      throw new Error(
        `OAuth: accountId is required to resolve credentials for provider '${provider}'.`
      );
    }

    const credentials = providerRecord.accounts?.[resolvedAccountId];
    if (!credentials) {
      throw new Error(
        `OAuth: Not authenticated for provider '${provider}' and account '${resolvedAccountId}'. ` +
          `Please run OAuth login for this account.`
      );
    }

    const result = await getOAuthApiKey(provider, {
      [provider]: credentials,
    });

    if (!result) {
      throw new Error(
        `OAuth: Not authenticated for provider '${provider}' and account '${resolvedAccountId}'. ` +
          `Please run OAuth login for this account.`
      );
    }

    if (result.newCredentials) {
      providerRecord.accounts[resolvedAccountId] = {
        type: 'oauth',
        ...result.newCredentials,
      } as OAuthCredentials;
      // Save refreshed credentials to database
      await this.saveToDatabase(provider, resolvedAccountId, result.newCredentials);
    }

    return result.apiKey;
  }

  getCredentials(provider: OAuthProvider, accountId?: string | null): OAuthCredentials | null {
    const resolvedAccountId = this.resolveAccountId(provider, accountId);
    if (!resolvedAccountId) {
      return null;
    }
    return this.authData[provider]?.accounts?.[resolvedAccountId] ?? null;
  }

  hasProvider(provider: OAuthProvider, accountId?: string | null): boolean {
    if (accountId?.trim()) {
      return !!this.authData[provider]?.accounts?.[accountId.trim()];
    }

    const providerRecord = this.authData[provider];
    return !!providerRecord && Object.keys(providerRecord.accounts).length > 0;
  }

  async deleteCredentials(provider: OAuthProvider, accountId: string): Promise<boolean> {
    if (!accountId?.trim()) {
      return false;
    }

    const providerRecord = this.authData[provider];
    if (!providerRecord?.accounts?.[accountId]) {
      return false;
    }

    try {
      await ConfigService.getInstance().deleteOAuthCredentials(provider, accountId);
    } catch (error: any) {
      if (!error?.message?.includes('no such table')) {
        throw error;
      }
    }

    delete providerRecord.accounts[accountId];
    if (Object.keys(providerRecord.accounts).length === 0) {
      delete this.authData[provider];
    }

    return true;
  }

  async reload(): Promise<void> {
    await this.loadFromDatabaseAsync();
  }
}
