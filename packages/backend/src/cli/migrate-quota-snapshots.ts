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

import { initializeDatabase } from '../db/client';
import { runMigrations } from '../db/migrate';
import { logger } from '../utils/logger';
import { migrateLegacySnapshots } from '../services/quota/legacy-snapshot-migrator';

async function main() {
  if (!process.env.DATABASE_URL) {
    logger.error('DATABASE_URL must be set');
    process.exit(1);
  }

  initializeDatabase();
  await runMigrations();

  const { inserted, skipped, totalSource } = await migrateLegacySnapshots();

  if (totalSource === 0) {
    logger.info('Nothing to migrate.');
  } else {
    logger.info(`Migration complete. Inserted: ${inserted}, Skipped: ${skipped}`);
  }
}

export { main as migrateQuotaSnapshotsMain };

if (import.meta.main) {
  main().catch((err) => {
    logger.error('Quota snapshot migration failed:', err);
    process.exit(1);
  });
}
