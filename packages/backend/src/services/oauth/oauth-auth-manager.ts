import { logger } from '../../utils/logger';
import type { OAuthAuth, OAuthCredential, OAuthCredentials } from '@earendil-works/pi-ai';
import { ConfigService } from '../configuration/config-service';
import { getOAuthProviderAuth, type OAuthProvider } from './oauth-providers';

const LEGACY_ACCOUNT_ID = 'legacy';
const REFRESH_RETRY_BACKOFF_INITIAL_MS = 60 * 1000;
const REFRESH_RETRY_BACKOFF_MAX_MS = 15 * 60 * 1000;

// Anthropic rate-limits its shared OAuth token endpoint independently of the
// account being refreshed. Keep pooled-seat rotations out of the same burst.
const PROVIDER_REFRESH_MIN_INTERVAL_MS: Readonly<Record<string, number>> = {
  anthropic: 30 * 1000,
};

function waitForDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new DOMException('Request aborted', 'AbortError'));
  }

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal.reason ?? new DOMException('Request aborted', 'AbortError'));
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

interface GetApiKeyOptions {
  refreshIfOlderThanMs?: number;
  signal?: AbortSignal;
}

export class OAuthAuthManager {
  private static instance: OAuthAuthManager;
  // In-memory cache for fast lookups
  private authData: Record<string, { accounts: Record<string, OAuthCredentials> }> = {};
  private initPromise: Promise<void>;
  private readonly lastRefreshAt = new Map<string, number>();
  private readonly refreshPromises = new Map<string, Promise<OAuthCredentials>>();
  private readonly providerRefreshTails = new Map<string, Promise<void>>();
  private readonly lastProviderRefreshAttemptAt = new Map<string, number>();
  private readonly refreshBackoffs = new Map<
    string,
    { consecutiveFailures: number; retryAt: number }
  >();

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
      const loadedAt = Date.now();

      for (const { providerType, accountId } of providers) {
        const creds = await configService.getOAuthCredentials(providerType, accountId);
        if (creds) {
          if (!newAuthData[providerType]) {
            newAuthData[providerType] = { accounts: {} };
          }
          logger.debug(
            `OAuth: Loading ${providerType}/${accountId} from DB — ` +
              `access=${creds.accessToken ? `present(${creds.accessToken.length} chars)` : 'MISSING'}, ` +
              `refresh=${creds.refreshToken ? `present(${creds.refreshToken.length} chars)` : 'MISSING'}, ` +
              `expires=${creds.expiresAt} (${creds.expiresAt > Date.now() ? 'valid' : 'EXPIRED'})`
          );
          newAuthData[providerType].accounts[accountId] = {
            type: 'oauth',
            access: creds.accessToken,
            refresh: creds.refreshToken,
            expires: creds.expiresAt,
          } as OAuthCredentials;
          // Loading a valid persisted credential must not count as "never
          // refreshed". Otherwise process startup rotates every pooled account
          // as soon as synchronized quota checkers run.
          this.lastRefreshAt.set(`${providerType}/${accountId}`, loadedAt);
        } else {
          logger.warn(`OAuth: No credentials found in DB for ${providerType}/${accountId}`);
        }
      }

      this.authData = newAuthData;

      const totalAccounts = Object.values(newAuthData).reduce(
        (sum, p) => sum + Object.keys(p.accounts).length,
        0
      );
      if (totalAccounts > 0) {
        logger.debug(`OAuth: Loaded ${totalAccounts} credential(s) from database`);
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
      logger.debug(
        `OAuth: Saving ${provider}/${accountId} to DB — ` +
          `access=${credentials.access ? `present(${credentials.access.length} chars)` : 'MISSING'}, ` +
          `refresh=${credentials.refresh ? `present(${credentials.refresh.length} chars)` : 'MISSING'}, ` +
          `expires=${credentials.expires}`
      );
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
    const refreshKey = `${provider}/${accountId}`;
    this.lastRefreshAt.set(refreshKey, Date.now());
    this.refreshBackoffs.delete(refreshKey);

    await this.saveToDatabase(provider, accountId, credentials);
  }

  async getApiKey(
    provider: OAuthProvider,
    accountId?: string | null,
    options: GetApiKeyOptions = {}
  ): Promise<string> {
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

    const descriptor = getOAuthProviderAuth(provider);
    if (!descriptor) {
      throw new Error(`OAuth: provider '${provider}' does not support OAuth login.`);
    }

    const refreshKey = `${provider}/${resolvedAccountId}`;
    const now = Date.now();
    let current = credentials;
    const lastRefresh = this.lastRefreshAt.get(refreshKey);
    const refreshRequested =
      current.expires <= now ||
      (options.refreshIfOlderThanMs !== undefined &&
        (lastRefresh === undefined || now - lastRefresh >= options.refreshIfOlderThanMs));

    if (refreshRequested) {
      const signal = options.signal ?? new AbortController().signal;
      const backoff = this.refreshBackoffs.get(refreshKey);
      if (backoff && backoff.retryAt > now) {
        if (current.expires <= now) {
          throw new Error(
            `OAuth: refresh for ${provider}/${resolvedAccountId} is backed off until ` +
              `${new Date(backoff.retryAt).toISOString()} after a previous failure.`
          );
        }
        logger.warn(
          `OAuth: Skipping proactive refresh for ${provider}/${resolvedAccountId} during ` +
            `refresh backoff; continuing with the still-valid access token.`
        );
      } else {
        try {
          const existingRefresh = this.refreshPromises.get(refreshKey);
          if (existingRefresh) {
            current = await existingRefresh;
          } else {
            const refreshPromise = this.refreshCredentials(
              provider,
              resolvedAccountId,
              descriptor.oauth.refresh,
              current,
              refreshKey,
              signal
            );
            this.refreshPromises.set(refreshKey, refreshPromise);
            try {
              current = await refreshPromise;
            } finally {
              if (this.refreshPromises.get(refreshKey) === refreshPromise) {
                this.refreshPromises.delete(refreshKey);
              }
            }
          }
        } catch (error) {
          // Cancellation belongs to the caller and must not be converted into a
          // successful auth lookup using the old token.
          if (signal.aborted) throw error;

          // Proactive rotation is best-effort. If the access token is still
          // valid, keep serving instead of turning a transient token-endpoint
          // failure into an immediate provider outage.
          if (current.expires <= Date.now()) throw error;
          logger.warn(
            `OAuth: Proactive refresh failed for ${provider}/${resolvedAccountId}; ` +
              `continuing with the still-valid access token.`
          );
        }
      }
    } else {
      logger.debug(
        `OAuth: getApiKey for ${provider}/${resolvedAccountId} — token was NOT refreshed (not expired).`
      );
    }

    const auth = await descriptor.oauth.toAuth({ ...current, type: 'oauth' } as OAuthCredential);
    if (!auth.apiKey) {
      throw new Error(
        `OAuth: could not derive an API key for provider '${provider}' and account '${resolvedAccountId}'.`
      );
    }

    return auth.apiKey;
  }

  private async refreshCredentials(
    provider: OAuthProvider,
    accountId: string,
    refresh: OAuthAuth['refresh'],
    credentials: OAuthCredentials,
    refreshKey: string,
    signal: AbortSignal
  ): Promise<OAuthCredentials> {
    try {
      const refreshed = await this.runProviderRefresh(
        provider,
        () => refresh({ ...credentials, type: 'oauth' } as OAuthCredential, signal),
        signal
      );
      if (!refreshed.access || !Number.isFinite(refreshed.expires)) {
        throw new Error(
          `OAuth: refresh returned incomplete credentials for ${provider}/${accountId}`
        );
      }
      const current = {
        ...refreshed,
        refresh: refreshed.refresh || credentials.refresh,
      } as OAuthCredentials;
      logger.debug(
        `OAuth: getApiKey for ${provider}/${accountId} — token WAS refreshed. ` +
          `new_refresh=${current.refresh ? `present(${current.refresh.length} chars)` : 'MISSING'}`
      );
      this.authData[provider]!.accounts[accountId] = current;
      this.lastRefreshAt.set(refreshKey, Date.now());
      this.refreshBackoffs.delete(refreshKey);
      await this.saveToDatabase(provider, accountId, current);
      return current;
    } catch (error) {
      if (signal.aborted) throw error;

      const previousFailures = this.refreshBackoffs.get(refreshKey)?.consecutiveFailures ?? 0;
      const consecutiveFailures = previousFailures + 1;
      const delayMs = Math.min(
        REFRESH_RETRY_BACKOFF_INITIAL_MS * 2 ** (consecutiveFailures - 1),
        REFRESH_RETRY_BACKOFF_MAX_MS
      );
      this.refreshBackoffs.set(refreshKey, {
        consecutiveFailures,
        retryAt: Date.now() + delayMs,
      });
      logger.warn(
        `OAuth: Refresh failed for ${provider}/${accountId}; backing off for ` +
          `${Math.round(delayMs / 1000)}s before another token-endpoint attempt.`
      );
      throw error;
    }
  }

  private async runProviderRefresh<T>(
    provider: OAuthProvider,
    operation: () => Promise<T>,
    signal: AbortSignal
  ): Promise<T> {
    const previous = this.providerRefreshTails.get(provider) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.providerRefreshTails.set(provider, tail);

    await previous;
    try {
      const minIntervalMs = PROVIDER_REFRESH_MIN_INTERVAL_MS[provider] ?? 0;
      const lastAttemptAt = this.lastProviderRefreshAttemptAt.get(provider) ?? 0;
      const delayMs = Math.max(0, minIntervalMs - (Date.now() - lastAttemptAt));
      if (delayMs > 0) {
        logger.info(
          `OAuth: Spacing pooled ${provider} credential refresh by ` +
            `${Math.round(delayMs / 1000)}s.`
        );
        await waitForDelay(delayMs, signal);
      }
      this.lastProviderRefreshAttemptAt.set(provider, Date.now());
      return await operation();
    } finally {
      release?.();
      if (this.providerRefreshTails.get(provider) === tail) {
        this.providerRefreshTails.delete(provider);
      }
    }
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
    const refreshKey = `${provider}/${accountId}`;
    this.lastRefreshAt.delete(refreshKey);
    this.refreshPromises.delete(refreshKey);
    this.refreshBackoffs.delete(refreshKey);
    if (Object.keys(providerRecord.accounts).length === 0) {
      delete this.authData[provider];
    }

    return true;
  }

  async reload(): Promise<void> {
    await this.loadFromDatabaseAsync();
  }
}
