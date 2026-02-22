import fs from 'fs';
import { getAuthJsonPath } from '../config';
import { logger } from '../utils/logger';
import { getOAuthApiKey, type OAuthProvider, type OAuthCredentials } from '@mariozechner/pi-ai';

const LEGACY_ACCOUNT_ID = 'legacy';

type ProviderCredentialsRecord = {
  accounts: Record<string, OAuthCredentials>;
};

type AuthRecord = Record<string, ProviderCredentialsRecord>;

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeCredentials = (credentials: unknown): OAuthCredentials | null => {
  if (!isObjectRecord(credentials)) return null;
  return { type: 'oauth', ...credentials } as unknown as OAuthCredentials;
};

const normalizeAuthData = (raw: unknown): { data: AuthRecord; migrated: boolean } => {
  if (!isObjectRecord(raw)) {
    return { data: {}, migrated: false };
  }

  const normalized: AuthRecord = {};
  let migrated = false;

  for (const [provider, providerValue] of Object.entries(raw)) {
    if (!isObjectRecord(providerValue)) {
      migrated = true;
      continue;
    }

    const accounts = providerValue.accounts;
    if (isObjectRecord(accounts)) {
      const normalizedAccounts: Record<string, OAuthCredentials> = {};
      for (const [accountId, accountCredentials] of Object.entries(accounts)) {
        const normalizedCredentials = normalizeCredentials(accountCredentials);
        if (!normalizedCredentials) {
          migrated = true;
          continue;
        }
        normalizedAccounts[accountId] = normalizedCredentials;
      }

      if (Object.keys(normalizedAccounts).length > 0) {
        normalized[provider] = { accounts: normalizedAccounts };
      } else {
        migrated = true;
      }
      continue;
    }

    const legacyCredentials = normalizeCredentials(providerValue);
    if (!legacyCredentials) {
      migrated = true;
      continue;
    }

    migrated = true;
    normalized[provider] = {
      accounts: {
        [LEGACY_ACCOUNT_ID]: legacyCredentials,
      },
    };
  }

  return { data: normalized, migrated };
};

export class OAuthAuthManager {
  private static instance: OAuthAuthManager;
  private authData: AuthRecord = {};
  private authFilePath: string;

  private constructor() {
    this.authFilePath = getAuthJsonPath();
    this.loadAuthFile();
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

  private loadAuthFile(): void {
    try {
      if (fs.existsSync(this.authFilePath)) {
        const content = fs.readFileSync(this.authFilePath, 'utf-8');
        const parsed = JSON.parse(content) as unknown;
        const { data, migrated } = normalizeAuthData(parsed);
        this.authData = data;
        logger.info(`OAuth: Loaded credentials from ${this.authFilePath}`);
        if (migrated) {
          logger.info('OAuth: Migrated auth.json to multi-account schema');
          this.saveAuthFile();
        }
      } else {
        logger.warn(
          `OAuth: No auth.json found at ${this.authFilePath}. OAuth providers will not be available.`
        );
      }
    } catch (error: any) {
      logger.error(`OAuth: Failed to load ${this.authFilePath}:`, error);
      throw new Error(`Failed to load OAuth credentials: ${error?.message || error}`);
    }
  }

  private saveAuthFile(): void {
    try {
      fs.writeFileSync(this.authFilePath, JSON.stringify(this.authData, null, 2), 'utf-8');
      logger.debug(`OAuth: Saved updated credentials to ${this.authFilePath}`);
    } catch (error) {
      logger.error(`OAuth: Failed to save ${this.authFilePath}:`, error);
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

  setCredentials(provider: OAuthProvider, accountId: string, credentials: OAuthCredentials): void {
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

    this.saveAuthFile();
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
      this.saveAuthFile();
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

  deleteCredentials(provider: OAuthProvider, accountId: string): boolean {
    if (!accountId?.trim()) {
      return false;
    }

    const providerRecord = this.authData[provider];
    if (!providerRecord?.accounts?.[accountId]) {
      return false;
    }

    delete providerRecord.accounts[accountId];
    if (Object.keys(providerRecord.accounts).length === 0) {
      delete this.authData[provider];
    }

    this.saveAuthFile();
    return true;
  }

  reload(): void {
    this.loadAuthFile();
  }
}
