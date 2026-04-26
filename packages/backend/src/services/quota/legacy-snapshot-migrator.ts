/**
 * Shared ETL logic for migrating legacy `quota_snapshots` rows into the new
 * `meter_snapshots` table. Used by both the CLI subcommand and the management
 * API route so the behaviour is identical in both contexts.
 */

import { sql, SQL } from 'drizzle-orm';
import { getDatabase, getCurrentDialect } from '../../db/client';
import { logger } from '../../utils/logger';
import { toDbTimestampMs } from '../../utils/normalize';

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
  return { kind: 'allowance' };
}

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

// ─── Dialect-aware raw SELECT helper ─────────────────────────────────────────
//
// drizzle-orm's bun-sqlite driver exposes `db.all()` for SELECT queries.
// The postgres-js driver exposes `db.execute()` instead. Using the wrong one
// returns metadata (run/changes) rather than rows, or throws entirely.

async function selectAll(db: ReturnType<typeof getDatabase>, query: SQL): Promise<any[]> {
  const dialect = getCurrentDialect();
  if (dialect === 'sqlite') {
    return (db as any).all(query) as any[];
  }
  return (await (db as any).execute(query)) as any[];
}

// ─── Table existence / row count ─────────────────────────────────────────────

async function tableExists(
  db: ReturnType<typeof getDatabase>,
  tableName: string
): Promise<boolean> {
  try {
    // Attempt a zero-row scan. "No such table" throws on both SQLite and Postgres.
    await selectAll(db, sql.raw(`SELECT 1 FROM ${tableName} LIMIT 0`));
    return true;
  } catch (err) {
    logger.debug(`[legacy-migrator] tableExists(${tableName}) → false (${err})`);
    return false;
  }
}

export interface LegacySnapshotStatus {
  tableExists: boolean;
  rowCount: number;
}

export async function getLegacySnapshotStatus(): Promise<LegacySnapshotStatus> {
  const db = getDatabase();

  if (!(await tableExists(db, 'quota_snapshots'))) {
    return { tableExists: false, rowCount: 0 };
  }

  const countResult = await selectAll(db, sql`SELECT COUNT(*) as cnt FROM quota_snapshots`);
  const rowCount = Number(countResult[0]?.cnt ?? 0);
  return { tableExists: true, rowCount };
}

// ─── ETL ─────────────────────────────────────────────────────────────────────

export interface MigrationResult {
  inserted: number;
  skipped: number;
  totalSource: number;
}

export async function migrateLegacySnapshots(): Promise<MigrationResult> {
  const db = getDatabase();
  const dialect = getCurrentDialect();

  if (!(await tableExists(db, 'quota_snapshots'))) {
    logger.info('[legacy-migrator] quota_snapshots table does not exist — nothing to migrate.');
    return { inserted: 0, skipped: 0, totalSource: 0 };
  }

  const countResult = await selectAll(db, sql`SELECT COUNT(*) as cnt FROM quota_snapshots`);
  const totalSource = Number(countResult[0]?.cnt ?? 0);

  if (totalSource === 0) {
    logger.info('[legacy-migrator] quota_snapshots is empty — nothing to migrate.');
    return { inserted: 0, skipped: 0, totalSource: 0 };
  }

  logger.info(`[legacy-migrator] Migrating ${totalSource} row(s) from quota_snapshots…`);

  const sourceRows = await selectAll(
    db,
    sql`
      SELECT
        id, provider, checker_id, group_id, window_type, description,
        checked_at, "limit", used, remaining, utilization_percent, unit,
        resets_at, status, success, error_message, created_at
      FROM quota_snapshots
      ORDER BY id ASC
    `
  );

  let inserted = 0;
  let skipped = 0;
  const BATCH_SIZE = 200;

  for (let i = 0; i < sourceRows.length; i += BATCH_SIZE) {
    const batch = sourceRows.slice(i, i + BATCH_SIZE);

    for (const row of batch) {
      const windowType: string = row.window_type ?? 'unknown';
      const period = mapWindowType(windowType);

      const checkedAt = toDbTimestampMs(row.checked_at, dialect);
      const createdAt = toDbTimestampMs(row.created_at ?? row.checked_at, dialect);
      const resetsAt = row.resets_at != null ? toDbTimestampMs(row.resets_at, dialect) : null;

      const utilizPct: number | null =
        row.utilization_percent != null ? Number(row.utilization_percent) : null;
      const utilState = utilizationState(utilizPct);
      const status = deriveStatus(row.status);
      const label: string = (row.description as string | null) ?? windowType;
      const unit: string = (row.unit as string | null) ?? '';
      const successVal = dialect === 'sqlite' ? (row.success ? 1 : 0) : Boolean(row.success);

      const v = {
        checkerId: row.checker_id as string,
        checkerType: 'unknown',
        provider: row.provider as string,
        meterKey: windowType,
        kind: period.kind,
        unit,
        label,
        group: (row.group_id as string | null) ?? null,
        scope: null as string | null,
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
      };

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
        logger.warn(
          `[legacy-migrator] Skipping row (checker=${v.checkerId}, meterKey=${v.meterKey}): ${err}`
        );
        skipped++;
      }
    }

    logger.info(
      `[legacy-migrator] Progress: ${Math.min(i + BATCH_SIZE, sourceRows.length)} / ${sourceRows.length}`
    );
  }

  logger.info(
    `[legacy-migrator] Done. Inserted: ${inserted}, Skipped: ${skipped}, Total source: ${totalSource}`
  );
  return { inserted, skipped, totalSource };
}

// ─── Export ──────────────────────────────────────────────────────────────────

const COLUMNS = [
  'id',
  'provider',
  'checker_id',
  'group_id',
  'window_type',
  'description',
  'checked_at',
  'limit',
  'used',
  'remaining',
  'utilization_percent',
  'unit',
  'resets_at',
  'status',
  'success',
  'error_message',
  'created_at',
] as const;

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = value instanceof Date ? value.toISOString() : String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

function sqlEscape(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  const s = value instanceof Date ? value.toISOString() : String(value);
  return `'${s.replaceAll("'", "''")}'`;
}

export type ExportFormat = 'csv' | 'sql';

export async function exportLegacySnapshots(format: ExportFormat): Promise<string> {
  const db = getDatabase();

  if (!(await tableExists(db, 'quota_snapshots'))) {
    return format === 'csv' ? COLUMNS.join(',') + '\n' : '-- quota_snapshots is empty\n';
  }

  const rows = await selectAll(
    db,
    sql`
      SELECT
        id, provider, checker_id, group_id, window_type, description,
        checked_at, "limit", used, remaining, utilization_percent, unit,
        resets_at, status, success, error_message, created_at
      FROM quota_snapshots
      ORDER BY id ASC
    `
  );

  if (format === 'csv') {
    const lines: string[] = [COLUMNS.join(',')];
    for (const row of rows) {
      lines.push(COLUMNS.map((col) => csvEscape(row[col])).join(','));
    }
    return lines.join('\n') + '\n';
  }

  // SQL insert statements
  const lines: string[] = [
    '-- quota_snapshots backup',
    `-- Exported ${new Date().toISOString()}`,
    `-- ${rows.length} row(s)`,
    '',
  ];
  for (const row of rows) {
    const vals = COLUMNS.map((col) => sqlEscape(row[col])).join(', ');
    lines.push(`INSERT INTO quota_snapshots (${COLUMNS.join(', ')}) VALUES (${vals});`);
  }
  return lines.join('\n') + '\n';
}

// ─── Truncate ─────────────────────────────────────────────────────────────────

export async function truncateLegacySnapshots(): Promise<void> {
  const db = getDatabase();
  const dialect = getCurrentDialect();

  if (!(await tableExists(db, 'quota_snapshots'))) {
    logger.info('[legacy-migrator] quota_snapshots does not exist, nothing to truncate.');
    return;
  }

  // SQLite has no TRUNCATE statement; DELETE FROM is equivalent.
  if (dialect === 'sqlite') {
    await db.execute(sql`DELETE FROM quota_snapshots`);
  } else {
    await db.execute(sql`TRUNCATE TABLE quota_snapshots`);
  }

  logger.info('[legacy-migrator] quota_snapshots truncated.');
}
