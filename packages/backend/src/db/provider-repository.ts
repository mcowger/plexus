import { and, eq, isNull } from 'drizzle-orm';
import { getDatabase, getSchema } from './client';
import { decryptField, encryptField } from '../utils/encryption';
import type { ModelProviderConfig, ProviderConfig } from '../config';
import { LEGACY_ACCOUNT_ID } from '../services/oauth/oauth-providers';
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
  piAiQuirks: unknown;
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

      const oauthAccountId = await this.resolveOAuthAccountId(row);
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

    const oauthAccountId = await this.resolveOAuthAccountId(row);
    return this.rowToProviderConfig(row, models, oauthAccountId);
  }

  /**
   * Resolve the OAuth account name for a provider row.
   *
   * The account name is persisted only via the credential link, so a provider
   * saved before its OAuth login (or with a name that missed the credential
   * lookup) keeps a null link. When exactly one credential exists for the
   * provider type — the same single account the dispatcher resolves at
   * runtime — hydrate it so the edit form round-trips; the next save
   * re-links the FK. Multiple credentials stay ambiguous and resolve to
   * undefined so the user picks explicitly.
   */
  private async resolveOAuthAccountId(row: ProviderRow): Promise<string | undefined> {
    const schema = this.schema();
    if (row.oauthCredentialId) {
      const creds = (await this.db()
        .select({ accountId: schema.oauthCredentials.accountId })
        .from(schema.oauthCredentials)
        .where(eq(schema.oauthCredentials.id, row.oauthCredentialId))
        .limit(1)) as Array<{ accountId: string }>;
      if (creds.length > 0) return creds[0]!.accountId;
    }
    if (row.oauthProviderType) {
      // Mirror the runtime resolver: the well-known legacy account wins
      // deterministically regardless of how many accounts exist.
      const legacy = (await this.db()
        .select({ accountId: schema.oauthCredentials.accountId })
        .from(schema.oauthCredentials)
        .where(
          and(
            eq(schema.oauthCredentials.oauthProviderType, row.oauthProviderType),
            eq(schema.oauthCredentials.accountId, LEGACY_ACCOUNT_ID)
          )
        )
        .limit(1)) as Array<{ accountId: string }>;
      if (legacy.length > 0) return legacy[0]!.accountId;
      const creds = (await this.db()
        .select({ accountId: schema.oauthCredentials.accountId })
        .from(schema.oauthCredentials)
        .where(eq(schema.oauthCredentials.oauthProviderType, row.oauthProviderType))) as Array<{
        accountId: string;
      }>;
      if (creds.length === 1) return creds[0]!.accountId;
    }
    return undefined;
  }

  async saveProvider(slug: string, config: ProviderConfig): Promise<void> {
    const schema = this.schema();
    const timestamp = now();

    // Single read of the existing row, reused for OAuth link resolution below
    // and the upsert after it.
    const existing = await this.db()
      .select()
      .from(schema.providers)
      .where(eq(schema.providers.slug, slug))
      .limit(1);

    // Resolve oauth_credential_id if this is an OAuth provider. The OAuth
    // account is derived from the provider slug (1:1, set at login from the
    // provider form) — an incoming oauth_account is only honored as a
    // grandfathered fallback for restores/imports that predate slug keying.
    let oauthCredentialId: number | null = null;
    if (config.oauth_provider) {
      oauthCredentialId = await this.findOAuthCredentialId(config.oauth_provider, slug);
      const legacyAccount = config.oauth_account?.trim();
      if (!oauthCredentialId && legacyAccount && legacyAccount !== slug) {
        oauthCredentialId = await this.findOAuthCredentialId(config.oauth_provider, legacyAccount);
      }
      if (!oauthCredentialId && !legacyAccount) {
        oauthCredentialId = await this.findExistingCompatibleCredentialId(
          existing.length > 0 ? existing[0]!.oauthCredentialId : null,
          config.oauth_provider
        );
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
      piAiQuirks: config.pi_ai_quirks ? toJson(config.pi_ai_quirks) : null,
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

  /** Find the credential id for a (provider type, account) pair, if any. */
  private async findOAuthCredentialId(
    providerType: string,
    accountId: string
  ): Promise<number | null> {
    const schema = this.schema();
    const creds = await this.db()
      .select()
      .from(schema.oauthCredentials)
      .where(
        and(
          eq(schema.oauthCredentials.oauthProviderType, providerType),
          eq(schema.oauthCredentials.accountId, accountId)
        )
      )
      .limit(1);
    return creds.length > 0 ? creds[0]!.id : null;
  }

  /**
   * Grandfathered-link preservation, used only when a write carries no usable
   * account at all (an explicit but unresolvable account must not silently
   * retain the old link). Keeps the row's current link when its credential
   * has the same provider type; switching types still drops it.
   */
  private async findExistingCompatibleCredentialId(
    existingCredentialId: number | null,
    providerType: string
  ): Promise<number | null> {
    const schema = this.schema();
    if (!existingCredentialId) return null;
    const creds = (await this.db()
      .select({ providerType: schema.oauthCredentials.oauthProviderType })
      .from(schema.oauthCredentials)
      .where(eq(schema.oauthCredentials.id, existingCredentialId))
      .limit(1)) as Array<{ providerType: string }>;
    if (creds.length === 0 || creds[0]!.providerType !== providerType) return null;
    return existingCredentialId;
  }

  async deleteProvider(
    slug: string,
    cascade: boolean = true
  ): Promise<{ providerType: string; accountId: string } | null> {
    const schema = this.schema();

    // Capture the linked credential before deleting: a credential no other
    // provider references is removed with its provider (1:1); shared
    // grandfathered credentials survive via the refcount below.
    const existing = (await this.db()
      .select({ credentialId: schema.providers.oauthCredentialId })
      .from(schema.providers)
      .where(eq(schema.providers.slug, slug))
      .limit(1)) as Array<{ credentialId: number | null }>;
    const credentialId = existing[0]?.credentialId ?? null;

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

    if (!credentialId) return null;
    const cred = (await this.db()
      .select({
        providerType: schema.oauthCredentials.oauthProviderType,
        accountId: schema.oauthCredentials.accountId,
      })
      .from(schema.oauthCredentials)
      .where(eq(schema.oauthCredentials.id, credentialId))
      .limit(1)) as Array<{ providerType: string; accountId: string }>;
    if (cred.length === 0) return null;
    const holders = (await this.db()
      .select({ id: schema.providers.id })
      .from(schema.providers)
      .where(eq(schema.providers.oauthCredentialId, credentialId))
      .limit(1)) as Array<{ id: number }>;
    // A null-link same-type provider resolves this credential via the
    // single-account fallback, or deterministically when it is the well-known
    // legacy account — but only while it is effectively the sole option.
    // With several non-legacy credentials those providers are already
    // ambiguous and this row is safe to remove.
    let fallbackHolders: Array<{ id: number }> = [];
    if (holders.length === 0) {
      const typeCreds = (await this.db()
        .select({ id: schema.oauthCredentials.id })
        .from(schema.oauthCredentials)
        .where(eq(schema.oauthCredentials.oauthProviderType, cred[0]!.providerType))
        .limit(2)) as Array<{ id: number }>;
      if (typeCreds.length === 1 || cred[0]!.accountId === LEGACY_ACCOUNT_ID) {
        fallbackHolders = (await this.db()
          .select({ id: schema.providers.id })
          .from(schema.providers)
          .where(
            and(
              isNull(schema.providers.oauthCredentialId),
              eq(schema.providers.oauthProviderType, cred[0]!.providerType)
            )
          )
          .limit(1)) as Array<{ id: number }>;
      }
    }
    if (holders.length > 0 || fallbackHolders.length > 0) return null;
    await this.db()
      .delete(schema.oauthCredentials)
      .where(eq(schema.oauthCredentials.id, credentialId));
    return cred[0]!;
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
      ...(row.piAiQuirks != null ? { pi_ai_quirks: parseJson(row.piAiQuirks) } : {}),
      ...(row.rawPassthrough ? { raw_passthrough: parseJson(row.rawPassthrough) } : {}),
    };

    return result as ProviderConfig;
  }
}
