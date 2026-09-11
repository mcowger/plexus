import { eq } from 'drizzle-orm';
import { getDatabase, getSchema } from './client';
import type { QuotaDefinition } from '../config';
import { now, parseStringArray, stringifyStringArray, toBool } from './repository-utils';

export class QuotaRepository {
  private db() {
    return getDatabase();
  }

  private schema() {
    return getSchema();
  }
  // ─── User Quotas ────────────────────────────────────────────────

  async getAllUserQuotas(): Promise<Record<string, QuotaDefinition>> {
    const schema = this.schema();
    const rows = await this.db().select().from(schema.userQuotaDefinitions);
    const result: Record<string, QuotaDefinition> = {};

    for (const row of rows) {
      const allowedModels = parseStringArray(row.allowedModels);
      const allowedProviders = parseStringArray(row.allowedProviders);
      const excludedModels = parseStringArray(row.excludedModels);
      const excludedProviders = parseStringArray(row.excludedProviders);

      result[row.name] = {
        type: row.quotaType as 'rolling' | 'daily' | 'weekly' | 'monthly',
        limitType: row.limitType as 'requests' | 'tokens' | 'cost',
        limit: row.limitValue,
        ...(row.duration ? { duration: row.duration } : {}),
        ...(allowedModels ? { allowedModels } : {}),
        ...(allowedProviders ? { allowedProviders } : {}),
        ...(excludedModels ? { excludedModels } : {}),
        ...(excludedProviders ? { excludedProviders } : {}),
        ...(toBool(row.shared) ? { shared: true } : {}),
        ...(row.warnAt != null ? { warnAt: row.warnAt } : {}),
      } as QuotaDefinition;
    }

    return result;
  }

  async saveUserQuota(name: string, quota: QuotaDefinition): Promise<void> {
    const schema = this.schema();
    const timestamp = now();

    const quotaData = {
      name,
      quotaType: quota.type,
      limitType: quota.limitType,
      limitValue: quota.limit,
      duration: 'duration' in quota ? quota.duration : null,
      allowedModels: stringifyStringArray(quota.allowedModels),
      allowedProviders: stringifyStringArray(quota.allowedProviders),
      excludedModels: stringifyStringArray(quota.excludedModels),
      excludedProviders: stringifyStringArray(quota.excludedProviders),
      shared: quota.shared ?? false,
      warnAt: quota.warnAt ?? null,
      updatedAt: timestamp,
    };

    const existing = await this.db()
      .select()
      .from(schema.userQuotaDefinitions)
      .where(eq(schema.userQuotaDefinitions.name, name))
      .limit(1);

    if (existing.length > 0) {
      await this.db()
        .update(schema.userQuotaDefinitions)
        .set(quotaData)
        .where(eq(schema.userQuotaDefinitions.name, name));
    } else {
      await this.db()
        .insert(schema.userQuotaDefinitions)
        .values({ ...quotaData, createdAt: timestamp });
    }
  }

  async deleteUserQuota(name: string): Promise<void> {
    const schema = this.schema();
    await this.db()
      .delete(schema.userQuotaDefinitions)
      .where(eq(schema.userQuotaDefinitions.name, name));
  }
}
