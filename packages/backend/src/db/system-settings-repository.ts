import { eq } from 'drizzle-orm';
import { getDatabase, getSchema } from './client';
import type {
  BackgroundExplorationConfig,
  CompactionSettingsConfig,
  CooldownPolicy,
  FailoverPolicy,
  McpOAuthConfig,
  StallConfigType,
  TimeoutConfig,
} from '../config';
import { now, parseJson, toJson } from './repository-utils';

export class SystemSettingsRepository {
  private db() {
    return getDatabase();
  }

  private schema() {
    return getSchema();
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
      return wrapper.value ?? defaultValue;
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
    const db = this.db();

    await db.transaction(async (tx: typeof db) => {
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

  async getCaptureTraceOnError(): Promise<boolean> {
    return this.getSetting<boolean>('debug.captureOnError', false);
  }

  async getCooldownPolicy(): Promise<CooldownPolicy> {
    const initialMinutes = await this.getSetting<number>('cooldown.initialMinutes', 2);
    const maxMinutes = await this.getSetting<number>('cooldown.maxMinutes', 300);
    return { initialMinutes, maxMinutes };
  }

  async getTrustedProxies(): Promise<string[]> {
    return this.getSetting<string[]>('trustedProxies', ['0.0.0.0/0', '::/0']);
  }

  async getBackgroundExplorationConfig(): Promise<BackgroundExplorationConfig> {
    const enabled = await this.getSetting<boolean>('backgroundExploration.enabled', false);
    const stalenessThresholdSeconds = await this.getSetting<number>(
      'backgroundExploration.stalenessThresholdSeconds',
      600
    );
    const workerConcurrency = await this.getSetting<number>(
      'backgroundExploration.workerConcurrency',
      2
    );
    return { enabled, stalenessThresholdSeconds, workerConcurrency };
  }

  async getMcpOAuthConfig(): Promise<McpOAuthConfig> {
    const stored = await this.getSetting<Partial<McpOAuthConfig>>('mcpOAuth', {});
    const enabled = stored?.enabled === true;
    const provider = stored?.provider === 'plexus-idp' ? stored.provider : 'plexus-idp';
    return {
      enabled,
      provider,
      ...(typeof stored?.issuer === 'string' && stored.issuer.trim()
        ? { issuer: stored.issuer.trim() }
        : {}),
    };
  }

  async getTimeoutConfig(): Promise<TimeoutConfig> {
    const defaultSeconds = await this.getSetting<number>('timeout.defaultSeconds', 300);
    return { defaultSeconds };
  }

  async getCompactionConfig(): Promise<CompactionSettingsConfig> {
    return this.getSetting('compaction', {});
  }

  async getStallConfig(): Promise<StallConfigType> {
    const ttfbSeconds = await this.getSetting<number | null>('stall.ttfbSeconds', null);
    const ttfbBytes = await this.getSetting<number>('stall.ttfbBytes', 100);
    const minBytesPerSecond = await this.getSetting<number | null>('stall.minBytesPerSecond', null);
    const windowSeconds = await this.getSetting<number>('stall.windowSeconds', 10);
    const gracePeriodSeconds = await this.getSetting<number>('stall.gracePeriodSeconds', 30);
    const stallCooldown = await this.getSetting<boolean>('stall.stallCooldown', false);
    return {
      ttfbSeconds,
      ttfbBytes,
      minBytesPerSecond,
      windowSeconds,
      gracePeriodSeconds,
      stallCooldown,
    };
  }
}
