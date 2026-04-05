import { eq, and, sql } from 'drizzle-orm';
import { getDatabase, getSchema, getCurrentDialect } from './client';
import { logger } from '../utils/logger';
import {
  encrypt,
  decrypt,
  encryptField,
  decryptField,
  hashSecret,
  isEncrypted,
  isEncryptionEnabled,
} from '../utils/encryption';
import type {
  ProviderConfig,
  ModelConfig,
  KeyConfig,
  QuotaDefinition,
  McpServerConfig,
  FailoverPolicy,
  CooldownPolicy,
} from '../config';

// Helper to parse JSON from SQLite text columns (PG jsonb auto-deserializes)
function parseJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      // PG jsonb auto-deserializes plain strings (e.g. "oauth://...") before
      // they reach us, so the value is already the correct T — return it as-is.
      return value as unknown as T;
    }
  }
  return null;
}

function toJson(value: unknown): string | unknown {
  if (value === null || value === undefined) return null;
  const dialect = getCurrentDialect();
  if (dialect === 'sqlite') {
    return JSON.stringify(value);
  }
  return value; // PG jsonb handles objects natively
}

/**
 * Encrypt a JSON value for storage in a TEXT column.
 * JSON-serializes the value, then encrypts the resulting string.
 * If encryption is disabled, returns the JSON string as-is.
 */
function encryptJsonField(value: unknown): string {
  if (value === null || value === undefined) return null as unknown as string;
  const strVal = typeof value === 'string' ? value : JSON.stringify(value);
  return encrypt(strVal);
}

/**
 * Decrypt a JSON value read from the database. Handles:
 * - Encrypted strings (enc:v1:...) → decrypt then JSON.parse
 * - Plain strings (SQLite text) → JSON.parse
 * - Already-parsed objects (PG jsonb with unencrypted data) → return as-is
 */
function decryptJsonField<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const decrypted = decrypt(value);
    try {
      return JSON.parse(decrypted) as T;
    } catch {
      return decrypted as unknown as T;
    }
  }
  if (typeof value === 'object') return value as T;
  return null;
}

function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return value === 1 || value === true;
}

function fromBool(value: boolean): number | boolean {
  const dialect = getCurrentDialect();
  if (dialect === 'sqlite') return value ? 1 : 0;
  return value;
}

function now(): number {
  return Date.now();
}

export interface OAuthCredentialsData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch seconds
}

export class ConfigRepository {
  private db() {
    return getDatabase();
  }

  private schema() {
    return getSchema();
  }

  // ─── Clear All Data (for failed bootstrap rollback) ─────────────

  async clearAllData(): Promise<void> {
    const schema = this.schema();
    await this.db().delete(schema.modelAliasTargets);
    await this.db().delete(schema.providerModels);
    await this.db().delete(schema.modelAliases);
    await this.db().delete(schema.providers);
    await this.db().delete(schema.apiKeys);
    await this.db().delete(schema.userQuotaDefinitions);
    await this.db().delete(schema.mcpServers);
    await this.db().delete(schema.oauthCredentials);
    await this.db().delete(schema.systemSettings);
  }

  // ─── Providers ───────────────────────────────────────────────────

  async getAllProviders(): Promise<Record<string, ProviderConfig>> {
    const schema = this.schema();
    const rows = await this.db().select().from(schema.providers);
    const result: Record<string, ProviderConfig> = {};

    for (const row of rows) {
      const models = await this.db()
        .select()
        .from(schema.providerModels)
        .where(eq(schema.providerModels.providerId, row.id))
        .orderBy(schema.providerModels.sortOrder);

      let oauthAccountId: string | undefined;
      if (row.oauthCredentialId) {
        const creds = await this.db()
          .select({ accountId: schema.oauthCredentials.accountId })
          .from(schema.oauthCredentials)
          .where(eq(schema.oauthCredentials.id, row.oauthCredentialId))
          .limit(1);
        if (creds.length > 0) oauthAccountId = creds[0]!.accountId;
      }
      result[row.slug] = this.rowToProviderConfig(row, models, oauthAccountId);
    }

    return result;
  }

  async getProvider(slug: string): Promise<ProviderConfig | null> {
    const schema = this.schema();
    const rows = await this.db()
      .select()
      .from(schema.providers)
      .where(eq(schema.providers.slug, slug))
      .limit(1);

    if (rows.length === 0) return null;

    const row = rows[0]!;
    const models = await this.db()
      .select()
      .from(schema.providerModels)
      .where(eq(schema.providerModels.providerId, row.id))
      .orderBy(schema.providerModels.sortOrder);

    let oauthAccountId: string | undefined;
    if (row.oauthCredentialId) {
      const creds = await this.db()
        .select({ accountId: schema.oauthCredentials.accountId })
        .from(schema.oauthCredentials)
        .where(eq(schema.oauthCredentials.id, row.oauthCredentialId))
        .limit(1);
      if (creds.length > 0) oauthAccountId = creds[0]!.accountId;
    }
    return this.rowToProviderConfig(row, models, oauthAccountId);
  }

  async saveProvider(slug: string, config: ProviderConfig): Promise<void> {
    const schema = this.schema();
    const timestamp = now();

    // Resolve oauth_credential_id if this is an OAuth provider
    let oauthCredentialId: number | null = null;
    if (config.oauth_provider && config.oauth_account) {
      const creds = await this.db()
        .select()
        .from(schema.oauthCredentials)
        .where(
          and(
            eq(schema.oauthCredentials.oauthProviderType, config.oauth_provider),
            eq(schema.oauthCredentials.accountId, config.oauth_account)
          )
        )
        .limit(1);
      if (creds.length > 0) {
        oauthCredentialId = creds[0]!.id;
      }
    }

    const providerData = {
      slug,
      displayName: config.display_name ?? null,
      apiBaseUrl: toJson(config.api_base_url),
      apiKey: encryptField(config.api_key ?? null),
      oauthProviderType: config.oauth_provider ?? null,
      oauthCredentialId,
      enabled: fromBool(config.enabled !== false),
      disableCooldown: fromBool(config.disable_cooldown === true),
      disableQuotaCheck: fromBool(config.disable_quota_check === true),
      discount: config.discount ?? null,
      estimateTokens: fromBool(config.estimateTokens === true),
      useClaudeMasking: fromBool(config.useClaudeMasking === true),
      headers: config.headers ? encryptJsonField(config.headers) : null,
      extraBody: config.extraBody ? toJson(config.extraBody) : null,
      quotaCheckerType: config.quota_checker?.type ?? null,
      quotaCheckerId: config.quota_checker?.id ?? null,
      quotaCheckerEnabled: fromBool(config.quota_checker?.enabled !== false),
      quotaCheckerInterval: config.quota_checker?.intervalMinutes ?? 30,
      quotaCheckerOptions: config.quota_checker?.options
        ? encryptJsonField(config.quota_checker.options)
        : null,
      updatedAt: timestamp,
    };

    // Upsert provider
    const existing = await this.db()
      .select()
      .from(schema.providers)
      .where(eq(schema.providers.slug, slug))
      .limit(1);

    let providerId: number;

    if (existing.length > 0) {
      providerId = existing[0]!.id;
      await this.db()
        .update(schema.providers)
        .set(providerData)
        .where(eq(schema.providers.id, providerId));
    } else {
      const inserted = await this.db()
        .insert(schema.providers)
        .values({ ...providerData, createdAt: timestamp })
        .returning({ id: schema.providers.id });
      providerId = inserted[0]!.id;
    }

    // Replace models
    await this.db()
      .delete(schema.providerModels)
      .where(eq(schema.providerModels.providerId, providerId));

    if (config.models) {
      if (Array.isArray(config.models)) {
        // Simple array of model names
        const modelRows = config.models.map((name: string, idx: number) => ({
          providerId,
          modelName: name,
          sortOrder: idx,
        }));
        if (modelRows.length > 0) {
          await this.db().insert(schema.providerModels).values(modelRows);
        }
      } else {
        // Record<string, ModelProviderConfig>
        const entries = Object.entries(config.models);
        const modelRows = entries.map(([name, cfg], idx) => ({
          providerId,
          modelName: name,
          pricingConfig: toJson(cfg.pricing),
          modelType: cfg.type ?? null,
          accessVia: cfg.access_via ? toJson(cfg.access_via) : null,
          extraBody: cfg.extraBody ? toJson(cfg.extraBody) : null,
          sortOrder: idx,
        }));
        if (modelRows.length > 0) {
          await this.db().insert(schema.providerModels).values(modelRows);
        }
      }
    }
  }

  async deleteProvider(slug: string, cascade: boolean = true): Promise<void> {
    const schema = this.schema();

    if (cascade) {
      // Explicitly delete model_alias_targets referencing this provider (keyed by slug, not FK)
      await this.db()
        .delete(schema.modelAliasTargets)
        .where(eq(schema.modelAliasTargets.providerSlug, slug));
      // FK cascade handles provider_models deletion automatically
      await this.db().delete(schema.providers).where(eq(schema.providers.slug, slug));
    } else {
      // Delete provider and its provider_models, but retain model_alias_targets
      await this.db().delete(schema.providers).where(eq(schema.providers.slug, slug));
    }
  }

  async getProviderModels(providerSlug: string): Promise<
    Array<{
      modelName: string;
      pricingConfig: unknown;
      modelType: string | null;
      accessVia: string[] | null;
    }>
  > {
    const schema = this.schema();
    const provider = await this.db()
      .select()
      .from(schema.providers)
      .where(eq(schema.providers.slug, providerSlug))
      .limit(1);

    if (provider.length === 0) return [];

    const rows = await this.db()
      .select()
      .from(schema.providerModels)
      .where(eq(schema.providerModels.providerId, provider[0]!.id))
      .orderBy(schema.providerModels.sortOrder);

    return rows.map((r: any) => ({
      modelName: r.modelName,
      pricingConfig: parseJson(r.pricingConfig),
      modelType: r.modelType,
      accessVia: parseJson<string[]>(r.accessVia),
    }));
  }

  private rowToProviderConfig(row: any, modelRows: any[], oauthAccountId?: string): ProviderConfig {
    const apiBaseUrl = parseJson<string | Record<string, string>>(row.apiBaseUrl);

    // Reconstruct models
    let models: string[] | Record<string, any> | undefined;
    if (modelRows.length > 0) {
      const hasConfig = modelRows.some((m: any) => m.pricingConfig !== null);
      if (hasConfig) {
        models = {};
        for (const m of modelRows) {
          (models as Record<string, any>)[m.modelName] = {
            pricing: parseJson(m.pricingConfig) ?? { source: 'simple', input: 0, output: 0 },
            ...(m.modelType ? { type: m.modelType } : {}),
            ...(m.accessVia ? { access_via: parseJson(m.accessVia) } : {}),
            ...(m.extraBody ? { extraBody: parseJson(m.extraBody) } : {}),
          };
        }
      } else {
        models = modelRows.map((m: any) => m.modelName);
      }
    }

    // Reconstruct quota_checker
    let quota_checker: any = undefined;
    if (row.quotaCheckerType) {
      quota_checker = {
        type: row.quotaCheckerType,
        enabled: toBool(row.quotaCheckerEnabled),
        intervalMinutes: row.quotaCheckerInterval,
        ...(row.quotaCheckerId ? { id: row.quotaCheckerId } : {}),
        ...(row.quotaCheckerOptions ? { options: decryptJsonField(row.quotaCheckerOptions) } : {}),
      };
    }

    // Decrypt sensitive fields
    const decryptedApiKey = decryptField(row.apiKey);

    const result: any = {
      api_base_url: apiBaseUrl ?? '',
      ...(row.displayName ? { display_name: row.displayName } : {}),
      ...(decryptedApiKey ? { api_key: decryptedApiKey } : {}),
      ...(row.oauthProviderType ? { oauth_provider: row.oauthProviderType } : {}),
      ...(oauthAccountId ? { oauth_account: oauthAccountId } : {}),
      enabled: toBool(row.enabled),
      disable_cooldown: toBool(row.disableCooldown),
      disable_quota_check: toBool(row.disableQuotaCheck),
      ...(row.discount !== null ? { discount: row.discount } : {}),
      estimateTokens: toBool(row.estimateTokens),
      useClaudeMasking: toBool(row.useClaudeMasking),
      ...(models ? { models } : {}),
      ...(row.headers ? { headers: decryptJsonField(row.headers) } : {}),
      ...(row.extraBody ? { extraBody: parseJson(row.extraBody) } : {}),
      ...(quota_checker ? { quota_checker } : {}),
    };

    return result as ProviderConfig;
  }

  // ─── Model Aliases ───────────────────────────────────────────────

  async getAllAliases(): Promise<Record<string, ModelConfig>> {
    const schema = this.schema();
    const rows = await this.db().select().from(schema.modelAliases);
    const result: Record<string, ModelConfig> = {};

    for (const row of rows) {
      const targets = await this.db()
        .select()
        .from(schema.modelAliasTargets)
        .where(eq(schema.modelAliasTargets.aliasId, row.id))
        .orderBy(schema.modelAliasTargets.sortOrder);

      result[row.slug] = this.rowToModelConfig(row, targets);
    }

    return result;
  }

  async getAlias(slug: string): Promise<ModelConfig | null> {
    const schema = this.schema();
    const rows = await this.db()
      .select()
      .from(schema.modelAliases)
      .where(eq(schema.modelAliases.slug, slug))
      .limit(1);

    if (rows.length === 0) return null;

    const row = rows[0]!;
    const targets = await this.db()
      .select()
      .from(schema.modelAliasTargets)
      .where(eq(schema.modelAliasTargets.aliasId, row.id))
      .orderBy(schema.modelAliasTargets.sortOrder);

    return this.rowToModelConfig(row, targets);
  }

  async saveAlias(slug: string, config: ModelConfig): Promise<void> {
    const schema = this.schema();
    const timestamp = now();

    const aliasData = {
      slug,
      selector: config.selector ?? null,
      priority: config.priority ?? 'selector',
      modelType: config.type ?? null,
      additionalAliases: config.additional_aliases ? toJson(config.additional_aliases) : null,
      advanced: config.advanced ? toJson(config.advanced) : null,
      metadataSource: config.metadata?.source ?? null,
      metadataSourcePath: config.metadata?.source_path ?? null,
      useImageFallthrough: fromBool(config.use_image_fallthrough === true),
      updatedAt: timestamp,
    };

    const existing = await this.db()
      .select()
      .from(schema.modelAliases)
      .where(eq(schema.modelAliases.slug, slug))
      .limit(1);

    let aliasId: number;

    if (existing.length > 0) {
      aliasId = existing[0]!.id;
      await this.db()
        .update(schema.modelAliases)
        .set(aliasData)
        .where(eq(schema.modelAliases.id, aliasId));
    } else {
      const inserted = await this.db()
        .insert(schema.modelAliases)
        .values({ ...aliasData, createdAt: timestamp })
        .returning({ id: schema.modelAliases.id });
      aliasId = inserted[0]!.id;
    }

    // Replace targets
    await this.db()
      .delete(schema.modelAliasTargets)
      .where(eq(schema.modelAliasTargets.aliasId, aliasId));

    if (config.targets && config.targets.length > 0) {
      const targetRows = config.targets.map((t, idx) => ({
        aliasId,
        providerSlug: t.provider,
        modelName: t.model,
        enabled: fromBool(t.enabled !== false),
        sortOrder: idx,
      }));
      await this.db().insert(schema.modelAliasTargets).values(targetRows);
    }
  }

  async deleteAlias(slug: string): Promise<void> {
    const schema = this.schema();
    await this.db().delete(schema.modelAliases).where(eq(schema.modelAliases.slug, slug));
  }

  async deleteAllAliases(): Promise<number> {
    const schema = this.schema();
    const count = await this.db().select().from(schema.modelAliases);
    await this.db().delete(schema.modelAliasTargets);
    await this.db().delete(schema.modelAliases);
    return count.length;
  }

  private rowToModelConfig(row: any, targetRows: any[]): ModelConfig {
    const targets = targetRows.map((t: any) => ({
      provider: t.providerSlug,
      model: t.modelName,
      enabled: toBool(t.enabled),
    }));

    const result: any = {
      targets,
      priority: row.priority ?? 'selector',
      use_image_fallthrough: toBool(row.useImageFallthrough),
      ...(row.selector ? { selector: row.selector } : {}),
      ...(row.modelType ? { type: row.modelType } : {}),
      ...(row.additionalAliases ? { additional_aliases: parseJson(row.additionalAliases) } : {}),
      ...(row.advanced ? { advanced: parseJson(row.advanced) } : {}),
      ...(row.metadataSource
        ? {
            metadata: {
              source: row.metadataSource,
              source_path: row.metadataSourcePath,
            },
          }
        : {}),
    };

    return result as ModelConfig;
  }

  // ─── API Keys ────────────────────────────────────────────────────

  async getAllKeys(): Promise<Record<string, KeyConfig>> {
    const schema = this.schema();
    const rows = await this.db().select().from(schema.apiKeys);
    const result: Record<string, KeyConfig> = {};

    for (const row of rows) {
      result[row.name] = {
        secret: decrypt(row.secret),
        ...(row.comment ? { comment: row.comment } : {}),
        ...(row.quotaName ? { quota: row.quotaName } : {}),
      };
    }

    return result;
  }

  async getKeyBySecret(secret: string): Promise<{ name: string; config: KeyConfig } | null> {
    const schema = this.schema();
    const hash = hashSecret(secret);

    // Try hash-based lookup first (works after encryption migration)
    let rows = await this.db()
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.secretHash, hash))
      .limit(1);

    // Fallback to plaintext lookup for backward compatibility (before migration)
    if (rows.length === 0) {
      rows = await this.db()
        .select()
        .from(schema.apiKeys)
        .where(eq(schema.apiKeys.secret, secret))
        .limit(1);

      if (rows.length > 0) {
        logger.error(
          'API key matched via plaintext fallback — encryption migration may not have run. ' +
            'Restart with ENCRYPTION_KEY set to trigger migration.'
        );
      }
    }

    if (rows.length === 0) return null;

    const row = rows[0]!;
    return {
      name: row.name,
      config: {
        secret: decrypt(row.secret),
        ...(row.comment ? { comment: row.comment } : {}),
        ...(row.quotaName ? { quota: row.quotaName } : {}),
      },
    };
  }

  async saveKey(name: string, config: KeyConfig): Promise<void> {
    const schema = this.schema();
    const timestamp = now();
    const encryptedSecret = encrypt(config.secret);
    const secretHash = hashSecret(config.secret);

    const existing = await this.db()
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.name, name))
      .limit(1);

    if (existing.length > 0) {
      await this.db()
        .update(schema.apiKeys)
        .set({
          secret: encryptedSecret,
          secretHash,
          comment: config.comment ?? null,
          quotaName: config.quota ?? null,
          updatedAt: timestamp,
        })
        .where(eq(schema.apiKeys.name, name));
    } else {
      await this.db()
        .insert(schema.apiKeys)
        .values({
          name,
          secret: encryptedSecret,
          secretHash,
          comment: config.comment ?? null,
          quotaName: config.quota ?? null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
    }
  }

  async deleteKey(name: string): Promise<void> {
    const schema = this.schema();
    await this.db().delete(schema.apiKeys).where(eq(schema.apiKeys.name, name));
  }

  // ─── User Quotas ────────────────────────────────────────────────

  async getAllUserQuotas(): Promise<Record<string, QuotaDefinition>> {
    const schema = this.schema();
    const rows = await this.db().select().from(schema.userQuotaDefinitions);
    const result: Record<string, QuotaDefinition> = {};

    for (const row of rows) {
      result[row.name] = {
        type: row.quotaType as 'rolling' | 'daily' | 'weekly',
        limitType: row.limitType as 'requests' | 'tokens',
        limit: row.limitValue,
        ...(row.duration ? { duration: row.duration } : {}),
      } as QuotaDefinition;
    }

    return result;
  }

  async saveUserQuota(name: string, quota: QuotaDefinition): Promise<void> {
    const schema = this.schema();
    const timestamp = now();

    const existing = await this.db()
      .select()
      .from(schema.userQuotaDefinitions)
      .where(eq(schema.userQuotaDefinitions.name, name))
      .limit(1);

    if (existing.length > 0) {
      await this.db()
        .update(schema.userQuotaDefinitions)
        .set({
          quotaType: quota.type,
          limitType: quota.limitType,
          limitValue: quota.limit,
          duration: 'duration' in quota ? quota.duration : null,
          updatedAt: timestamp,
        })
        .where(eq(schema.userQuotaDefinitions.name, name));
    } else {
      await this.db()
        .insert(schema.userQuotaDefinitions)
        .values({
          name,
          quotaType: quota.type,
          limitType: quota.limitType,
          limitValue: quota.limit,
          duration: 'duration' in quota ? quota.duration : null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
    }
  }

  async deleteUserQuota(name: string): Promise<void> {
    const schema = this.schema();
    await this.db()
      .delete(schema.userQuotaDefinitions)
      .where(eq(schema.userQuotaDefinitions.name, name));
  }

  // ─── MCP Servers ─────────────────────────────────────────────────

  async getAllMcpServers(): Promise<Record<string, McpServerConfig>> {
    const schema = this.schema();
    const rows = await this.db().select().from(schema.mcpServers);
    const result: Record<string, McpServerConfig> = {};

    for (const row of rows) {
      result[row.name] = {
        upstream_url: row.upstreamUrl,
        enabled: toBool(row.enabled),
        ...(row.headers
          ? { headers: decryptJsonField<Record<string, string>>(row.headers) ?? undefined }
          : {}),
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

    if (existing.length > 0) {
      await this.db()
        .update(schema.mcpServers)
        .set({
          upstreamUrl: config.upstream_url,
          enabled: fromBool(config.enabled !== false),
          headers: config.headers ? encryptJsonField(config.headers) : null,
          updatedAt: timestamp,
        })
        .where(eq(schema.mcpServers.name, name));
    } else {
      await this.db()
        .insert(schema.mcpServers)
        .values({
          name,
          upstreamUrl: config.upstream_url,
          enabled: fromBool(config.enabled !== false),
          headers: config.headers ? encryptJsonField(config.headers) : null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
    }
  }

  async deleteMcpServer(name: string): Promise<void> {
    const schema = this.schema();
    await this.db().delete(schema.mcpServers).where(eq(schema.mcpServers.name, name));
  }

  // ─── System Settings ─────────────────────────────────────────────

  async getSetting<T>(key: string, defaultValue: T): Promise<T> {
    const schema = this.schema();
    const rows = await this.db()
      .select()
      .from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, key))
      .limit(1);

    if (rows.length === 0) return defaultValue;

    const raw = rows[0]!.value;
    const wrapper = parseJson<{ value: T }>(raw);

    // New format: {"value": <actual value>}
    if (wrapper !== null && typeof wrapper === 'object' && 'value' in wrapper) {
      return (wrapper as { value: T }).value ?? defaultValue;
    }

    // Legacy format: bare primitive or object stored directly (pre-wrapper migration).
    // Re-save in new format so subsequent reads work correctly.
    const legacy = parseJson<T>(raw);
    if (legacy !== null) {
      await this.setSetting(key, legacy);
      return legacy;
    }

    return defaultValue;
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    const schema = this.schema();
    const timestamp = now();
    const wrapped = toJson({ value });

    const existing = await this.db()
      .select()
      .from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, key))
      .limit(1);

    if (existing.length > 0) {
      await this.db()
        .update(schema.systemSettings)
        .set({ value: wrapped, updatedAt: timestamp })
        .where(eq(schema.systemSettings.key, key));
    } else {
      await this.db().insert(schema.systemSettings).values({
        key,
        value: wrapped,
        updatedAt: timestamp,
      });
    }
  }

  async setSettingsBulk(entries: Record<string, unknown>): Promise<void> {
    const schema = this.schema();
    const timestamp = now();

    await this.db().transaction(async (tx) => {
      for (const [key, value] of Object.entries(entries)) {
        const wrapped = toJson({ value });
        const existing = await tx
          .select()
          .from(schema.systemSettings)
          .where(eq(schema.systemSettings.key, key))
          .limit(1);

        if (existing.length > 0) {
          await tx
            .update(schema.systemSettings)
            .set({ value: wrapped, updatedAt: timestamp })
            .where(eq(schema.systemSettings.key, key));
        } else {
          await tx.insert(schema.systemSettings).values({
            key,
            value: wrapped,
            updatedAt: timestamp,
          });
        }
      }
    });
  }

  async getAllSettings(): Promise<Record<string, unknown>> {
    const schema = this.schema();
    const rows = await this.db().select().from(schema.systemSettings);
    const result: Record<string, unknown> = {};
    for (const row of rows) {
      const wrapper = parseJson<{ value: unknown }>(row.value);
      result[row.key] =
        wrapper !== null && typeof wrapper === 'object' && 'value' in wrapper
          ? wrapper.value
          : parseJson(row.value); // fallback for legacy unwrapped rows
    }
    return result;
  }

  async getFailoverPolicy(): Promise<FailoverPolicy> {
    const enabled = await this.getSetting<boolean>('failover.enabled', true);
    const retryableStatusCodes = await this.getSetting<number[]>(
      'failover.retryableStatusCodes',
      Array.from({ length: 500 }, (_, i) => i + 100).filter(
        (c) => !(c >= 200 && c <= 299) && c !== 413 && c !== 422
      )
    );
    const retryableErrors = await this.getSetting<string[]>('failover.retryableErrors', [
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ENOTFOUND',
    ]);

    return { enabled, retryableStatusCodes, retryableErrors };
  }

  async getCooldownPolicy(): Promise<CooldownPolicy> {
    const initialMinutes = await this.getSetting<number>('cooldown.initialMinutes', 2);
    const maxMinutes = await this.getSetting<number>('cooldown.maxMinutes', 300);
    return { initialMinutes, maxMinutes };
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

  // ─── Utility ─────────────────────────────────────────────────────

  /**
   * Returns true only when the DB has never been successfully bootstrapped.
   * Uses a persistent 'system.bootstrapped' flag in system_settings so that
   * an admin deliberately deleting all providers does NOT re-trigger a YAML
   * import on the next restart.
   */
  async isFirstLaunch(): Promise<boolean> {
    const bootstrapped = await this.getSetting<boolean>('system.bootstrapped', false);
    return !bootstrapped;
  }

  async markBootstrapped(): Promise<void> {
    await this.setSetting('system.bootstrapped', true);
  }
}
