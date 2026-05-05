#!/usr/bin/env bun
/**
 * Database backup utility.
 *
 * Usage:
 *   bun run backup
 *   bun run backup --full
 *
 * Creates a timestamped backup of the database using the BackupService,
 * which produces a portable, dialect-agnostic archive.
 *
 * - Default: config-only JSON backup (providers, models, keys, settings, etc.)
 * - --full:  full archive (.tar.gz) including operational data (usage logs,
 *            debug data, errors, cooldowns, etc.)
 *
 * Uses PLEXUS_DB_BACKUP_DIR environment variable for output (default: ./backups)
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { logger } from '../utils/logger';
import { BackupService } from '../services/backup-service';
import { initializeDatabase, getCurrentDialect } from '../db/client';

const DEFAULT_BACKUP_DIR = './backups';

function generateBackupName(full: boolean): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return full ? `plexus-backup.${timestamp}.tar.gz` : `plexus-backup.${timestamp}.json`;
}

async function main() {
  // Ensure database is initialized
  initializeDatabase();

  const dialect = getCurrentDialect();
  const full = process.argv.includes('--full');
  const backupDir = process.env.PLEXUS_DB_BACKUP_DIR || DEFAULT_BACKUP_DIR;

  const resolvedBackupDir = backupDir.startsWith('/') ? backupDir : join(process.cwd(), backupDir);

  // Create backup directory if needed
  await mkdir(resolvedBackupDir, { recursive: true });

  const backupService = new BackupService();

  // Generate backup filename
  const backupName = generateBackupName(full);
  const backupPath = join(resolvedBackupDir, backupName);

  logger.info(`Database dialect: ${dialect}`);
  logger.info(`Backup dir: ${resolvedBackupDir}`);
  logger.info(`Backup type: ${full ? 'full' : 'config-only'}`);

  if (full) {
    logger.info('Creating full backup (config + operational data)...');
    const archive = await backupService.exportFullBackup();
    writeFileSync(backupPath, archive);
  } else {
    logger.info('Creating config-only backup...');
    const envelope = await backupService.exportConfigBackup();
    writeFileSync(backupPath, JSON.stringify(envelope, null, 2));
  }

  logger.info(`Backup created: ${backupPath}`);
}

export { main as backupMain };

// Allow direct execution: bun run src/cli/backup.ts
if (import.meta.main) {
  main().catch((err) => {
    logger.error('Backup failed:', err);
    process.exit(1);
  });
}
