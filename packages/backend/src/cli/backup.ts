#!/usr/bin/env bun
/**
 * Database backup utility.
 *
 * Usage:
 *   bun run backup
 *
 * Creates a timestamped backup of the current database.
 * Uses PLEXUS_DB_BACKUP_DIR environment variable for output (default: ./backups)
 */

import { mkdir, stat, copyFile } from 'node:fs/promises';
import { dirname, join, basename, extname } from 'node:path';
import { logger } from '../utils/logger';

const DEFAULT_BACKUP_DIR = './backups';

/**
 * Generate backup filename preserving original name
 * Format: {basename}.{timestamp}.bak.sqlite
 */
function generateBackupName(dbUrl: string): string {
  // Extract file path from sqlite:// URL or use as-is for file paths
  const path = dbUrl.replace(/^sqlite:\/\//, '').replace(/^file:/, '');
  const parsed = path.replace(/^\.\//, '');
  const base = basename(parsed, extname(parsed));
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${base}.${timestamp}.bak.sqlite`;
}

async function main() {
  // Get database URL - prefer DATABASE_URL env var
  let dbUrl = process.env.DATABASE_URL;

  if (!dbUrl) {
    logger.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const backupDir = process.env.PLEXUS_DB_BACKUP_DIR || DEFAULT_BACKUP_DIR;

  // Resolve database path
  const dbPath = dbUrl.replace(/^sqlite:\/\//, '').replace(/^file:/, '');

  // Make paths absolute relative to current working directory
  let resolvedDbPath = dbPath;
  if (!dbPath.startsWith('/')) {
    resolvedDbPath = join(process.cwd(), dbPath);
  }

  const resolvedBackupDir = backupDir.startsWith('/') ? backupDir : join(process.cwd(), backupDir);

  // Get database file size
  let dbSize = 0;
  try {
    const stats = await stat(resolvedDbPath);
    dbSize = stats.size;
  } catch {
    logger.error(`Database not found at ${resolvedDbPath}`);
    process.exit(1);
  }

  logger.info(`Database: ${resolvedDbPath}`);
  logger.info(`Backup dir: ${resolvedBackupDir}`);
  logger.info(`Database size: ${(dbSize / 1024).toFixed(2)} KB`);

  // Create backup directory if needed
  await mkdir(resolvedBackupDir, { recursive: true });

  // Generate backup filename
  const backupName = generateBackupName(dbUrl);
  const backupPath = join(resolvedBackupDir, backupName);

  logger.info(`Creating backup: ${backupName}`);

  // Copy the database file
  await copyFile(resolvedDbPath, backupPath);

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
