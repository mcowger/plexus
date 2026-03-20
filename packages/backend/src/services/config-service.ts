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
} from '../config';
import { VALID_QUOTA_CHECKER_TYPES } from '../config';
import { QuotaScheduler } from './quota/quota-scheduler';
import yaml from 'yaml';

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

  // ─── Initialization ──────────────────────────────────────────────

  /**
   * Load full config from DB into cache.
   * Must be called once during startup, after DB is initialized.
   */
  async initialize(): Promise<void> {
    await this.rebuildCache();
    logger.info('ConfigService initialized from database');
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
  async isFirstLaunch(): Promise<boolean> {
    return this.repo.isFirstLaunch();
  }

  getRepository(): ConfigRepository {
    return this.repo;
  }

  // ─── Provider CRUD ───────────────────────────────────────────────

  async saveProvider(slug: string, config: ProviderConfig): Promise<void> {
    await this.repo.saveProvider(slug, config);
    await this.rebuildCache();
  }

  async deleteProvider(slug: string, cascade: boolean = true): Promise<void> {
    await this.repo.deleteProvider(slug, cascade);
    await this.rebuildCache();
  }

  // ─── Alias CRUD ──────────────────────────────────────────────────

  async saveAlias(slug: string, config: ModelConfig): Promise<void> {
    await this.repo.saveAlias(slug, config);
    await this.rebuildCache();
  }

  async deleteAlias(slug: string): Promise<void> {
    await this.repo.deleteAlias(slug);
    await this.rebuildCache();
  }

  async deleteAllAliases(): Promise<number> {
    const count = await this.repo.deleteAllAliases();
    await this.rebuildCache();
    return count;
  }

  // ─── Key CRUD ────────────────────────────────────────────────────

  async saveKey(name: string, config: KeyConfig): Promise<void> {
    await this.repo.saveKey(name, config);
    await this.rebuildCache();
  }

  async deleteKey(name: string): Promise<void> {
    await this.repo.deleteKey(name);
    await this.rebuildCache();
  }

  // ─── User Quota CRUD ─────────────────────────────────────────────

  async saveUserQuota(name: string, quota: QuotaDefinition): Promise<void> {
    await this.repo.saveUserQuota(name, quota);
    await this.rebuildCache();
  }

  async deleteUserQuota(name: string): Promise<void> {
    await this.repo.deleteUserQuota(name);
    await this.rebuildCache();
  }

  // ─── MCP Server CRUD ─────────────────────────────────────────────

  async saveMcpServer(name: string, config: McpServerConfig): Promise<void> {
    await this.repo.saveMcpServer(name, config);
    await this.rebuildCache();
  }

  async deleteMcpServer(name: string): Promise<void> {
    await this.repo.deleteMcpServer(name);
    await this.rebuildCache();
  }

  // ─── Settings ─────────────────────────────────────────────────────

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.repo.setSetting(key, value);
    await this.rebuildCache();
  }

  async setSettingsBulk(entries: Record<string, unknown>): Promise<void> {
    await this.repo.setSettingsBulk(entries);
    await this.rebuildCache();
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

  // ─── Import from YAML/JSON ──────────────────────────────────────

  /**
   * Import configuration from a plexus.yaml string into the database.
   * Used during bootstrap when the DB is empty.
   */
  async importFromYaml(yamlContent: string): Promise<void> {
    const parsed = yaml.parse(yamlContent);

    // Import providers
    if (parsed.providers && typeof parsed.providers === 'object') {
      for (const [slug, config] of Object.entries(parsed.providers)) {
        // Ensure oauth_account is set for OAuth providers
        const providerConfig = config as any;
        if (this.isOAuthProvider(providerConfig) && !providerConfig.oauth_account) {
          providerConfig.oauth_account = 'legacy';
        }
        await this.repo.saveProvider(slug, providerConfig as ProviderConfig);
      }
      logger.info(`Imported ${Object.keys(parsed.providers).length} providers`);
    }

    // Import model aliases
    if (parsed.models && typeof parsed.models === 'object') {
      for (const [slug, config] of Object.entries(parsed.models)) {
        await this.repo.saveAlias(slug, config as ModelConfig);
      }
      logger.info(`Imported ${Object.keys(parsed.models).length} model aliases`);
    }

    // Import API keys
    if (parsed.keys && typeof parsed.keys === 'object') {
      for (const [name, config] of Object.entries(parsed.keys)) {
        await this.repo.saveKey(name, config as KeyConfig);
      }
      logger.info(`Imported ${Object.keys(parsed.keys).length} API keys`);
    }

    // Import user quotas
    if (parsed.user_quotas && typeof parsed.user_quotas === 'object') {
      for (const [name, config] of Object.entries(parsed.user_quotas)) {
        await this.repo.saveUserQuota(name, config as QuotaDefinition);
      }
      logger.info(`Imported ${Object.keys(parsed.user_quotas).length} user quotas`);
    }

    // Import MCP servers
    if (parsed.mcp_servers && typeof parsed.mcp_servers === 'object') {
      for (const [name, config] of Object.entries(parsed.mcp_servers)) {
        await this.repo.saveMcpServer(name, config as McpServerConfig);
      }
      logger.info(`Imported ${Object.keys(parsed.mcp_servers).length} MCP servers`);
    }

    // Import failover policy
    if (parsed.failover && typeof parsed.failover === 'object') {
      const failover = parsed.failover as FailoverPolicy;
      if (failover.enabled !== undefined) {
        await this.repo.setSetting('failover.enabled', failover.enabled);
      }
      if (failover.retryableStatusCodes) {
        await this.repo.setSetting('failover.retryableStatusCodes', failover.retryableStatusCodes);
      }
      if (failover.retryableErrors) {
        await this.repo.setSetting('failover.retryableErrors', failover.retryableErrors);
      }
      logger.info('Imported failover policy');
    }

    // Import cooldown policy
    if (parsed.cooldown && typeof parsed.cooldown === 'object') {
      const cooldown = parsed.cooldown as CooldownPolicy;
      if (cooldown.initialMinutes !== undefined) {
        await this.repo.setSetting('cooldown.initialMinutes', cooldown.initialMinutes);
      }
      if (cooldown.maxMinutes !== undefined) {
        await this.repo.setSetting('cooldown.maxMinutes', cooldown.maxMinutes);
      }
      logger.info('Imported cooldown policy');
    }

    // Import exploration rates
    if (parsed.performanceExplorationRate !== undefined) {
      await this.repo.setSetting('performanceExplorationRate', parsed.performanceExplorationRate);
    }
    if (parsed.latencyExplorationRate !== undefined) {
      await this.repo.setSetting('latencyExplorationRate', parsed.latencyExplorationRate);
    }

    // Import vision_fallthrough
    if (parsed.vision_fallthrough && typeof parsed.vision_fallthrough === 'object') {
      await this.repo.setSetting('vision_fallthrough', parsed.vision_fallthrough);
    }

    await this.rebuildCache();
  }

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

    logger.info(`Imported OAuth credentials from auth.json`);
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

  // ─── Internal ────────────────────────────────────────────────────

  /**
   * Rebuild the in-memory cache from the database.
   */
  private async rebuildCache(): Promise<void> {
    const providers = await this.repo.getAllProviders();
    const models = await this.repo.getAllAliases();
    const keys = await this.repo.getAllKeys();
    const userQuotas = await this.repo.getAllUserQuotas();
    const mcpServers = await this.repo.getAllMcpServers();
    const failover = await this.repo.getFailoverPolicy();
    const cooldown = await this.repo.getCooldownPolicy();
    const performanceExplorationRate = await this.repo.getSetting<number>(
      'performanceExplorationRate',
      0.05
    );
    const latencyExplorationRate = await this.repo.getSetting<number>(
      'latencyExplorationRate',
      0.05
    );
    const visionFallthrough = await this.repo.getSetting<any>('vision_fallthrough', undefined);

    // Build quota configs from providers (same logic as buildProviderQuotaConfigs)
    const quotas = this.buildProviderQuotaConfigs(providers);

    this.cache = {
      providers,
      models,
      keys,
      failover,
      cooldown,
      quotas,
      mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
      mcp_servers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
      user_quotas: Object.keys(userQuotas).length > 0 ? userQuotas : undefined,
      performanceExplorationRate,
      latencyExplorationRate,
      ...(visionFallthrough ? { vision_fallthrough: visionFallthrough } : {}),
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

    // Add implicit quota checkers for OAuth providers
    const oauthQuotaCheckers: Record<string, { type: string; intervalMinutes: number }> = {
      'openai-codex': { type: 'openai-codex', intervalMinutes: 5 },
      'claude-code': { type: 'claude-code', intervalMinutes: 5 },
      'github-copilot': { type: 'copilot', intervalMinutes: 5 },
      'google-gemini-cli': { type: 'gemini-cli', intervalMinutes: 5 },
      'google-antigravity': { type: 'antigravity', intervalMinutes: 5 },
    };

    for (const [providerId, providerConfig] of Object.entries(providers)) {
      if (providerConfig.enabled === false) continue;
      if (providerConfig.quota_checker && providerConfig.quota_checker.enabled !== false) continue;

      const oauthProvider = providerConfig.oauth_provider;
      if (oauthProvider && oauthQuotaCheckers[oauthProvider]) {
        const quotaInfo = oauthQuotaCheckers[oauthProvider]!;
        const checkerId = `${providerId}-${oauthProvider}`;

        if (!seenIds.has(checkerId)) {
          seenIds.add(checkerId);

          const options: Record<string, unknown> = {};
          if (oauthProvider) options.oauthProvider = oauthProvider;
          if (providerConfig.oauth_account) options.oauthAccountId = providerConfig.oauth_account;

          quotas.push({
            id: checkerId,
            provider: providerId,
            type: quotaInfo.type,
            enabled: true,
            intervalMinutes: quotaInfo.intervalMinutes,
            options,
          });
        }
      }
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
