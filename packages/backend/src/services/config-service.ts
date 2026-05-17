import { ConfigRepository, OAuthCredentialsData } from '../db/config-repository';
import { logger } from '../utils/logger';
import type {
  PlexusConfig,
  ProviderConfig,
  ModelConfig,
  KeyConfig,
  QuotaDefinition,
  McpServerConfig,
  FailoverPolicy,
  CooldownPolicy,
  QuotaConfig,
  TimeoutConfig,
  StallConfigType,
} from '../config';

import { QuotaScheduler } from './quota/quota-scheduler';

/**
 * ConfigService — In-memory cache + DB sync.
 *
 * Replaces the old YAML-file-based `getConfig()` as the single source of truth.
 * Holds an in-memory `PlexusConfig` object that is:
 * 1. Loaded from DB on startup
 * 2. Updated in-memory whenever a write operation occurs
 * 3. Never stale (writes go to DB first, then update cache)
 */
export class ConfigService {
  private static instance: ConfigService;

  private cache: PlexusConfig | null = null;
  private repo: ConfigRepository;

  /** Number of writes issued since the last rebuild; used for coalescing. */
  private pendingWrites = 0;
  /** Active timer for a deferred rebuild. */
  private coalesceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Promise for an in-flight rebuild so parallel callers can wait on it. */
  private rebuildPromise: Promise<void> | null = null;
  /** Delay (ms) before a coalesced rebuild fires. */
  private readonly COALESCE_MS = 100;

  constructor(repo?: ConfigRepository) {
    this.repo = repo ?? new ConfigRepository();
  }

  static getInstance(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService();
    }
    return ConfigService.instance;
  }

  static resetInstance(): void {
    ConfigService.instance = undefined as any;
  }

  /**
   * For testing only: inject a config directly into the ConfigService cache,
   * bypassing DB initialization. This ensures getConfig() reliably returns
   * the test config regardless of module caching behavior.
   */
  static setInstanceForTesting(config: import('../config').PlexusConfig): void {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService();
    }
    ConfigService.instance.cache = config;
  }

  // ─── Initialization ──────────────────────────────────────────────

  /**
   * Load full config from DB into cache.
   * Must be called once during startup, after DB is initialized.
   */
  async initialize(): Promise<void> {
    await this.executeRebuild();
    logger.debug('ConfigService initialized from database');
  }

  /**
   * One-time startup migration that rewrites legacy flat-format aliases into
   * the grouped target format. After this runs, every alias row has
   * targetGroups populated and every target row has groupName set.
   *
   * TODO(#target-groups-cleanup): remove this method after migration period.
   */
  async migrateLegacyTargetGroups(): Promise<string[]> {
    const migrated = await this.repo.migrateLegacyTargetGroups();
    if (migrated.length > 0) {
      logger.info(
        `Migrated ${migrated.length} legacy aliases to target groups: ${migrated.join(', ')}`
      );
      await this.executeRebuild();
    }
    return migrated;
  }

  /**
   * Returns the cached PlexusConfig (same shape as the old getConfig()).
   * Throws if initialize() hasn't been called yet.
   */
  getConfig(): PlexusConfig {
    if (!this.cache) {
      throw new Error('ConfigService not initialized. Call initialize() first.');
    }
    return this.cache;
  }

  /**
   * Check whether the database has any providers (first-launch indicator).
   */
  getRepository(): ConfigRepository {
    return this.repo;
  }

  // ─── Provider CRUD ───────────────────────────────────────────────

  async saveProvider(slug: string, config: ProviderConfig): Promise<void> {
    await this.repo.saveProvider(slug, config);
    this.pendingWrites++;
    this.rebuildCache();
  }

  async deleteProvider(slug: string, cascade: boolean = true): Promise<void> {
    await this.repo.deleteProvider(slug, cascade);
    this.pendingWrites++;
    this.rebuildCache();
  }

  // ─── Alias CRUD ──────────────────────────────────────────────────

  async saveAlias(slug: string, config: ModelConfig): Promise<void> {
    await this.repo.saveAlias(slug, config);
    this.pendingWrites++;
    this.rebuildCache();
  }

  async deleteAlias(slug: string): Promise<void> {
    await this.repo.deleteAlias(slug);
    this.pendingWrites++;
    this.rebuildCache();
  }

  async deleteAllAliases(): Promise<number> {
    const count = await this.repo.deleteAllAliases();
    this.pendingWrites++;
    this.rebuildCache();
    return count;
  }

  // ─── Key CRUD ────────────────────────────────────────────────────

  async saveKey(name: string, config: KeyConfig): Promise<void> {
    await this.repo.saveKey(name, config);
    this.pendingWrites++;
    this.rebuildCache();
  }

  async deleteKey(name: string): Promise<void> {
    await this.repo.deleteKey(name);
    this.pendingWrites++;
    this.rebuildCache();
  }

  // ─── User Quota CRUD ─────────────────────────────────────────────

  async saveUserQuota(name: string, quota: QuotaDefinition): Promise<void> {
    await this.repo.saveUserQuota(name, quota);
    this.pendingWrites++;
    this.rebuildCache();
  }

  async deleteUserQuota(name: string): Promise<void> {
    await this.repo.deleteUserQuota(name);
    this.pendingWrites++;
    this.rebuildCache();
  }

  // ─── MCP Server CRUD ─────────────────────────────────────────────

  async saveMcpServer(name: string, config: McpServerConfig): Promise<void> {
    await this.repo.saveMcpServer(name, config);
    this.pendingWrites++;
    this.rebuildCache();
  }

  async deleteMcpServer(name: string): Promise<void> {
    await this.repo.deleteMcpServer(name);
    this.pendingWrites++;
    this.rebuildCache();
  }

  // ─── Settings ─────────────────────────────────────────────────────

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.repo.setSetting(key, value);
    this.pendingWrites++;
    this.rebuildCache();
  }

  async setSettingsBulk(entries: Record<string, unknown>): Promise<void> {
    await this.repo.setSettingsBulk(entries);
    this.pendingWrites++;
    this.rebuildCache();
  }

  async getSetting<T>(key: string, defaultValue: T): Promise<T> {
    return this.repo.getSetting(key, defaultValue);
  }

  async getAllSettings(): Promise<Record<string, unknown>> {
    return this.repo.getAllSettings();
  }

  // ─── OAuth Credentials ──────────────────────────────────────────

  async getOAuthCredentials(
    providerType: string,
    accountId?: string
  ): Promise<OAuthCredentialsData | null> {
    return this.repo.getOAuthCredentials(providerType, accountId);
  }

  async setOAuthCredentials(
    providerType: string,
    accountId: string,
    creds: OAuthCredentialsData
  ): Promise<void> {
    await this.repo.setOAuthCredentials(providerType, accountId, creds);
  }

  async deleteOAuthCredentials(providerType: string, accountId: string): Promise<void> {
    await this.repo.deleteOAuthCredentials(providerType, accountId);
  }

  async getAllOAuthProviders(): Promise<Array<{ providerType: string; accountId: string }>> {
    return this.repo.getAllOAuthProviders();
  }

  async clearAllData(): Promise<void> {
    await this.repo.clearAllData();
    this.cache = null;
  }

  // ─── Import from JSON ────────────────────────────────────────────

  /**
   * Import OAuth credentials from auth.json content into the database.
   */
  async importFromAuthJson(jsonContent: string): Promise<void> {
    const parsed = JSON.parse(jsonContent);

    // auth.json format: { "<provider>": { "accounts": { "<accountId>": { access, refresh, expires } } } }
    for (const [providerType, providerData] of Object.entries(parsed)) {
      const data = providerData as any;
      if (data?.accounts && typeof data.accounts === 'object') {
        for (const [accountId, creds] of Object.entries(data.accounts)) {
          const credData = creds as any;
          await this.repo.setOAuthCredentials(providerType, accountId, {
            accessToken: credData.access || '',
            refreshToken: credData.refresh || '',
            expiresAt: credData.expires || 0,
          });
        }
      }
    }

    logger.debug(`Imported OAuth credentials from auth.json`);
  }

  /**
   * Export all DB contents as a structured JSON object.
   */
  async exportConfig(): Promise<Record<string, unknown>> {
    const providers = await this.repo.getAllProviders();
    const models = await this.repo.getAllAliases();
    const keys = await this.repo.getAllKeys();
    const userQuotas = await this.repo.getAllUserQuotas();
    const mcpServers = await this.repo.getAllMcpServers();
    const settings = await this.repo.getAllSettings();
    const oauthProviders = await this.repo.getAllOAuthProviders();

    return {
      providers,
      models,
      keys,
      user_quotas: userQuotas,
      mcp_servers: mcpServers,
      settings,
      oauth_providers: oauthProviders,
    };
  }

  // ─── Write Coalescing & Cache Flush ─────────────────────────────

  /**
   * Force an immediate, synchronous cache rebuild.
   * Cancels any pending coalesced rebuild and waits for an in-flight one.
   * Useful in tests or operations that need immediate consistency.
   */
  async flush(): Promise<void> {
    if (this.coalesceTimer) {
      clearTimeout(this.coalesceTimer);
      this.coalesceTimer = null;
    }
    if (this.rebuildPromise) {
      await this.rebuildPromise;
    }
    this.pendingWrites = 0;
    await this.executeRebuild();
  }

  // ─── Internal ────────────────────────────────────────────────────

  /**
   * Schedule a cache rebuild, coalescing rapid successive calls.
   * If pending writes are present the rebuild is deferred; only the
   * final call in a burst actually hits the database.
   */
  private rebuildCache(): void {
    if (this.coalesceTimer) {
      clearTimeout(this.coalesceTimer);
      this.coalesceTimer = null;
    }

    if (this.pendingWrites > 0) {
      this.coalesceTimer = setTimeout(() => {
        this.pendingWrites = 0;
        this.rebuildCache();
      }, this.COALESCE_MS);
      return;
    }

    if (this.rebuildPromise) {
      this.coalesceTimer = setTimeout(() => this.rebuildCache(), this.COALESCE_MS);
      return;
    }

    const promise = this.executeRebuild();
    this.rebuildPromise = promise;
    promise.finally(() => {
      if (this.rebuildPromise === promise) {
        this.rebuildPromise = null;
      }
    });
  }

  /**
   * Execute the actual cache rebuild. Guarantees that only one rebuild
   * runs concurrently; duplicate callers receive the in-flight promise.
   */
  private async executeRebuild(): Promise<void> {
    if (this.rebuildPromise) {
      return this.rebuildPromise;
    }
    const promise = this.doRebuild();
    this.rebuildPromise = promise;
    try {
      await promise;
    } finally {
      if (this.rebuildPromise === promise) {
        this.rebuildPromise = null;
      }
    }
  }

  /**
   * Core rebuild logic — loads the full config graph from the database.
   */
  private async doRebuild(): Promise<void> {
    const providers = await this.repo.getAllProviders();
    const models = await this.repo.getAllAliases();
    const keys = await this.repo.getAllKeys();
    const userQuotas = await this.repo.getAllUserQuotas();
    const mcpServers = await this.repo.getAllMcpServers();
    const failover = await this.repo.getFailoverPolicy();
    const cooldown = await this.repo.getCooldownPolicy();
    const backgroundExploration = await this.repo.getBackgroundExplorationConfig();
    const timeout = await this.repo.getTimeoutConfig();
    const stall = await this.repo.getStallConfig();
    const allSettings = await this.repo.getAllSettings();

    // Spread all flat settings (non-dotted keys) onto the cache so new settings
    // are picked up automatically without needing to touch rebuildCache().
    const flatSettings = Object.fromEntries(
      Object.entries(allSettings).filter(([k]) => !k.includes('.'))
    );

    // Build quota configs from providers (same logic as buildProviderQuotaConfigs)
    const quotas = this.buildProviderQuotaConfigs(providers);

    this.cache = {
      ...flatSettings,
      providers,
      models,
      keys,
      failover,
      cooldown,
      timeout,
      stall: Object.values(stall).some((v) => v !== null && v !== undefined) ? stall : undefined,
      backgroundExploration,
      quotas,
      mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
      mcp_servers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
      user_quotas: Object.keys(userQuotas).length > 0 ? userQuotas : undefined,
    };

    // Reload the quota scheduler with the updated quota configs so that
    // changes saved via the UI take effect without a restart.
    // Only reload if the scheduler has already been initialized (has checkers registered);
    // on startup, index.ts calls quotaScheduler.initialize() explicitly after this.
    const scheduler = QuotaScheduler.getInstance();
    if (scheduler.getCheckerIds().length > 0) {
      scheduler.reload(quotas).catch((err) => {
        logger.warn(`Failed to reload QuotaScheduler after config change: ${err}`);
      });
    }
  }

  /**
   * Build quota configs from provider configs.
   * Mirrors the logic from config.ts buildProviderQuotaConfigs.
   */
  private buildProviderQuotaConfigs(providers: Record<string, ProviderConfig>): QuotaConfig[] {
    const quotas: QuotaConfig[] = [];
    const seenIds = new Set<string>();

    // Process explicitly configured quota checkers
    for (const [providerId, providerConfig] of Object.entries(providers)) {
      if (providerConfig.enabled === false) continue;

      const quotaChecker = providerConfig.quota_checker;
      logger.debug(
        `[buildProviderQuotaConfigs] provider='${providerId}' quota_checker=${JSON.stringify(quotaChecker)}`
      );
      if (!quotaChecker || quotaChecker.enabled === false) continue;

      const checkerId = (quotaChecker.id ?? providerId).trim();
      if (!checkerId || seenIds.has(checkerId)) continue;
      seenIds.add(checkerId);

      const options: Record<string, unknown> = { ...(quotaChecker.options ?? {}) };

      const apiKey = providerConfig.api_key?.trim();
      if (apiKey && apiKey.toLowerCase() !== 'oauth' && options.apiKey === undefined) {
        options.apiKey = apiKey;
      }
      if (providerConfig.oauth_provider && options.oauthProvider === undefined) {
        options.oauthProvider = providerConfig.oauth_provider;
      }
      if (providerConfig.oauth_account && options.oauthAccountId === undefined) {
        options.oauthAccountId = providerConfig.oauth_account;
      }

      quotas.push({
        id: checkerId,
        provider: providerId,
        type: quotaChecker.type,
        enabled: true,
        intervalMinutes: quotaChecker.intervalMinutes,
        options,
      });
    }

    return quotas;
  }

  private isOAuthProvider(config: any): boolean {
    if (typeof config?.api_base_url === 'string') {
      return config.api_base_url.startsWith('oauth://');
    }
    if (typeof config?.api_base_url === 'object' && config.api_base_url !== null) {
      return Object.values(config.api_base_url).some(
        (v) => typeof v === 'string' && v.startsWith('oauth://')
      );
    }
    return false;
  }
}
