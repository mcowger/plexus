/**
 * prep-dev.ts
 *
 * Prepares the local dev environment with data from staging or local backup.
 * This script replaces the old pull-staging, populate-dev, and clear-dev scripts.
 *
 * Usage:
 *   bun run prep-dev                      # Restore from saved local data (default)
 *   bun run prep-dev --save               # Download from staging & save locally (no restore)
 *   bun run prep-dev --live               # Download from staging & restore (no save)
 *   bun run prep-dev --save --live        # Download, save, and restore
 *   bun run prep-dev --clear              # Clear local dev data + restore from saved backup
 *
 * Options:
 *   --save    Download staging data and save to local file
 *   --live    Use staging data directly (implies --save)
 *   --clear   Clear/reset local dev database
 *
 * Environment variables:
 *   PLEXUS_STAGING_URL          URL of staging instance (for --save/--live)
 *   PLEXUS_STAGING_ADMIN_KEY    Admin API key for staging
 *   PLEXUS_DEV_DATA_PATH        Path for saved data (default: .dev-data/)
 *   PLEXUS_URL                  Base URL for local instance (default: http://localhost)
 *   PLEXUS_PORT                 Port for local instance (auto-derived from cwd)
 *   PLEXUS_ADMIN_KEY            Admin key for local instance (default: password)
 *   PLEXUS_EXCLUDE_OAUTH        Exclude OAuth providers (default: true)
 */

import { createWriteStream, unlinkSync, rmSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { pipeline } from 'stream/promises';
import readline from 'readline';
import { gzipSync, gunzipSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// Config from environment
// ---------------------------------------------------------------------------

// Mirrors the stable port derivation in scripts/dev.ts so this script targets
// the correct worktree instance without any configuration.
function deriveDevPort(): string {
  const dirName = basename(process.cwd());
  let hash = 5381;
  for (let i = 0; i < dirName.length; i++) {
    hash = (hash * 33) ^ dirName.charCodeAt(i);
  }
  return String(10000 + (Math.abs(hash) % 10000));
}

// Parse command line arguments
const args = process.argv.slice(2);
const HELP_MODE = args.includes('--help') || args.includes('-h');
const SAVE_MODE = args.includes('--save');
const LIVE_MODE = args.includes('--live');
const CLEAR_MODE = args.includes('--clear');
const RESET_MODE = args.includes('--reset');

if (HELP_MODE) {
  console.log(`
Usage (via npm scripts):
  bun run prep-dev            # Restore from saved local data (default)
  bun run prep-dev:save       # Download from staging & save locally (no restore)
  bun run prep-dev:live       # Download from staging & restore (no save)
  bun run prep-dev:clear      # Clear local dev data (stops/restarts server)
  bun run prep-dev:reset      # Clear local dev data + restore from saved backup

Options (for direct script usage):
  --save    Download staging data and save locally (no restore)
  --live    Download from staging & restore (no save)
  --clear   Clear local dev data only (stops/restarts server)
  --reset   Clear local dev data + restore from saved backup
  --help    Show this help message

Environment variables:
  PLEXUS_STAGING_URL          URL of staging instance (for --save/--live)
  PLEXUS_STAGING_ADMIN_KEY    Admin API key for staging
  PLEXUS_DEV_DATA_PATH        Path for saved data (default: .dev-data/)
  PLEXUS_URL                  Base URL for local instance
  PLEXUS_PORT                 Port for local instance (auto-derived from cwd)
  PLEXUS_ADMIN_KEY            Admin key for local (default: password)
  PLEXUS_EXCLUDE_OAUTH        Exclude OAuth providers (default: true)
`);
  process.exit(0);
}

// --save means download+save+restore, --live means download+restore (no save)
const shouldSave = SAVE_MODE;
const shouldUseLive = LIVE_MODE || SAVE_MODE;

const STAGING_URL = process.env.PLEXUS_STAGING_URL;
const STAGING_KEY = process.env.PLEXUS_STAGING_ADMIN_KEY;

const DEV_DATA_PATH = process.env.PLEXUS_DEV_DATA_PATH ?? '.dev-data';
const SAVED_BACKUP_FILE = join(DEV_DATA_PATH, 'backup.tar.gz');

const LOCAL_BASE_URL = process.env.PLEXUS_URL ?? 'http://localhost';
const LOCAL_PORT = process.env.PLEXUS_PORT ?? deriveDevPort();
const LOCAL_URL = `${LOCAL_BASE_URL}:${LOCAL_PORT}`;
const LOCAL_KEY = process.env.PLEXUS_ADMIN_KEY ?? 'password';
const EXCLUDE_OAUTH = (process.env.PLEXUS_EXCLUDE_OAUTH ?? 'true').toLowerCase() !== 'false';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    console.error(`Error: ${name} must be set.`);
    process.exit(1);
  }
  return value;
}

// ─── Minimal tar helpers (mirror BackupService format) ──────────────

function buildTar(files: Map<string, Buffer>): Buffer {
  const chunks: Buffer[] = [];
  for (const [name, content] of files) {
    const header = Buffer.alloc(512, 0);
    const nameBytes = Buffer.from(name, 'utf8');
    nameBytes.copy(header, 0, 0, Math.min(nameBytes.length, 100));
    header.write('0000644\0', 100, 8, 'ascii');
    header.write('0001750\0', 108, 8, 'ascii');
    header.write('0001750\0', 116, 8, 'ascii');
    const sizeStr = content.length.toString(8).padStart(11, '0') + '\0';
    header.write(sizeStr, 124, 12, 'ascii');
    header.write(
      Math.floor(Date.now() / 1000)
        .toString(8)
        .padStart(11, '0') + '\0',
      136,
      12,
      'ascii'
    );
    header.write('        ', 148, 8, 'ascii');
    header.write('0', 156, 1, 'ascii');
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    let checksum = 0;
    for (let i = 0; i < 512; i++) checksum += header[i]!;
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    chunks.push(header);
    chunks.push(content);
    const remainder = content.length % 512;
    if (remainder > 0) chunks.push(Buffer.alloc(512 - remainder, 0));
  }
  chunks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(chunks);
}

function parseTar(data: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 512 <= data.length) {
    let allZero = true;
    for (let i = 0; i < 512; i++) {
      if (data[offset + i] !== 0) {
        allZero = false;
        break;
      }
    }
    if (allZero) break;
    const name = data
      .subarray(offset, offset + 100)
      .toString('utf8')
      .replace(/\0+$/, '');
    const sizeStr = data
      .subarray(offset + 124, offset + 136)
      .toString('ascii')
      .replace(/\0+$/, '')
      .trim();
    const size = parseInt(sizeStr, 8) || 0;
    offset += 512;
    if (size >= 0) {
      const content = size > 0 ? data.subarray(offset, offset + size) : Buffer.alloc(0);
      files.set(name, Buffer.from(content));
    }
    offset += size;
    const remainder = size % 512;
    if (remainder > 0) offset += 512 - remainder;
  }
  return files;
}

function stripOAuthProviders(config: any): { config: any; removed: string[] } {
  const providers = config.providers as Record<string, any> | undefined;
  if (!providers) return { config, removed: [] };

  const removed: string[] = [];
  const filtered: Record<string, any> = {};

  for (const [slug, cfg] of Object.entries(providers)) {
    if (cfg?.oauth_provider) {
      removed.push(slug);
    } else {
      filtered[slug] = cfg;
    }
  }

  return {
    config: {
      ...config,
      providers: filtered,
      oauth_credentials: [],
    },
    removed,
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function waitForServer(timeout = 30000): Promise<void> {
  const url = LOCAL_URL.replace(/\/$/, '');
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server did not become ready within ${timeout / 1000}s`);
}

async function clearDevData() {
  const dirName = basename(process.cwd());
  const dbPath = join(tmpdir(), `plexus-${dirName}.db`);
  const pgliteDir = join(tmpdir(), `plexus-${dirName}.pglite`);
  const pidFile = join(tmpdir(), `plexus-${dirName}.pid`);

  console.log('Clearing local dev data...\n');

  // Delete the SQLite database file
  if (existsSync(dbPath)) {
    unlinkSync(dbPath);
    console.log(`  ✓ Deleted database: ${dbPath}`);
  } else {
    console.log('  ✓ No SQLite database file found');
  }

  // Delete the PGlite data directory
  if (existsSync(pgliteDir)) {
    rmSync(pgliteDir, { recursive: true, force: true });
    console.log(`  ✓ Deleted PGlite data dir: ${pgliteDir}`);
  } else {
    console.log('  ✓ No PGlite data directory found');
  }

  // Note: Do NOT delete the saved backup file - it's source data that persists

  // Try to restart the dev server
  try {
    if (existsSync(pidFile)) {
      const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
      process.kill(pid, 'SIGUSR1');
      console.log(`  ✓ Restarted dev server (PID ${pid})`);
    }
  } catch {
    // Ignore errors - server might not be running
  }

  console.log('\n✓ Local dev data cleared.');
}

async function downloadFromStaging(): Promise<Buffer> {
  const stagingUrl = requireEnv('PLEXUS_STAGING_URL', STAGING_URL).replace(/\/$/, '');
  const stagingKey = requireEnv('PLEXUS_STAGING_ADMIN_KEY', STAGING_KEY);

  console.log('Downloading full backup from staging...\n');

  const tmpDir = mkdtempSync(join(tmpdir(), 'plexus-staging-backup-'));
  const tmpFile = join(tmpDir, 'backup.tar.gz');

  const backupRes = await fetch(`${stagingUrl}/v0/management/backup?full=true`, {
    headers: { 'x-admin-key': stagingKey },
  });

  if (!backupRes.ok || !backupRes.body) {
    console.error(`Error: backup download failed (${backupRes.status} ${backupRes.statusText})`);
    process.exit(1);
  }

  // @ts-expect-error — Bun's ReadableStream is compatible with Node's stream pipeline
  await pipeline(backupRes.body, createWriteStream(tmpFile));

  const stats = await Bun.file(tmpFile).stat();
  console.log(`Downloaded ${formatBytes(stats.size)} backup`);

  let restoreBody: Buffer = Buffer.from(await Bun.file(tmpFile).arrayBuffer());
  let removedOAuthProviders: string[] = [];

  if (EXCLUDE_OAUTH) {
    console.log('Excluding OAuth providers from restore...');
    const tarData = gunzipSync(restoreBody);
    const files = parseTar(tarData);
    const configBuf = files.get('config.json');
    if (configBuf) {
      const config = JSON.parse(configBuf.toString('utf8'));
      const { config: stripped, removed } = stripOAuthProviders(config);
      removedOAuthProviders = removed;
      files.set('config.json', Buffer.from(JSON.stringify(stripped, null, 2), 'utf8'));
      restoreBody = gzipSync(buildTar(files));
      if (removed.length > 0) {
        console.log(`  Excluded ${removed.length} OAuth provider(s): ${removed.join(', ')}`);
      } else {
        console.log('  No OAuth providers found in backup.');
      }
    }
  }

  // Clean up temp dir
  rmSync(tmpDir, { recursive: true, force: true });

  return restoreBody;
}

async function restoreToLocal(data: Buffer) {
  const localUrl = LOCAL_URL.replace(/\/$/, '');
  console.log(`\nRestoring to local instance at ${localUrl}...`);

  const restoreRes = await fetch(`${localUrl}/v0/management/restore`, {
    method: 'POST',
    headers: {
      'x-admin-key': LOCAL_KEY,
      'Content-Type': 'application/gzip',
    },
    body: data,
  });

  if (!restoreRes.ok) {
    console.error(`Error: restore failed (${restoreRes.status} ${restoreRes.statusText})`);
    process.exit(1);
  }

  console.log('✓ Restore complete.');
}

async function saveBackup(data: Buffer) {
  // Ensure directory exists
  if (!existsSync(DEV_DATA_PATH)) {
    mkdirSync(DEV_DATA_PATH, { recursive: true });
  }

  // Remove existing backup
  if (existsSync(SAVED_BACKUP_FILE)) {
    unlinkSync(SAVED_BACKUP_FILE);
  }

  // Write new backup
  await Bun.write(SAVED_BACKUP_FILE, data);
  console.log(`✓ Saved backup to ${SAVED_BACKUP_FILE}`);
}

async function getSavedBackup(): Promise<Buffer | null> {
  if (!existsSync(SAVED_BACKUP_FILE)) {
    return null;
  }
  const arr = await Bun.file(SAVED_BACKUP_FILE).arrayBuffer();
  return Buffer.from(arr);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║       Plexus Dev Prepare Script        ║');
  console.log('╚════════════════════════════════════════╝\n');

  // Handle --clear mode (clear only)
  if (CLEAR_MODE) {
    console.log(`  Mode: clear`);
    console.log(`  Target local:  ${LOCAL_URL}
`);
    await clearDevData();
    return;
  }

  // Handle --reset mode (clear + restore from saved backup)
  if (RESET_MODE) {
    console.log(`  Mode: reset`);
    console.log(`  Target local:  ${LOCAL_URL}
`);
    await clearDevData();

    if (!existsSync(SAVED_BACKUP_FILE)) {
      console.error('No saved backup found. Run prep-dev:save first.');
      process.exit(1);
    }

    console.log('Restoring from saved backup...');
    console.log(`  Data path:     ${DEV_DATA_PATH}`);
    console.log();

    // Wait for server to restart
    console.log('Waiting for server to restart...');
    await waitForServer();
    console.log('Server ready.');
    console.log();

    const backupData = await getSavedBackup();
    await restoreToLocal(backupData!);
    console.log('\n✓ Done. Local instance now has saved data.');
    return;
  }

  // If no data source specified and no saved data, show help
  const hasSavedData = existsSync(SAVED_BACKUP_FILE);
  if (!shouldUseLive && !hasSavedData) {
    console.log(`  Mode: local (no data source)
`);
    console.log(`No saved data found. Run with --save to download from staging first.`);
    console.log(`  Or set PLEXUS_DEV_DATA_PATH if your data is elsewhere.`);
    console.log(`\nUse --help for usage information.`);
    process.exit(1);
  }

  console.log(`  Target local:  ${LOCAL_URL}`);
  console.log(`  Data path:     ${DEV_DATA_PATH}`);
  console.log(`  Live mode:     ${shouldUseLive ? 'yes' : 'no'}`);
  console.log(`  Save mode:     ${shouldSave ? 'yes' : 'no'}\n`);

  let backupData: Buffer | null = null;

  // Determine source of data
  if (shouldUseLive) {
    // Download from staging
    backupData = await downloadFromStaging();

    if (shouldSave) {
      // Save locally for future use (no restore)
      await saveBackup(backupData);
      console.log('\n✓ Done. Saved backup to local file.');
      console.log('  Run "bun run prep-dev" to restore it to your dev DB.');
      return;
    }
  } else {
    // Try to use saved local data
    backupData = await getSavedBackup();
    if (!backupData) {
      console.error('No saved data found. Run with --save to download from staging first.');
      console.error(`  Or set PLEXUS_DEV_DATA_PATH if your data is elsewhere.`);
      process.exit(1);
    }
    console.log('Using saved local backup.');
  }

  // Confirmation for staging restore (skip for save-only mode)
  if (shouldUseLive && !SAVE_MODE) {
    console.log();
    console.log('WARNING: This will overwrite your local Plexus database with staging data.');
    const response = await ask('Continue? [y/N] ');
    if (!/^y$/i.test(response)) {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  // Restore to local (skip for save-only mode)
  if (!SAVE_MODE) {
    await restoreToLocal(backupData);
    console.log();
    console.log('✓ Done. Local instance now has staging data.');
    console.log('  (Restart the dev server if needed to pick up changes)');
  }

  console.log();
  console.log('✓ Done. Local instance now has staging data.');
  console.log('  (Restart the dev server if needed to pick up changes)');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
