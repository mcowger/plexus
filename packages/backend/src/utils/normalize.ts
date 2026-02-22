export type BooleanLike = boolean | number | string | null | undefined;
export type TimestampLike = Date | number | string | null | undefined;
export type SupportedDialect = 'sqlite' | 'postgres';

export function toBoolean(value: BooleanLike, fallback = false): boolean {
  if (value == null) return fallback;

  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;

  const normalized = value.trim().toLowerCase();
  if (['true', '1', 't', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'f', 'no', 'n', 'off'].includes(normalized)) return false;

  return fallback;
}

export function toDbBoolean(value: BooleanLike): 0 | 1 {
  return toBoolean(value) ? 1 : 0;
}

export function toEpochMs(value: TimestampLike): number | null {
  if (value == null) return null;

  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const numeric = Number(value);
  if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
    return numeric;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function toIsoString(value: TimestampLike): string | null {
  const timestamp = toEpochMs(value);
  return timestamp == null ? null : new Date(timestamp).toISOString();
}

/**
 * Converts a timestamp value for insertion into a `timestamp` column.
 *
 * Schema pattern:
 *   - SQLite: `text('col')` — Drizzle expects a string (ISO 8601)
 *   - PostgreSQL: `timestamp('col')` — Drizzle expects a Date object
 *
 * Use this for MCP tables and any other tables that use `text` on SQLite
 * and `timestamp` on PostgreSQL.
 */
export function toDbTimestamp(
  value: TimestampLike,
  dialect: SupportedDialect
): string | Date | null {
  if (value == null) return null;
  const ms = toEpochMs(value);
  if (ms == null) return null;
  return dialect === 'postgres' ? new Date(ms) : new Date(ms).toISOString();
}

/**
 * Converts a timestamp value for insertion into a `timestamp_ms` column.
 *
 * Schema pattern:
 *   - SQLite: `integer('col', { mode: 'timestamp_ms' })` — Drizzle expects a Date object
 *   - PostgreSQL: `bigint('col', { mode: 'number' })` — Drizzle expects a number (epoch ms)
 *
 * Use this for quota_snapshots and any other tables that use
 * `integer(timestamp_ms)` on SQLite and `bigint(number)` on PostgreSQL.
 */
export function toDbTimestampMs(
  value: TimestampLike,
  dialect: SupportedDialect
): Date | number | null {
  if (value == null) return null;
  const ms = toEpochMs(value);
  if (ms == null) return null;
  return dialect === 'sqlite' ? new Date(ms) : ms;
}
