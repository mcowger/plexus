import { and, eq, isNotNull } from 'drizzle-orm';
import { getDatabase, getSchema } from './client';
import { McpOauthRepository } from './mcp-oauth-repository';
import { decrypt, encrypt, hashSecret } from '../utils/encryption';
import { logger } from '../utils/logger';
import type { KeyConfig } from '../config';
import {
  fromBool,
  now,
  parseJson,
  parseStringArray,
  quotasFromRow,
  stringifyQuotaNames,
  stringifyStringArray,
  toBool,
  toJson,
} from './repository-utils';
import { SERVICE_TIER_SUFFIXES } from '../services/routing/service-tier-suffix';

/**
 * Read the per-key default service tier out of the api_keys.generation JSON
 * column (`{ serviceTier }`). Tolerates SQLite JSON text and Postgres jsonb.
 * Raw backup imports can bypass KeyConfigSchema, so values are trimmed,
 * lower-cased, and validated against the known suffix vocabulary. Missing,
 * empty, or unrecognised values return undefined so callers omit the field.
 */
function defaultServiceTierFromGeneration(generation: unknown): KeyConfig['defaultServiceTier'] {
  const parsed = parseJson<{ serviceTier?: unknown }>(generation);
  const tier = parsed?.serviceTier;
  if (typeof tier !== 'string') return undefined;
  const normalized = tier.trim().toLowerCase();
  if (!(SERVICE_TIER_SUFFIXES as readonly string[]).includes(normalized)) return undefined;
  return normalized as KeyConfig['defaultServiceTier'];
}

export class KeyRepository {
  private db() {
    return getDatabase();
  }

  private schema() {
    return getSchema();
  }
  // ─── API Keys ────────────────────────────────────────────────────

  async getAllKeys(): Promise<Record<string, KeyConfig>> {
    const schema = this.schema();
    const rows = await this.db().select().from(schema.apiKeys);
    const result: Record<string, KeyConfig> = {};

    for (const row of rows) {
      const allowedModels = parseStringArray(row.allowedModels);
      const allowedProviders = parseStringArray(row.allowedProviders);
      const excludedModels = parseStringArray(row.excludedModels);
      const excludedProviders = parseStringArray(row.excludedProviders);
      const allowedIps = parseStringArray(row.allowedIps);
      const quotas = quotasFromRow(row);
      const defaultServiceTier = defaultServiceTierFromGeneration(row.generation);

      result[row.name] = {
        secret: decrypt(row.secret),
        ...(row.comment ? { comment: row.comment } : {}),
        ...(row.expiresAt != null ? { expiresAt: row.expiresAt } : {}),
        ...(row.disabledAt != null ? { disabledAt: row.disabledAt } : {}),
        ...(quotas !== undefined ? { quotas } : {}),
        ...(allowedModels ? { allowedModels } : {}),
        ...(allowedProviders ? { allowedProviders } : {}),
        ...(excludedModels ? { excludedModels } : {}),
        ...(excludedProviders ? { excludedProviders } : {}),
        allowRawPassthrough: toBool(row.allowRawPassthrough),
        ...(allowedIps ? { allowedIps } : {}),
        ...(defaultServiceTier ? { defaultServiceTier } : {}),
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
    const allowedModels = parseStringArray(row.allowedModels);
    const allowedProviders = parseStringArray(row.allowedProviders);
    const excludedModels = parseStringArray(row.excludedModels);
    const excludedProviders = parseStringArray(row.excludedProviders);
    const allowedIps = parseStringArray(row.allowedIps);
    const quotas = quotasFromRow(row);
    const defaultServiceTier = defaultServiceTierFromGeneration(row.generation);

    return {
      name: row.name,
      config: {
        secret: decrypt(row.secret),
        ...(row.comment ? { comment: row.comment } : {}),
        ...(row.expiresAt != null ? { expiresAt: row.expiresAt } : {}),
        ...(row.disabledAt != null ? { disabledAt: row.disabledAt } : {}),
        ...(quotas !== undefined ? { quotas } : {}),
        ...(allowedModels ? { allowedModels } : {}),
        ...(allowedProviders ? { allowedProviders } : {}),
        ...(excludedModels ? { excludedModels } : {}),
        ...(excludedProviders ? { excludedProviders } : {}),
        allowRawPassthrough: toBool(row.allowRawPassthrough),
        ...(allowedIps ? { allowedIps } : {}),
        ...(defaultServiceTier ? { defaultServiceTier } : {}),
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
    const existingKey = existing[0];

    const keyData = {
      name,
      secret: encryptedSecret,
      secretHash,
      comment: config.comment ?? null,
      // quota_names only — quota_name (legacy) is never written here so
      // pre-migration rows keep their fallback value untouched. Writes
      // '[]' (not NULL) when config.quotas is a defined empty array —
      // see stringifyQuotaNames.
      quotaNames: stringifyQuotaNames(config.quotas),
      allowedModels: stringifyStringArray(config.allowedModels),
      allowedProviders: stringifyStringArray(config.allowedProviders),
      excludedModels: stringifyStringArray(config.excludedModels),
      excludedProviders: stringifyStringArray(config.excludedProviders),
      allowRawPassthrough: fromBool(config.allowRawPassthrough === true),
      allowedIps: stringifyStringArray(config.allowedIps),
      // Per-key default service tier lives in the generation JSON. A PUT that
      // omits `defaultServiceTier` clears any stored default (null); callers
      // that want to preserve it (PATCH) merge the existing config first.
      generation: config.defaultServiceTier
        ? toJson({ serviceTier: config.defaultServiceTier })
        : null,
      expiresAt: existingKey
        ? existingKey.expiresAt
        : config.expiresInMinutes
          ? timestamp + config.expiresInMinutes * 60_000
          : null,
      disabledAt: existingKey?.disabledAt ?? null,
      updatedAt: timestamp,
    };

    if (existing.length > 0) {
      const existingSecretHash =
        existing[0]!.secretHash ?? hashSecret(decrypt(existing[0]!.secret));
      if (existingSecretHash && existingSecretHash !== secretHash) {
        await new McpOauthRepository().revokeTokensForKeyName(name);
      }

      await this.db().update(schema.apiKeys).set(keyData).where(eq(schema.apiKeys.name, name));
    } else {
      await this.db()
        .insert(schema.apiKeys)
        .values({ ...keyData, createdAt: timestamp });
    }
  }

  async deleteKey(name: string): Promise<void> {
    const schema = this.schema();
    await new McpOauthRepository().revokeTokensForKeyName(name);
    await this.db().delete(schema.apiKeys).where(eq(schema.apiKeys.name, name));
  }

  async disableTimeBoundKey(name: string): Promise<boolean> {
    const schema = this.schema();
    const timestamp = now();
    const result = await this.db()
      .update(schema.apiKeys)
      .set({ disabledAt: timestamp, updatedAt: timestamp })
      .where(and(eq(schema.apiKeys.name, name), isNotNull(schema.apiKeys.expiresAt)));
    const resultMetadata = result as unknown as {
      rowsAffected?: unknown;
      changes?: unknown;
      rowCount?: unknown;
    };
    const affected =
      resultMetadata.rowsAffected ?? resultMetadata.changes ?? resultMetadata.rowCount ?? 0;
    return Number(affected) > 0;
  }
}
