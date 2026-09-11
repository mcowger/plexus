import { eq, inArray, sql } from 'drizzle-orm';
import { getCurrentDialect, getDatabase, getSchema } from './client';
import type { MetadataOverrides, ModelConfig, ModelTargetGroup, SelectorType } from '../config';
import {
  fromBool,
  hasAnyOverrideField,
  now,
  overrideRowToOverrides,
  parseJson,
  toBool,
  toJson,
} from './repository-utils';

interface AliasQuery<T> extends PromiseLike<T> {
  from(...args: unknown[]): AliasQuery<T>;
  where(...args: unknown[]): AliasQuery<T>;
  limit(...args: unknown[]): AliasQuery<T>;
  orderBy(...args: unknown[]): AliasQuery<T>;
}

interface AliasMutation extends PromiseLike<unknown> {
  set(...args: unknown[]): AliasMutation;
  values(...args: unknown[]): AliasMutation;
  where(...args: unknown[]): AliasMutation;
  returning(...args: unknown[]): PromiseLike<unknown[]>;
}

interface AliasTransaction {
  select(...args: unknown[]): AliasQuery<unknown[]>;
  insert(...args: unknown[]): AliasMutation;
  update(...args: unknown[]): AliasMutation;
  delete(...args: unknown[]): AliasMutation;
}

interface AliasRow {
  id: number;
  slug: string;
  selector: string | null;
  priority: string | null;
  modelType: string | null;
  additionalAliases: unknown;
  advanced: unknown;
  metadataSource: string | null;
  metadataSourcePath: string | null;
  useImageFallthrough: unknown;
  modelArchitecture: unknown;
  enforceLimits: unknown;
  stickySession: unknown;
  preferredApi: unknown;
  piModel: unknown;
  targetGroups: unknown;
  extraBody: unknown;
  generation: unknown;
  compaction: unknown;
  createdAt: number;
  updatedAt: number;
}

interface AliasTargetRow {
  id: number;
  aliasId: number;
  providerSlug: string | null;
  modelName: string | null;
  targetAliasSlug: string | null;
  enabled: unknown;
  groupName: string | null;
  sortOrder: number;
}

interface AliasMetadataOverrideRow {
  id: number;
  aliasId: number;
  name: string | null;
  description: string | null;
  contextLength: number | null;
  pricingPrompt: string | null;
  pricingCompletion: string | null;
  pricingInputCacheRead: string | null;
  pricingInputCacheWrite: string | null;
  architectureInputModalities: unknown;
  architectureOutputModalities: unknown;
  architectureTokenizer: string | null;
  supportedParameters: unknown;
  topProviderContextLength: number | null;
  topProviderMaxCompletionTokens: number | null;
  updatedAt: number;
}

export class AliasRepository {
  private db() {
    return getDatabase();
  }

  private schema() {
    return getSchema();
  }

  async getAllAliases(): Promise<Record<string, ModelConfig>> {
    const schema = this.schema();
    const rows = (await this.db().select().from(schema.modelAliases)) as AliasRow[];
    const result: Record<string, ModelConfig> = {};

    if (rows.length === 0) return result;

    const aliasIds = rows.map((row) => row.id);

    // Batch-fetch targets and override rows in parallel, keyed by aliasId —
    // avoids the 1+2N round-trips a per-alias loop would incur.
    const [allTargets, allOverrides] = await Promise.all([
      this.db()
        .select()
        .from(schema.modelAliasTargets)
        .where(inArray(schema.modelAliasTargets.aliasId, aliasIds))
        .orderBy(schema.modelAliasTargets.sortOrder) as Promise<AliasTargetRow[]>,
      this.db()
        .select()
        .from(schema.aliasMetadataOverrides)
        .where(inArray(schema.aliasMetadataOverrides.aliasId, aliasIds)) as Promise<
        AliasMetadataOverrideRow[]
      >,
    ]);

    const targetsByAliasId = new Map<number, AliasTargetRow[]>();
    for (const target of allTargets) {
      const list = targetsByAliasId.get(target.aliasId);
      if (list) list.push(target);
      else targetsByAliasId.set(target.aliasId, [target]);
    }

    const overrideByAliasId = new Map<number, AliasMetadataOverrideRow>();
    for (const override of allOverrides) overrideByAliasId.set(override.aliasId, override);

    for (const row of rows) {
      const targets = targetsByAliasId.get(row.id) ?? [];
      const overrideRow = overrideByAliasId.get(row.id) ?? null;
      result[row.slug] = this.rowToModelConfig(row, targets, overrideRow);
    }

    return result;
  }

  async getAlias(slug: string): Promise<ModelConfig | null> {
    const schema = this.schema();
    const rows = (await this.db()
      .select()
      .from(schema.modelAliases)
      .where(eq(schema.modelAliases.slug, slug))
      .limit(1)) as AliasRow[];

    if (rows.length === 0) return null;

    const row = rows[0]!;
    const targets = (await this.db()
      .select()
      .from(schema.modelAliasTargets)
      .where(eq(schema.modelAliasTargets.aliasId, row.id))
      .orderBy(schema.modelAliasTargets.sortOrder)) as AliasTargetRow[];

    const overrideRow = await this.getMetadataOverrideRow(row.id);
    return this.rowToModelConfig(row, targets, overrideRow);
  }

  private async getMetadataOverrideRow(aliasId: number): Promise<AliasMetadataOverrideRow | null> {
    const schema = this.schema();
    const rows = (await this.db()
      .select()
      .from(schema.aliasMetadataOverrides)
      .where(eq(schema.aliasMetadataOverrides.aliasId, aliasId))
      .limit(1)) as AliasMetadataOverrideRow[];
    return rows.length > 0 ? rows[0]! : null;
  }

  /**
   * One-time startup migration: rewrite legacy aliases that have no targetGroups
   * into the grouped format. Operates at raw row level so no application code
   * needs to understand the legacy layout.
   *
   * TODO(#target-groups-cleanup): remove this whole method after migration period.
   */
  async migrateLegacyTargetGroups(): Promise<string[]> {
    const schema = this.schema();

    // Find aliases that have not yet been migrated
    const legacyAliases = (await this.db()
      .select()
      .from(schema.modelAliases)
      .where(sql`${schema.modelAliases.targetGroups} IS NULL`)) as AliasRow[];

    const migrated: string[] = [];

    for (const row of legacyAliases) {
      const targets = (await this.db()
        .select()
        .from(schema.modelAliasTargets)
        .where(eq(schema.modelAliasTargets.aliasId, row.id))) as AliasTargetRow[];

      const selector = row.selector ?? 'random';

      // Write group definition to alias row
      await this.db()
        .update(schema.modelAliases)
        .set({
          targetGroups: toJson([{ name: 'default', selector }]),
          updatedAt: now(),
        })
        .where(eq(schema.modelAliases.id, row.id));

      // Tag all targets with the default group name
      if (targets.length > 0) {
        await this.db()
          .update(schema.modelAliasTargets)
          .set({ groupName: 'default' })
          .where(eq(schema.modelAliasTargets.aliasId, row.id));
      }

      migrated.push(row.slug);
    }

    return migrated;
  }

  /**
   * One-time startup migration: rewrite legacy model_type values to the
   * canonical 'text' capability type.
   *
   * - 'chat'      → 'text'  (was overloaded to mean both wire protocol and capability)
   * - 'responses' → 'text'  (was incorrectly stored as a capability type)
   * - null / other values are left untouched.
   *
   * Idempotent: rows already set to 'text' (or any other valid value) are unaffected.
   */
  async migrateModelTypes(): Promise<number> {
    const schema = this.schema();
    const updateResult = await this.db()
      .update(schema.modelAliases)
      .set({ modelType: 'text', updatedAt: now() })
      .where(sql`${schema.modelAliases.modelType} IN ('chat', 'responses')`);
    // Both SQLite (bun) and postgres-js drivers expose rowCount/changes on the result
    const result = updateResult as {
      rowsAffected?: number;
      changes?: number;
      rowCount?: number;
    };
    const affected = result.rowsAffected ?? result.changes ?? result.rowCount ?? 0;
    return Number(affected);
  }

  /**
   * One-time startup repair for databases corrupted by the buggy
   * `model_alias_targets` table-recreation migration (alias-as-fallback-target).
   *
   * Background: the generated SQLite migration added the `target_alias_slug`
   * column in the same table-recreation step that dropped NOT NULL on
   * `provider_slug`/`model_name`. drizzle-kit's `INSERT ... SELECT` referenced
   * the new column name on the source table, where it did not exist. Under
   * SQLite's double-quoted-string misfeature that identifier was silently
   * treated as a **string literal**, so every pre-existing concrete target row
   * ended up with `target_alias_slug = 'target_alias_slug'` instead of NULL.
   * On load, `rowToModelConfig` then mistook each concrete target for an
   * alias-reference, discarding its provider/model — breaking every alias.
   *
   * This nulls the corrupt literal value, but ONLY for rows that still carry a
   * concrete provider+model (the signature of a corrupted concrete target, not
   * a legitimate fallback-alias reference). It is idempotent: a second run finds
   * nothing to fix.
   *
   * Returns the number of rows repaired.
   */
  async repairCorruptedAliasFallbackSlugs(): Promise<number> {
    const schema = this.schema();
    // Guard: only run when the column exists (it always does post-migration,
    // but this keeps the repair a no-op on schemas that pre-date the feature).
    const hasTargetAliasSlugColumn = await this.hasColumn(
      'model_alias_targets',
      'target_alias_slug'
    );
    if (!hasTargetAliasSlugColumn) return 0;

    const updateResult = await this.db()
      .update(schema.modelAliasTargets)
      .set({ targetAliasSlug: null })
      .where(
        sql`${schema.modelAliasTargets.targetAliasSlug} = 'target_alias_slug'
          AND ${schema.modelAliasTargets.providerSlug} IS NOT NULL
          AND ${schema.modelAliasTargets.modelName} IS NOT NULL`
      );
    const result = updateResult as {
      rowsAffected?: number;
      changes?: number;
      rowCount?: number;
    };
    const affected = result.rowsAffected ?? result.changes ?? result.rowCount ?? 0;
    return Number(affected);
  }

  /**
   * Best-effort check for whether a column exists on a table. Returns true if
   * the column is present (or introspection is unavailable), so callers can
   * degrade safely to "column exists" rather than failing startup.
   */
  private async hasColumn(table: string, column: string): Promise<boolean> {
    const dialect = getCurrentDialect();
    try {
      if (dialect === 'sqlite') {
        const rows = (await this.db().all(sql`PRAGMA table_info(${sql.raw(table)})`)) as Array<{
          name?: string;
        }>;
        return rows.some((row) => row.name === column);
      }
      // Postgres was never affected (its migration used ALTER COLUMN), but keep
      // the guard symmetric.
      const rows = (await this.db().all(sql`
        SELECT column_name AS name
        FROM information_schema.columns
        WHERE table_name = ${table} AND column_name = ${column}
      `)) as Array<{ name?: string }>;
      return rows.length > 0;
    } catch {
      // If introspection fails, assume the column exists so we don't block
      // startup; the UPDATE simply matches nothing on affected rows.
      return true;
    }
  }

  async saveAlias(slug: string, config: ModelConfig): Promise<void> {
    const schema = this.schema();
    const timestamp = now();
    const metadataSourcePath =
      config.metadata && 'source_path' in config.metadata ? config.metadata.source_path : undefined;

    const aliasData = {
      slug,
      selector: config.selector ?? null,
      priority: config.priority ?? 'selector',
      modelType: config.type ?? null,
      additionalAliases: config.additional_aliases ? toJson(config.additional_aliases) : null,
      advanced: config.advanced ? toJson(config.advanced) : null,
      metadataSource: config.metadata?.source ?? null,
      metadataSourcePath: metadataSourcePath ?? null,
      useImageFallthrough: fromBool(config.use_image_fallthrough === true),
      modelArchitecture: null,
      enforceLimits: fromBool(config.enforce_limits === true),
      stickySession: fromBool(config.sticky_session === true),
      preferredApi: config.preferred_api ? toJson(config.preferred_api) : null,
      piModel: config.pi_model ? toJson(config.pi_model) : null,
      extraBody: config.extraBody ? toJson(config.extraBody) : null,
      generation: null,
      compaction: config.compaction ? toJson(config.compaction) : null,
      targetGroups:
        config.target_groups && config.target_groups.length > 0
          ? toJson(
              config.target_groups.map((group) => ({ name: group.name, selector: group.selector }))
            )
          : null,
      updatedAt: timestamp,
    };

    // Wrap the whole save — alias upsert, target replace, override replace —
    // in one transaction so partial failures don't leave the row inconsistent.
    await this.db().transaction(async (rawTransaction: unknown) => {
      const transaction = rawTransaction as AliasTransaction;
      const existing = (await transaction
        .select()
        .from(schema.modelAliases)
        .where(eq(schema.modelAliases.slug, slug))
        .limit(1)) as AliasRow[];

      let aliasId: number;

      if (existing.length > 0) {
        aliasId = existing[0]!.id;
        await transaction
          .update(schema.modelAliases)
          .set(aliasData)
          .where(eq(schema.modelAliases.id, aliasId));
      } else {
        const inserted = (await transaction
          .insert(schema.modelAliases)
          .values({ ...aliasData, createdAt: timestamp })
          .returning({ id: schema.modelAliases.id })) as Array<{ id: number }>;
        aliasId = inserted[0]!.id;
      }

      // Replace targets
      await transaction
        .delete(schema.modelAliasTargets)
        .where(eq(schema.modelAliasTargets.aliasId, aliasId));

      if (config.target_groups && config.target_groups.length > 0) {
        let sortIdx = 0;
        const targetRows: Array<{
          aliasId: number;
          providerSlug: string | null | undefined;
          modelName: string | null | undefined;
          targetAliasSlug: string | null;
          enabled: number | boolean;
          groupName: string;
          sortOrder: number;
        }> = [];
        for (const group of config.target_groups) {
          for (const target of group.targets) {
            targetRows.push({
              aliasId,
              providerSlug: target.alias ? null : target.provider,
              modelName: target.alias ? null : target.model,
              targetAliasSlug: target.alias ?? null,
              enabled: fromBool(target.enabled !== false),
              groupName: group.name,
              sortOrder: sortIdx++,
            });
          }
        }
        if (targetRows.length > 0) {
          await transaction.insert(schema.modelAliasTargets).values(targetRows);
        }
      }

      // Replace metadata overrides
      await transaction
        .delete(schema.aliasMetadataOverrides)
        .where(eq(schema.aliasMetadataOverrides.aliasId, aliasId));

      const overrides =
        config.metadata && 'overrides' in config.metadata ? config.metadata.overrides : undefined;
      if (overrides && hasAnyOverrideField(overrides)) {
        await transaction.insert(schema.aliasMetadataOverrides).values({
          aliasId,
          name: overrides.name ?? null,
          description: overrides.description ?? null,
          contextLength: overrides.context_length ?? null,
          pricingPrompt: overrides.pricing?.prompt ?? null,
          pricingCompletion: overrides.pricing?.completion ?? null,
          pricingInputCacheRead: overrides.pricing?.input_cache_read ?? null,
          pricingInputCacheWrite: overrides.pricing?.input_cache_write ?? null,
          architectureInputModalities: overrides.architecture?.input_modalities
            ? toJson(overrides.architecture.input_modalities)
            : null,
          architectureOutputModalities: overrides.architecture?.output_modalities
            ? toJson(overrides.architecture.output_modalities)
            : null,
          architectureTokenizer: overrides.architecture?.tokenizer ?? null,
          supportedParameters: overrides.supported_parameters
            ? toJson(overrides.supported_parameters)
            : null,
          topProviderContextLength: overrides.top_provider?.context_length ?? null,
          topProviderMaxCompletionTokens: overrides.top_provider?.max_completion_tokens ?? null,
          updatedAt: timestamp,
        });
      }
    });
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

  private rowToModelConfig(
    row: AliasRow,
    targetRows: AliasTargetRow[],
    overrideRow?: AliasMetadataOverrideRow | null
  ): ModelConfig {
    const groupDefs = parseJson<Array<{ name: string; selector: string }>>(row.targetGroups);

    // build target_groups from group definitions + target rows
    const targetGroups: ModelTargetGroup[] = [];
    if (groupDefs && groupDefs.length > 0) {
      for (const definition of groupDefs) {
        const groupTargets = targetRows
          .filter((target) => target.groupName === definition.name)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((target) =>
            target.targetAliasSlug
              ? { alias: target.targetAliasSlug, enabled: toBool(target.enabled) }
              : {
                  provider: target.providerSlug!,
                  model: target.modelName!,
                  enabled: toBool(target.enabled),
                }
          );
        targetGroups.push({
          name: definition.name,
          selector: definition.selector as SelectorType,
          targets: groupTargets,
        });
      }
    }

    const result: Record<string, unknown> = {
      target_groups: targetGroups,
      priority: row.priority ?? 'selector',
      use_image_fallthrough: toBool(row.useImageFallthrough),
      enforce_limits: toBool(row.enforceLimits),
      sticky_session: toBool(row.stickySession),
      ...(row.selector ? { selector: row.selector } : {}),
      ...(row.modelType ? { type: row.modelType } : {}),
      ...(row.additionalAliases ? { additional_aliases: parseJson(row.additionalAliases) } : {}),
      ...(row.advanced ? { advanced: parseJson(row.advanced) } : {}),
      ...(row.preferredApi ? { preferred_api: parseJson(row.preferredApi) } : {}),
      ...(row.piModel ? { pi_model: parseJson(row.piModel) } : {}),
      ...(row.extraBody ? { extraBody: parseJson(row.extraBody) } : {}),
      ...(row.compaction ? { compaction: parseJson(row.compaction) } : {}),
    };

    if (row.metadataSource) {
      const overrides: MetadataOverrides | undefined = overrideRow
        ? overrideRowToOverrides(overrideRow)
        : undefined;
      if (row.metadataSource === 'disabled') {
        result.metadata = { source: 'disabled' };
      } else if (row.metadataSource === 'auto') {
        result.metadata = {
          source: 'auto',
          ...(overrides && Object.keys(overrides).length > 0 ? { overrides } : {}),
        };
      } else if (row.metadataSource === 'custom') {
        // Custom sources always carry overrides (possibly empty if no row found).
        result.metadata = {
          source: 'custom',
          ...(row.metadataSourcePath ? { source_path: row.metadataSourcePath } : {}),
          overrides: overrides ?? {},
        };
      } else {
        result.metadata = {
          source: row.metadataSource,
          source_path: row.metadataSourcePath,
          ...(overrides && Object.keys(overrides).length > 0 ? { overrides } : {}),
        };
      }
    }

    return result as ModelConfig;
  }
}
