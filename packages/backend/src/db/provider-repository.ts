import { and, eq } from 'drizzle-orm';
import { getDatabase, getSchema } from './client';
import { decryptField, encryptField } from '../utils/encryption';
import type { ModelProviderConfig, ProviderConfig } from '../config';
import {
  decryptJsonField,
  encryptJsonField,
  fromBool,
  normalizeAdapterEntries,
  now,
  parseJson,
  toBool,
  toJson,
} from './repository-utils';

type ProviderRow = {
  id: number;
  slug: string;
  displayName: string | null;
  apiBaseUrl: unknown;
  apiKey: string | null;
  oauthProviderType: string | null;
  oauthCredentialId: number | null;
  enabled: unknown;
  disableCooldown: unknown;
  stallCooldown: unknown;
  allow100PercentUtilization: unknown;
  discount: number | null;
  estimateTokens: unknown;
  useClaudeMasking: unknown;
  geminiThinkingEnabled: unknown;
  headers: unknown;
  extraBody: unknown;
  compaction: unknown;
  quotaCheckerType: string | null;
  quotaCheckerId: string | null;
  quotaCheckerEnabled: unknown;
  quotaCheckerInterval: number;
  quotaCheckerOptions: unknown;
  modelAutosyncEnabled: unknown;
  modelAutosyncInterval: number | null;
  adapter: unknown;
  autoCompat: unknown;
  timeoutMs: number | null;
  maxConcurrency: number | null;
  piAiProvider: string | null;
  rawPassthrough: unknown;
  stallTtfbMs: number | null;
  stallTtfbBytes: number | null;
  stallMinBps: number | null;
  stallWindowMs: number | null;
  stallGracePeriodMs: number | null;
  createdAt: number;
  updatedAt: number;
};

type ProviderModelRow = {
  id: number;
  providerId: number;
  modelName: string;
  pricingConfig: unknown;
  modelType: string | null;
  accessVia: unknown;
  extraBody: unknown;
  adapter: unknown;
  autoCompat: unknown;
  maxConcurrency: number | null;
  piAiModelId: string | null;
  sortOrder: number;
};

export class ProviderRepository {
  private db() {
    return getDatabase();
  }

  private schema() {
    return getSchema();
  }

  async getAllProviders(): Promise<Record<string, ProviderConfig>> {
    const schema = this.schema();
    const rows = (await this.db().select().from(schema.providers)) as ProviderRow[];
    const result: Record<string, ProviderConfig> = {};

    for (const row of rows) {
      const models = (await this.db()
        .select()
        .from(schema.providerModels)
        .where(eq(schema.providerModels.providerId, row.id))
        .orderBy(schema.providerModels.sortOrder)) as ProviderModelRow[];

      let oauthAccountId: string | undefined;
      if (row.oauthCredentialId) {
        const creds = (await this.db()
          .select({ accountId: schema.oauthCredentials.accountId })
          .from(schema.oauthCredentials)
          .where(eq(schema.oauthCredentials.id, row.oauthCredentialId))
          .limit(1)) as Array<{ accountId: string }>;
        if (creds.length > 0) oauthAccountId = creds[0]!.accountId;
      }
      result[row.slug] = this.rowToProviderConfig(row, models, oauthAccountId);
    }

    return result;
  }

  async getProvider(slug: string): Promise<ProviderConfig | null> {
    const schema = this.schema();
    const rows = (await this.db()
      .select()
      .from(schema.providers)
      .where(eq(schema.providers.slug, slug))
      .limit(1)) as ProviderRow[];

    if (rows.length === 0) return null;

    const row = rows[0]!;
    const models = (await this.db()
      .select()
      .from(schema.providerModels)
      .where(eq(schema.providerModels.providerId, row.id))
      .orderBy(schema.providerModels.sortOrder)) as ProviderModelRow[];

    let oauthAccountId: string | undefined;
    if (row.oauthCredentialId) {
      const creds = (await this.db()
        .select({ accountId: schema.oauthCredentials.accountId })
        .from(schema.oauthCredentials)
        .where(eq(schema.oauthCredentials.id, row.oauthCredentialId))
        .limit(1)) as Array<{ accountId: string }>;
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
      stallCooldown: fromBool(config.stall_cooldown === true),
      allow100PercentUtilization: fromBool(config.allow_100_percent_utilization === true),
      discount: config.discount ?? null,
      estimateTokens: fromBool(config.estimateTokens === true),
      useClaudeMasking: fromBool(config.useClaudeMasking === true),
      geminiThinkingEnabled: fromBool(config.geminiThinkingEnabled === true),
      headers: config.headers ? encryptJsonField(config.headers) : null,
      extraBody: config.extraBody ? toJson(config.extraBody) : null,
      compaction: config.compaction ? toJson(config.compaction) : null,
      quotaCheckerType: config.quota_checker?.type ?? null,
      quotaCheckerId: config.quota_checker?.id ?? null,
      quotaCheckerEnabled: fromBool(config.quota_checker?.enabled !== false),
      quotaCheckerInterval: config.quota_checker?.intervalMinutes ?? 30,
      quotaCheckerOptions: config.quota_checker?.options
        ? encryptJsonField(config.quota_checker.options)
        : null,
      modelAutosyncEnabled: fromBool(config.model_autosync?.enabled === true),
      modelAutosyncInterval: Math.max(1, config.model_autosync?.intervalMinutes ?? 60),
      gpuProfile: null,
      gpuRamGb: null,
      gpuBandwidthTbS: null,
      gpuFlopsTflop: null,
      gpuPowerDrawWatts: null,
      adapter:
        config.adapter && Array.isArray(config.adapter) && config.adapter.length > 0
          ? toJson(config.adapter)
          : null,
      autoCompat: fromBool(config.auto_compat === true),
      timeoutMs: config.timeoutMs ?? null,
      maxConcurrency: config.maxConcurrency ?? null,
      piAiProvider: config.pi_ai_provider ?? null,
      rawPassthrough: config.raw_passthrough ? toJson(config.raw_passthrough) : null,
      // Per-provider stall detection overrides
      stallTtfbMs: config.stallTtfbMs ?? null,
      stallTtfbBytes: config.stallTtfbBytes ?? null,
      stallMinBps: config.stallMinBps ?? null,
      stallWindowMs: config.stallWindowMs ?? null,
      stallGracePeriodMs: config.stallGracePeriodMs ?? null,
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
          adapter:
            cfg.adapter && Array.isArray(cfg.adapter) && cfg.adapter.length > 0
              ? toJson(cfg.adapter)
              : null,
          autoCompat: cfg.auto_compat == null ? null : fromBool(cfg.auto_compat === true),
          maxConcurrency: cfg.maxConcurrency ?? null,
          piAiModelId: cfg.pi_ai_model_id ?? null,
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

    const rows = (await this.db()
      .select()
      .from(schema.providerModels)
      .where(eq(schema.providerModels.providerId, provider[0]!.id))
      .orderBy(schema.providerModels.sortOrder)) as ProviderModelRow[];

    return rows.map((r) => ({
      modelName: r.modelName,
      pricingConfig: parseJson(r.pricingConfig),
      modelType: r.modelType,
      accessVia: parseJson<string[]>(r.accessVia),
    }));
  }

  async addMissingProviderModels(providerSlug: string, modelNames: string[]): Promise<number> {
    const schema = this.schema();
    const normalizedNames = Array.from(
      new Set(modelNames.map((name) => name.trim()).filter((name) => name.length > 0))
    );
    if (normalizedNames.length === 0) return 0;

    const provider = await this.db()
      .select()
      .from(schema.providers)
      .where(eq(schema.providers.slug, providerSlug))
      .limit(1);

    if (provider.length === 0) return 0;

    const providerId = provider[0]!.id;
    const existing = (await this.db()
      .select()
      .from(schema.providerModels)
      .where(eq(schema.providerModels.providerId, providerId))
      .orderBy(schema.providerModels.sortOrder)) as ProviderModelRow[];

    const existingNames = new Set(existing.map((row) => row.modelName));
    const missingNames = normalizedNames.filter((name) => !existingNames.has(name));
    if (missingNames.length === 0) return 0;

    const maxSortOrder = existing.reduce(
      (max: number, row) => Math.max(max, row.sortOrder ?? -1),
      -1
    );

    await this.db()
      .insert(schema.providerModels)
      .values(
        missingNames.map((modelName, idx) => ({
          providerId,
          modelName,
          pricingConfig: toJson({ source: 'simple', input: 0, output: 0 }),
          accessVia: toJson([]),
          sortOrder: maxSortOrder + idx + 1,
        }))
      );

    return missingNames.length;
  }

  private rowToProviderConfig(
    row: ProviderRow,
    modelRows: ProviderModelRow[],
    oauthAccountId?: string
  ): ProviderConfig {
    const apiBaseUrl = parseJson<string | Record<string, string>>(row.apiBaseUrl);

    // Reconstruct models
    let models: string[] | Record<string, ModelProviderConfig> | undefined;
    if (modelRows.length > 0) {
      const hasConfig = modelRows.some((m) => m.pricingConfig !== null);
      if (hasConfig) {
        models = {};
        for (const m of modelRows) {
          (models as Record<string, ModelProviderConfig>)[m.modelName] = {
            pricing: parseJson(m.pricingConfig) ?? { source: 'simple', input: 0, output: 0 },
            ...(m.modelType ? { type: m.modelType } : {}),
            ...(m.accessVia ? { access_via: parseJson(m.accessVia) } : {}),
            ...(m.extraBody ? { extraBody: parseJson(m.extraBody) } : {}),
            ...(m.adapter ? { adapter: normalizeAdapterEntries(parseJson(m.adapter)) } : {}),
            ...(m.autoCompat != null ? { auto_compat: toBool(m.autoCompat) } : {}),
            ...(m.maxConcurrency != null ? { maxConcurrency: m.maxConcurrency } : {}),
            ...(m.piAiModelId != null ? { pi_ai_model_id: m.piAiModelId } : {}),
          } as ModelProviderConfig;
        }
      } else {
        models = modelRows.map((m) => m.modelName);
      }
    }

    // Reconstruct quota_checker
    let quota_checker: Record<string, unknown> | undefined;
    if (row.quotaCheckerType) {
      quota_checker = {
        type: row.quotaCheckerType,
        enabled: toBool(row.quotaCheckerEnabled),
        intervalMinutes: row.quotaCheckerInterval,
        ...(row.quotaCheckerId ? { id: row.quotaCheckerId } : {}),
        ...(row.quotaCheckerOptions
          ? {
              options: decryptJsonField<Record<string, unknown>>(row.quotaCheckerOptions) ?? {},
            }
          : {}),
      };
    }

    // Decrypt sensitive fields
    const decryptedApiKey = decryptField(row.apiKey);

    const result: Record<string, unknown> = {
      api_base_url: apiBaseUrl ?? '',
      ...(row.displayName ? { display_name: row.displayName } : {}),
      ...(decryptedApiKey ? { api_key: decryptedApiKey } : {}),
      ...(row.oauthProviderType ? { oauth_provider: row.oauthProviderType } : {}),
      ...(oauthAccountId ? { oauth_account: oauthAccountId } : {}),
      enabled: toBool(row.enabled),
      disable_cooldown: toBool(row.disableCooldown),
      stall_cooldown: toBool(row.stallCooldown),
      allow_100_percent_utilization: toBool(row.allow100PercentUtilization),
      ...(row.discount !== null ? { discount: row.discount } : {}),
      estimateTokens: toBool(row.estimateTokens),
      useClaudeMasking: toBool(row.useClaudeMasking),
      gemini_thinking_enabled: toBool(row.geminiThinkingEnabled),
      auto_compat: toBool(row.autoCompat),
      ...(models ? { models } : {}),
      ...(row.headers ? { headers: decryptJsonField(row.headers) } : {}),
      ...(() => {
        const eb = parseJson<Record<string, unknown>>(row.extraBody);
        return eb && typeof eb === 'object' && !Array.isArray(eb) ? { extraBody: eb } : {};
      })(),
      ...(row.compaction ? { compaction: parseJson(row.compaction) } : {}),
      ...(quota_checker ? { quota_checker } : {}),
      model_autosync: {
        enabled: toBool(row.modelAutosyncEnabled),
        intervalMinutes: Math.max(1, row.modelAutosyncInterval ?? 60),
      },
      ...(() => {
        const adapterVal = parseJson(row.adapter);
        const normalized = normalizeAdapterEntries(adapterVal);
        return normalized && normalized.length > 0 ? { adapter: normalized } : {};
      })(),
      ...(row.timeoutMs != null ? { timeoutMs: row.timeoutMs } : {}),
      ...(row.stallTtfbMs != null ? { stallTtfbMs: row.stallTtfbMs } : {}),
      ...(row.stallTtfbBytes != null ? { stallTtfbBytes: row.stallTtfbBytes } : {}),
      ...(row.stallMinBps != null ? { stallMinBps: row.stallMinBps } : {}),
      ...(row.stallWindowMs != null ? { stallWindowMs: row.stallWindowMs } : {}),
      ...(row.stallGracePeriodMs != null ? { stallGracePeriodMs: row.stallGracePeriodMs } : {}),
      ...(row.maxConcurrency != null ? { maxConcurrency: row.maxConcurrency } : {}),
      ...(row.piAiProvider != null ? { pi_ai_provider: row.piAiProvider } : {}),
      ...(row.rawPassthrough ? { raw_passthrough: parseJson(row.rawPassthrough) } : {}),
    };

    return result as ProviderConfig;
  }
}
