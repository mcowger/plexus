#!/usr/bin/env bun
/**
 * Database backup script
 * Creates a timestamped backup of the SQLite database
 *
 * Usage:
 *   bun run scripts/backup-db.ts
 *
 * Environment:
 *   PLEXUS_DB_URL  Required - path to the SQLite database
 *   PLEXUS_DB_BACKUP_DIR  Output directory (default: ./backups)
 */

import { mkdir, readdir, rm, stat, copyFile } from 'node:fs/promises';
import { dirname, join, basename, extname } from 'node:path';

const DEFAULT_BACKUP_DIR = './backups';

// Get database path from environment
const dbPath = process.env.PLEXUS_DB_URL ?? '';
if (!dbPath) {
  console.error('Error: PLEXUS_DB_URL environment variable is required');
  console.error('Usage: PLEXUS_DB_URL=./path/to/db.sqlite bun run scripts/backup-db.ts');
  process.exit(1);
}

const backupDir = process.env.PLEXUS_DB_BACKUP_DIR || DEFAULT_BACKUP_DIR;

/**
 * Get database file size
 */
async function getFileSize(path: string): Promise<number> {
  const stats = await stat(path);
  return stats.size;
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Generate backup filename preserving original name
 * Format: {basename}.{timestamp}.bak.sqlite
 */
function generateBackupName(dbPath: string): string {
  const parsed = dbPath.replace(/^\.\//, ''); // Remove ./
  const dir = dirname(parsed);
  const base = basename(parsed, extname(parsed));
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return join(dir, `${base}.${timestamp}.bak.sqlite`);
}

/**
 * Main backup function
 */
async function main() {
  console.log('📦 Database Backup Script');
  console.log('='.repeat(40));

  // Resolve database path relative to backend directory
  const scriptDir = dirname(import.meta.filename);
  const backendDir = join(scriptDir, '..');

  // Handle both absolute and relative paths
  let resolvedDbPath = dbPath;
  if (!dbPath.startsWith('/')) {
    resolvedDbPath = join(backendDir, dbPath);
  }

  const resolvedBackupDir = backupDir.startsWith('/') ? backupDir : join(backendDir, backupDir);

  console.log(`📁 Database: ${resolvedDbPath}`);
  console.log(`📁 Backup dir: ${resolvedBackupDir}`);
  console.log('');

  // Check if database exists
  let dbSize = 0;
  try {
    dbSize = await getFileSize(resolvedDbPath);
  } catch {
    console.error(`❌ Error: Database not found at ${resolvedDbPath}`);
    process.exit(1);
  }

  console.log(`📊 Database size: ${formatBytes(dbSize)}`);

  // Create backup directory if needed
  await mkdir(resolvedBackupDir, { recursive: true });

  // Generate backup filename
  const backupName = generateBackupName(dbPath);
  const backupPath = join(resolvedBackupDir, basename(backupName));

  console.log(`💾 Creating backup: ${basename(backupPath)}`);

  // Copy the database file
  await copyFile(resolvedDbPath, backupPath);

  // Verify backup was created
  const backupSize = await getFileSize(backupPath);
  console.log(`✅ Backup created: ${formatBytes(backupSize)}`);

  console.log('');
  console.log('🎉 Backup complete!');
  console.log(`📍 Backup location: ${backupPath}`);
}

main().catch((err) => {
  console.error('❌ Backup failed:', err);
  process.exit(1);
});
