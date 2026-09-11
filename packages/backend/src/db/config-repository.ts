import { and, eq } from 'drizzle-orm';
import { getDatabase, getSchema } from './client';
import { decrypt, decryptField, encrypt, encryptField } from '../utils/encryption';
import type {
  BackgroundExplorationConfig,
  CompactionSettingsConfig,
  CooldownPolicy,
  FailoverPolicy,
  KeyConfig,
  McpOAuthConfig,
  McpServerConfig,
  ModelConfig,
  ProviderConfig,
  QuotaDefinition,
  StallConfigType,
  TimeoutConfig,
} from '../config';
import { decryptJsonField, encryptJsonField, fromBool, now, toBool } from './repository-utils';
import { AliasRepository } from './alias-repository';
import { KeyRepository } from './key-repository';
import { ProviderRepository } from './provider-repository';
import { QuotaRepository } from './quota-repository';
import { SystemSettingsRepository } from './system-settings-repository';

export interface CustomCheckerRecord {
  id: string;
  displayName: string;
  code: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface OAuthCredentialsData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch seconds
}

export interface McpKeyConfig {
  serverName: string;
  key: string;
  isActive: boolean;
}

/**
 * Backwards-compatible facade over the domain-specific configuration repositories.
 *
 * Existing services can continue to depend on ConfigRepository while each domain's
 * persistence logic remains isolated in its own repository.
 */
type CustomCheckerRow = {
  id: string;
  displayName: string;
  code: string;
  enabled: unknown;
  createdAt: unknown;
  updatedAt: unknown;
};
export class ConfigRepository {
  private readonly providers = new ProviderRepository();
  private readonly aliases = new AliasRepository();
  private readonly keys = new KeyRepository();
  private readonly quotas = new QuotaRepository();
  private readonly settings = new SystemSettingsRepository();

  private db() {
    return getDatabase();
  }

  private schema() {
    return getSchema();
  }

  async getCustomCheckers(): Promise<CustomCheckerRecord[]> {
    const rows = (await this.db()
      .select()
      .from(this.schema().customCheckers)) as CustomCheckerRow[];
    return rows.map((row) => ({
      id: row.id,
      displayName: row.displayName,
      code: row.code,
      enabled: toBool(row.enabled),
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
    }));
  }

  async getCustomChecker(id: string): Promise<CustomCheckerRecord | null> {
    const rows = await this.db()
      .select()
      .from(this.schema().customCheckers)
      .where(eq(this.schema().customCheckers.id, id))
      .limit(1);
    const row = rows[0] as CustomCheckerRow | undefined;
    if (!row) return null;
    return {
      id: row.id,
      displayName: row.displayName,
      code: row.code,
      enabled: toBool(row.enabled),
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
    };
  }

  async saveCustomChecker(
    id: string,
    data: { displayName: string; code: string; enabled: boolean }
  ): Promise<CustomCheckerRecord> {
    const schema = this.schema();
    const timestamp = now();
    const values = {
      id,
      displayName: data.displayName,
      code: data.code,
      enabled: fromBool(data.enabled),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const existing = await this.getCustomChecker(id);
    if (existing) {
      await this.db()
        .update(schema.customCheckers)
        .set({
          displayName: values.displayName,
          code: values.code,
          enabled: values.enabled,
          updatedAt: values.updatedAt,
        })
        .where(eq(schema.customCheckers.id, id));
    } else {
      await this.db().insert(schema.customCheckers).values(values);
    }
    return (await this.getCustomChecker(id))!;
  }

  async deleteCustomChecker(id: string): Promise<void> {
    await this.db()
      .delete(this.schema().customCheckers)
      .where(eq(this.schema().customCheckers.id, id));
  }

  // ─── Clear All Data (for failed bootstrap rollback) ─────────────

  async clearAllData(): Promise<void> {
    const schema = this.schema();
    await this.db().delete(schema.modelAliasTargets);
    await this.db().delete(schema.providerModels);
    await this.db().delete(schema.modelAliases);
    await this.db().delete(schema.providers);
    await this.db().delete(schema.customCheckers);
    await this.db().delete(schema.apiKeys);
    await this.db().delete(schema.userQuotaDefinitions);
    await this.db().delete(schema.mcpKeys);
    await this.db().delete(schema.mcpServers);
    await this.db().delete(schema.oauthCredentials);
    await this.db().delete(schema.systemSettings);
  }

  // ─── Providers ───────────────────────────────────────────────────

  getAllProviders(): Promise<Record<string, ProviderConfig>> {
    return this.providers.getAllProviders();
  }

  getProvider(slug: string): Promise<ProviderConfig | null> {
    return this.providers.getProvider(slug);
  }

  saveProvider(slug: string, config: ProviderConfig): Promise<void> {
    return this.providers.saveProvider(slug, config);
  }

  deleteProvider(slug: string, cascade: boolean = true): Promise<void> {
    return this.providers.deleteProvider(slug, cascade);
  }

  getProviderModels(providerSlug: string): Promise<
    Array<{
      modelName: string;
      pricingConfig: unknown;
      modelType: string | null;
      accessVia: string[] | null;
    }>
  > {
    return this.providers.getProviderModels(providerSlug);
  }

  addMissingProviderModels(providerSlug: string, modelNames: string[]): Promise<number> {
    return this.providers.addMissingProviderModels(providerSlug, modelNames);
  }

  // ─── Model Aliases ───────────────────────────────────────────────

  getAllAliases(): Promise<Record<string, ModelConfig>> {
    return this.aliases.getAllAliases();
  }

  getAlias(slug: string): Promise<ModelConfig | null> {
    return this.aliases.getAlias(slug);
  }

  migrateLegacyTargetGroups(): Promise<string[]> {
    return this.aliases.migrateLegacyTargetGroups();
  }

  migrateModelTypes(): Promise<number> {
    return this.aliases.migrateModelTypes();
  }

  repairCorruptedAliasFallbackSlugs(): Promise<number> {
    return this.aliases.repairCorruptedAliasFallbackSlugs();
  }

  saveAlias(slug: string, config: ModelConfig): Promise<void> {
    return this.aliases.saveAlias(slug, config);
  }

  deleteAlias(slug: string): Promise<void> {
    return this.aliases.deleteAlias(slug);
  }

  deleteAllAliases(): Promise<number> {
    return this.aliases.deleteAllAliases();
  }

  // ─── API Keys ────────────────────────────────────────────────────

  getAllKeys(): Promise<Record<string, KeyConfig>> {
    return this.keys.getAllKeys();
  }

  getKeyBySecret(secret: string): Promise<{ name: string; config: KeyConfig } | null> {
    return this.keys.getKeyBySecret(secret);
  }

  saveKey(name: string, config: KeyConfig): Promise<void> {
    return this.keys.saveKey(name, config);
  }

  deleteKey(name: string): Promise<void> {
    return this.keys.deleteKey(name);
  }

  disableTimeBoundKey(name: string): Promise<boolean> {
    return this.keys.disableTimeBoundKey(name);
  }

  // ─── User Quotas ────────────────────────────────────────────────

  getAllUserQuotas(): Promise<Record<string, QuotaDefinition>> {
    return this.quotas.getAllUserQuotas();
  }

  saveUserQuota(name: string, quota: QuotaDefinition): Promise<void> {
    return this.quotas.saveUserQuota(name, quota);
  }

  deleteUserQuota(name: string): Promise<void> {
    return this.quotas.deleteUserQuota(name);
  }

  // ─── MCP Servers ─────────────────────────────────────────────────

  async getAllMcpServers(): Promise<Record<string, McpServerConfig>> {
    const schema = this.schema();
    const rows = await this.db().select().from(schema.mcpServers);
    const result: Record<string, McpServerConfig> = {};

    for (const row of rows) {
      const mode = row.mode || 'remote_http';

      if (mode === 'local_http') {
        const localConfig: McpServerConfig = {
          mode: 'local_http',
          enabled: toBool(row.enabled),
          launcher: row.launcher as 'bunx' | 'uvx',
          package: row.packageName || '',
          args: row.args ? decryptJsonField<string[]>(row.args) || [] : [],
          env: row.env ? decryptJsonField<Record<string, string>>(row.env) || undefined : undefined,
          port: Number(row.port || 0),
          path: row.path || '/mcp',
          startup_timeout_ms: Number(row.startupTimeoutMs || 30000),
          headers: row.headers
            ? decryptJsonField<Record<string, string>>(row.headers) || undefined
            : undefined,
          auth_scheme: row.authScheme,
          rate_limit_cooldown_ms: Number(row.rateLimitCooldownMs),
          quota_cooldown_ms: Number(row.quotaCooldownMs),
        };
        result[row.name] = localConfig;
        continue;
      }

      result[row.name] = {
        upstream_url: row.upstreamUrl,
        enabled: toBool(row.enabled),
        ...(row.headers
          ? { headers: decryptJsonField<Record<string, string>>(row.headers) ?? undefined }
          : {}),
        auth_scheme: row.authScheme,
        rate_limit_cooldown_ms: Number(row.rateLimitCooldownMs),
        quota_cooldown_ms: Number(row.quotaCooldownMs),
      };
    }

    return result;
  }

  async saveMcpServer(name: string, config: McpServerConfig): Promise<void> {
    const schema = this.schema();
    const timestamp = now();

    const existing = await this.db()
      .select()
      .from(schema.mcpServers)
      .where(eq(schema.mcpServers.name, name))
      .limit(1);

    const isLocal = config.mode === 'local_http';
    const upstreamUrl = isLocal
      ? 'http://127.0.0.1:' + config.port + (config.path || '/mcp')
      : config.upstream_url;
    const localFields = isLocal
      ? {
          mode: 'local_http',
          launcher: config.launcher,
          packageName: config.package,
          args: config.args ? encryptJsonField(config.args) : null,
          env: config.env ? encryptJsonField(config.env) : null,
          port: config.port,
          path: config.path || '/mcp',
          startupTimeoutMs: config.startup_timeout_ms || 30000,
        }
      : {
          mode: 'remote_http',
          launcher: null,
          packageName: null,
          args: null,
          env: null,
          port: null,
          path: null,
          startupTimeoutMs: null,
        };

    if (existing.length > 0) {
      await this.db()
        .update(schema.mcpServers)
        .set({
          upstreamUrl,
          enabled: fromBool(config.enabled !== false),
          headers: config.headers ? encryptJsonField(config.headers) : null,
          authScheme: config.auth_scheme ?? null,
          rateLimitCooldownMs: config.rate_limit_cooldown_ms ?? 60000,
          quotaCooldownMs: config.quota_cooldown_ms ?? 86400000,
          ...localFields,
          updatedAt: timestamp,
        })
        .where(eq(schema.mcpServers.name, name));
    } else {
      await this.db()
        .insert(schema.mcpServers)
        .values({
          name,
          upstreamUrl,
          enabled: fromBool(config.enabled !== false),
          headers: config.headers ? encryptJsonField(config.headers) : null,
          authScheme: config.auth_scheme ?? null,
          rateLimitCooldownMs: config.rate_limit_cooldown_ms ?? 60000,
          quotaCooldownMs: config.quota_cooldown_ms ?? 86400000,
          ...localFields,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
    }
  }

  async deleteMcpServer(name: string): Promise<void> {
    const schema = this.schema();
    await this.db().delete(schema.mcpServers).where(eq(schema.mcpServers.name, name));
  }

  async getMcpServerKeys(name: string) {
    const schema = this.schema();
    const [server] = await this.db()
      .select({ id: schema.mcpServers.id })
      .from(schema.mcpServers)
      .where(eq(schema.mcpServers.name, name))
      .limit(1);
    if (!server) return null;

    return this.db()
      .select({
        id: schema.mcpKeys.id,
        key: schema.mcpKeys.key,
        isActive: schema.mcpKeys.isActive,
        cooldownUntil: schema.mcpKeys.cooldownUntil,
      })
      .from(schema.mcpKeys)
      .where(eq(schema.mcpKeys.mcpServerId, server.id));
  }

  async getAllMcpKeys(): Promise<McpKeyConfig[]> {
    const schema = this.schema();
    const rows = await this.db()
      .select({
        serverName: schema.mcpServers.name,
        key: schema.mcpKeys.key,
        isActive: schema.mcpKeys.isActive,
      })
      .from(schema.mcpKeys)
      .innerJoin(schema.mcpServers, eq(schema.mcpKeys.mcpServerId, schema.mcpServers.id));

    return rows.map((row: { serverName: string; key: string; isActive: boolean | number }) => ({
      ...row,
      key: decryptField(row.key) as string,
      isActive: toBool(row.isActive),
    }));
  }

  async batchInsertMcpKeys(keys: McpKeyConfig[]): Promise<void> {
    if (keys.length === 0) return;

    const schema = this.schema();
    const servers = await this.db()
      .select({ id: schema.mcpServers.id, name: schema.mcpServers.name })
      .from(schema.mcpServers);
    const serverIds = new Map(
      servers.map((server: { name: string; id: number }) => [server.name, server.id])
    );
    const timestamp = new Date();

    await this.db()
      .insert(schema.mcpKeys)
      .values(
        keys.map((key) => {
          const mcpServerId = serverIds.get(key.serverName);
          if (mcpServerId === undefined) {
            throw new Error(`Cannot restore MCP key for unknown server: ${key.serverName}`);
          }
          return {
            mcpServerId,
            key: encryptField(key.key) as string,
            isActive: fromBool(key.isActive),
            createdAt: timestamp,
            updatedAt: timestamp,
          };
        })
      );
  }

  async addMcpServerKey(name: string, key: string, isActive: boolean) {
    const schema = this.schema();
    const [server] = await this.db()
      .select({ id: schema.mcpServers.id })
      .from(schema.mcpServers)
      .where(eq(schema.mcpServers.name, name))
      .limit(1);
    if (!server) return null;

    const timestamp = new Date();
    const [created] = await this.db()
      .insert(schema.mcpKeys)
      .values({
        mcpServerId: server.id,
        key: encryptField(key) as string,
        isActive: fromBool(isActive),
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning({
        id: schema.mcpKeys.id,
        key: schema.mcpKeys.key,
        isActive: schema.mcpKeys.isActive,
        cooldownUntil: schema.mcpKeys.cooldownUntil,
      });
    return created!;
  }

  async deleteMcpServerKey(name: string, keyId: number): Promise<boolean> {
    const schema = this.schema();
    const [server] = await this.db()
      .select({ id: schema.mcpServers.id })
      .from(schema.mcpServers)
      .where(eq(schema.mcpServers.name, name))
      .limit(1);
    if (!server) return false;

    const deleted = await this.db()
      .delete(schema.mcpKeys)
      .where(and(eq(schema.mcpKeys.id, keyId), eq(schema.mcpKeys.mcpServerId, server.id)))
      .returning({ id: schema.mcpKeys.id });
    return deleted.length > 0;
  }

  async clearMcpServerKeyCooldown(name: string, keyId: number): Promise<boolean> {
    const schema = this.schema();
    const [server] = await this.db()
      .select({ id: schema.mcpServers.id })
      .from(schema.mcpServers)
      .where(eq(schema.mcpServers.name, name))
      .limit(1);
    if (!server) return false;

    const updated = await this.db()
      .update(schema.mcpKeys)
      .set({ cooldownUntil: null, updatedAt: new Date() })
      .where(and(eq(schema.mcpKeys.id, keyId), eq(schema.mcpKeys.mcpServerId, server.id)))
      .returning({ id: schema.mcpKeys.id });
    return updated.length > 0;
  }

  // ─── System Settings ─────────────────────────────────────────────

  getSetting<T>(key: string, defaultValue: T): Promise<T> {
    return this.settings.getSetting(key, defaultValue);
  }

  setSetting(key: string, value: unknown): Promise<void> {
    return this.settings.setSetting(key, value);
  }

  setSettingsBulk(entries: Record<string, unknown>): Promise<void> {
    return this.settings.setSettingsBulk(entries);
  }

  getAllSettings(): Promise<Record<string, unknown>> {
    return this.settings.getAllSettings();
  }

  getFailoverPolicy(): Promise<FailoverPolicy> {
    return this.settings.getFailoverPolicy();
  }

  getCaptureTraceOnError(): Promise<boolean> {
    return this.settings.getCaptureTraceOnError();
  }

  getCooldownPolicy(): Promise<CooldownPolicy> {
    return this.settings.getCooldownPolicy();
  }

  getTrustedProxies(): Promise<string[]> {
    return this.settings.getTrustedProxies();
  }

  getBackgroundExplorationConfig(): Promise<BackgroundExplorationConfig> {
    return this.settings.getBackgroundExplorationConfig();
  }

  getMcpOAuthConfig(): Promise<McpOAuthConfig> {
    return this.settings.getMcpOAuthConfig();
  }

  getTimeoutConfig(): Promise<TimeoutConfig> {
    return this.settings.getTimeoutConfig();
  }

  getCompactionConfig(): Promise<CompactionSettingsConfig> {
    return this.settings.getCompactionConfig();
  }

  getStallConfig(): Promise<StallConfigType> {
    return this.settings.getStallConfig();
  }

  // ─── OAuth Credentials ──────────────────────────────────────────

  async getOAuthCredentials(
    providerType: string,
    accountId?: string
  ): Promise<OAuthCredentialsData | null> {
    const schema = this.schema();
    let rows;

    if (accountId) {
      rows = await this.db()
        .select()
        .from(schema.oauthCredentials)
        .where(
          and(
            eq(schema.oauthCredentials.oauthProviderType, providerType),
            eq(schema.oauthCredentials.accountId, accountId)
          )
        )
        .limit(1);
    } else {
      rows = await this.db()
        .select()
        .from(schema.oauthCredentials)
        .where(eq(schema.oauthCredentials.oauthProviderType, providerType))
        .limit(1);
    }

    if (rows.length === 0) return null;

    const row = rows[0]!;
    return {
      accessToken: decrypt(row.accessToken),
      refreshToken: decrypt(row.refreshToken),
      expiresAt: row.expiresAt,
    };
  }

  async setOAuthCredentials(
    providerType: string,
    accountId: string,
    creds: OAuthCredentialsData
  ): Promise<void> {
    const schema = this.schema();
    const timestamp = now();

    const encryptedAccessToken = encrypt(creds.accessToken);
    const encryptedRefreshToken = encrypt(creds.refreshToken);

    const existing = await this.db()
      .select()
      .from(schema.oauthCredentials)
      .where(
        and(
          eq(schema.oauthCredentials.oauthProviderType, providerType),
          eq(schema.oauthCredentials.accountId, accountId)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await this.db()
        .update(schema.oauthCredentials)
        .set({
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          expiresAt: creds.expiresAt,
          updatedAt: timestamp,
        })
        .where(eq(schema.oauthCredentials.id, existing[0]!.id));
    } else {
      await this.db().insert(schema.oauthCredentials).values({
        oauthProviderType: providerType,
        accountId,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        expiresAt: creds.expiresAt,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
  }

  async deleteOAuthCredentials(providerType: string, accountId: string): Promise<void> {
    const schema = this.schema();
    await this.db()
      .delete(schema.oauthCredentials)
      .where(
        and(
          eq(schema.oauthCredentials.oauthProviderType, providerType),
          eq(schema.oauthCredentials.accountId, accountId)
        )
      );
  }

  async getAllOAuthProviders(): Promise<Array<{ providerType: string; accountId: string }>> {
    const schema = this.schema();
    const rows = await this.db()
      .select({
        providerType: schema.oauthCredentials.oauthProviderType,
        accountId: schema.oauthCredentials.accountId,
      })
      .from(schema.oauthCredentials);

    return rows;
  }
}
