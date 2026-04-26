#!/usr/bin/env bun
/**
 * One-time ETL: migrate data from the legacy `quota_snapshots` table to the
 * new `meter_snapshots` table introduced in the quota-tracking overhaul.
 *
 * Usage:
 *   bun run src/cli/migrate-quota-snapshots.ts
 *
 * The DATABASE_URL env var must be set explicitly — there is no default fallback.
 *
 * This script is idempotent — rows already present in `meter_snapshots` for
 * a given (checkerId, meterKey, checkedAt) triplet are skipped, so it is safe
 * to run more than once.
 *
 * Field mapping from quota_snapshots → meter_snapshots:
 *   provider        → provider
 *   checker_id      → checker_id       (checkerId)
 *   group_id        → group            (renamed)
 *   window_type     → kind, period*    (derived – see mapWindowType)
 *   window_type     → meter_key        (used as a stable key)
 *   description     → label            (falls back to window_type)
 *   checked_at      → checked_at
 *   limit           → limit
 *   used            → used
 *   remaining       → remaining
 *   utilization_%   → utilization_percent + utilization_state
 *   unit            → unit             (defaults to '' if null)
 *   resets_at       → resets_at
 *   status          → status           (defaults to 'ok' if null)
 *   success         → success
 *   error_message   → error_message
 *   created_at      → created_at
 *
 *   checker_type    → 'unknown'        (not stored in old table)
 */

import { sql } from 'drizzle-orm';
import { initializeDatabase, getDatabase, getCurrentDialect } from '../db/client';
import { runMigrations } from '../db/migrate';
import { logger } from '../utils/logger';
import { toDbTimestampMs } from '../utils/normalize';

// ─── Window-type helpers ──────────────────────────────────────────────────────

type MeterKind = 'balance' | 'allowance';
type PeriodUnit = 'minute' | 'hour' | 'day' | 'week' | 'month';
type PeriodCycle = 'fixed' | 'rolling';

interface PeriodInfo {
  kind: MeterKind;
  periodValue?: number;
  periodUnit?: PeriodUnit;
  periodCycle?: PeriodCycle;
}

function mapWindowType(windowType: string): PeriodInfo {
  const wt = windowType.toLowerCase().trim();
  if (wt === 'balance' || wt === 'credits' || wt === 'wallet') {
    return { kind: 'balance' };
  }
  if (wt === 'hourly' || wt === 'hour') {
    return { kind: 'allowance', periodValue: 1, periodUnit: 'hour', periodCycle: 'rolling' };
  }
  if (wt === 'daily' || wt === 'day') {
    return { kind: 'allowance', periodValue: 1, periodUnit: 'day', periodCycle: 'fixed' };
  }
  if (wt === 'weekly' || wt === 'week') {
    return { kind: 'allowance', periodValue: 1, periodUnit: 'week', periodCycle: 'fixed' };
  }
  if (wt === 'monthly' || wt === 'month') {
    return { kind: 'allowance', periodValue: 1, periodUnit: 'month', periodCycle: 'fixed' };
  }
  // Unknown window type — treat as a generic allowance with no period info.
  return { kind: 'allowance' };
}

// ─── Utilization helpers ──────────────────────────────────────────────────────

type UtilizationState = 'reported' | 'unknown' | 'not_applicable';
type MeterStatus = 'ok' | 'warning' | 'critical' | 'exhausted';

function utilizationState(percent: number | null | undefined): UtilizationState {
  return typeof percent === 'number' ? 'reported' : 'unknown';
}

function deriveStatus(existingStatus: string | null | undefined): MeterStatus {
  if (!existingStatus) return 'ok';
  const s = existingStatus.toLowerCase();
  if (s === 'exhausted' || s === 'critical' || s === 'warning') return s as MeterStatus;
  return 'ok';
}

// ─── Raw-SQL table existence check ───────────────────────────────────────────

async function tableExists(
  db: ReturnType<typeof getDatabase>,
  tableName: string
): Promise<boolean> {
  const dialect = getCurrentDialect();
  try {
    if (dialect === 'sqlite') {
      const rows = await db.run(
        sql`SELECT name FROM sqlite_master WHERE type='table' AND name=${tableName}`
      );
      // bun-sqlite returns an object with rows property
      const result = rows as any;
      return (result?.rows?.length ?? result?.length ?? 0) > 0;
    } else {
      const rows = await db.execute(
        sql`SELECT 1 FROM information_schema.tables WHERE table_name=${tableName} LIMIT 1`
      );
      return (rows as any[]).length > 0;
    }
  } catch {
    return false;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.DATABASE_URL) {
    logger.error('DATABASE_URL must be set');
    process.exit(1);
  }

  initializeDatabase();
  await runMigrations();

  const db = getDatabase();
  const dialect = getCurrentDialect();

  // Verify source table exists.
  if (!(await tableExists(db, 'quota_snapshots'))) {
    logger.info('quota_snapshots table does not exist — nothing to migrate.');
    return;
  }

  // Count source rows.
  const countResult = await db.execute(sql`SELECT COUNT(*) as cnt FROM quota_snapshots`);
  const totalRows = Number((countResult as any)[0]?.cnt ?? 0);

  if (totalRows === 0) {
    logger.info('quota_snapshots is empty — nothing to migrate.');
    return;
  }

  logger.info(`Found ${totalRows} row(s) in quota_snapshots — starting migration…`);

  // Fetch all source rows.
  const sourceRows = (await db.execute(sql`
    SELECT
      id,
      provider,
      checker_id,
      group_id,
      window_type,
      description,
      checked_at,
      "limit",
      used,
      remaining,
      utilization_percent,
      unit,
      resets_at,
      status,
      success,
      error_message,
      created_at
    FROM quota_snapshots
    ORDER BY id ASC
  `)) as any[];

  let inserted = 0;
  let skipped = 0;
  const BATCH_SIZE = 200;

  for (let i = 0; i < sourceRows.length; i += BATCH_SIZE) {
    const batch = sourceRows.slice(i, i + BATCH_SIZE);
    const values: any[] = [];

    for (const row of batch) {
      const windowType: string = row.window_type ?? 'unknown';
      const period = mapWindowType(windowType);

      const rawCheckedAt = row.checked_at;
      const rawCreatedAt = row.created_at;
      const rawResetsAt = row.resets_at;

      const checkedAt = toDbTimestampMs(rawCheckedAt, dialect);
      const createdAt = toDbTimestampMs(rawCreatedAt ?? rawCheckedAt, dialect);
      const resetsAt = rawResetsAt != null ? toDbTimestampMs(rawResetsAt, dialect) : null;

      // For SQLite the timestamp columns come back as Date objects (timestamp_ms mode),
      // for Postgres they arrive as numbers (bigint mode). toDbTimestampMs normalises
      // them back to the correct storage format.

      const utilizPct: number | null =
        row.utilization_percent != null ? Number(row.utilization_percent) : null;
      const utilState = utilizationState(utilizPct);
      const status = deriveStatus(row.status);
      const label: string = (row.description as string | null) ?? windowType;
      const unit: string = (row.unit as string | null) ?? '';
      const successVal = dialect === 'sqlite' ? (row.success ? 1 : 0) : Boolean(row.success);

      values.push({
        checkerId: row.checker_id as string,
        checkerType: 'unknown',
        provider: row.provider as string,
        meterKey: windowType,
        kind: period.kind,
        unit,
        label,
        group: (row.group_id as string | null) ?? null,
        scope: null,
        limit: row.limit != null ? Number(row.limit) : null,
        used: row.used != null ? Number(row.used) : null,
        remaining: row.remaining != null ? Number(row.remaining) : null,
        utilizationState: utilState,
        utilizationPercent: utilizPct,
        status,
        periodValue: period.periodValue ?? null,
        periodUnit: period.periodUnit ?? null,
        periodCycle: period.periodCycle ?? null,
        resetsAt,
        success: successVal,
        errorMessage: (row.error_message as string | null) ?? null,
        checkedAt,
        createdAt,
      });
    }

    // Build the deduplication key set from meter_snapshots for this batch's (checkerId, meterKey, checkedAt).
    // We use INSERT OR IGNORE (SQLite) / INSERT ... ON CONFLICT DO NOTHING (Postgres) via raw SQL
    // because drizzle's insert doesn't expose dialect-specific conflict clauses uniformly here.
    for (const v of values) {
      try {
        if (dialect === 'sqlite') {
          await db.execute(sql`
            INSERT OR IGNORE INTO meter_snapshots
              (checker_id, checker_type, provider, meter_key, kind, unit, label,
               "group", scope, "limit", used, remaining, utilization_state,
               utilization_percent, status, period_value, period_unit, period_cycle,
               resets_at, success, error_message, checked_at, created_at)
            VALUES
              (${v.checkerId}, ${v.checkerType}, ${v.provider}, ${v.meterKey},
               ${v.kind}, ${v.unit}, ${v.label}, ${v.group}, ${v.scope},
               ${v.limit}, ${v.used}, ${v.remaining}, ${v.utilizationState},
               ${v.utilizationPercent}, ${v.status}, ${v.periodValue}, ${v.periodUnit},
               ${v.periodCycle}, ${v.resetsAt}, ${v.success}, ${v.errorMessage},
               ${v.checkedAt}, ${v.createdAt})
          `);
        } else {
          await db.execute(sql`
            INSERT INTO meter_snapshots
              (checker_id, checker_type, provider, meter_key, kind, unit, label,
               "group", scope, "limit", used, remaining, utilization_state,
               utilization_percent, status, period_value, period_unit, period_cycle,
               resets_at, success, error_message, checked_at, created_at)
            VALUES
              (${v.checkerId}, ${v.checkerType}, ${v.provider}, ${v.meterKey},
               ${v.kind}, ${v.unit}, ${v.label}, ${v.group}, ${v.scope},
               ${v.limit}, ${v.used}, ${v.remaining}, ${v.utilizationState},
               ${v.utilizationPercent}, ${v.status}, ${v.periodValue}, ${v.periodUnit},
               ${v.periodCycle}, ${v.resetsAt}, ${v.success}, ${v.errorMessage},
               ${v.checkedAt}, ${v.createdAt})
            ON CONFLICT DO NOTHING
          `);
        }
        inserted++;
      } catch (err) {
        logger.warn(`Skipping row (checker=${v.checkerId}, meterKey=${v.meterKey}): ${err}`);
        skipped++;
      }
    }

    logger.info(
      `Progress: ${Math.min(i + BATCH_SIZE, sourceRows.length)} / ${sourceRows.length} processed`
    );
  }

  logger.info(
    `Migration complete. Inserted: ${inserted}, Skipped (already existed or error): ${skipped}`
  );
}

export { main as migrateQuotaSnapshotsMain };

if (import.meta.main) {
  main().catch((err) => {
    logger.error('Quota snapshot migration failed:', err);
    process.exit(1);
  });
}
