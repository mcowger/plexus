/**
 * pull_staging.ts
 *
 * Downloads a full backup from a staging Plexus instance and restores it to
 * the local dev instance.  The local server will restart automatically when
 * running under `bun run dev` (the watcher respawns the process).
 *
 * Usage:
 *   bun run scripts/pull_staging.ts
 *
 * Required environment variables:
 *   PLEXUS_STAGING_URL          URL of the staging instance
 *   PLEXUS_STAGING_ADMIN_KEY    Admin API key for staging
 *   PLEXUS_LOCAL_ADMIN_KEY      Admin API key for local instance
 *
 * Optional environment variables:
 *   PLEXUS_LOCAL_URL            URL of the local instance (default: http://localhost:4000)
 */

import { createWriteStream, unlinkSync } from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import readline from 'readline';

// ---------------------------------------------------------------------------
// Config from environment
// ---------------------------------------------------------------------------

const STAGING_URL = process.env.PLEXUS_STAGING_URL;
const STAGING_KEY = process.env.PLEXUS_STAGING_ADMIN_KEY;
const LOCAL_URL = process.env.PLEXUS_LOCAL_URL ?? 'http://localhost:4000';
const LOCAL_KEY = process.env.PLEXUS_LOCAL_ADMIN_KEY;

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    console.error(`Error: ${name} must be set.`);
    process.exit(1);
  }
  return value;
}

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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const stagingUrl = requireEnv('PLEXUS_STAGING_URL', STAGING_URL).replace(/\/$/, '');
  const stagingKey = requireEnv('PLEXUS_STAGING_ADMIN_KEY', STAGING_KEY);
  const localUrl = LOCAL_URL.replace(/\/$/, '');
  const localKey = requireEnv('PLEXUS_LOCAL_ADMIN_KEY', LOCAL_KEY);

  const tmpDir = mkdtempSync(join(tmpdir(), 'plexus-staging-backup-'));
  const tmpFile = join(tmpDir, 'backup.tar.gz');

  // --- Download backup ---
  console.log('Downloading full backup from staging...');
  const backupRes = await fetch(`${stagingUrl}/v0/management/backup?full=true`, {
    headers: { Authorization: `Bearer ${stagingKey}` },
  });

  if (!backupRes.ok || !backupRes.body) {
    console.error(`Error: backup download failed (${backupRes.status} ${backupRes.statusText})`);
    process.exit(1);
  }

  // @ts-expect-error — Bun's ReadableStream is compatible with Node's stream pipeline
  await pipeline(backupRes.body, createWriteStream(tmpFile));

  const stats = await Bun.file(tmpFile).stat();
  console.log(`Downloaded ${formatBytes(stats.size)} backup`);

  // --- Confirmation ---
  console.log();
  console.log('WARNING: This will overwrite your local Plexus database with staging data.');
  const response = await ask('Continue? [y/N] ');
  if (!/^y$/i.test(response)) {
    console.log('Aborted.');
    cleanup(tmpFile);
    process.exit(0);
  }

  // --- Restore ---
  console.log('Restoring to local instance...');
  const restoreRes = await fetch(`${localUrl}/v0/management/restore`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${localKey}`,
      'Content-Type': 'application/gzip',
    },
    body: await Bun.file(tmpFile).arrayBuffer(),
  });

  cleanup(tmpFile);

  if (!restoreRes.ok) {
    console.error(`Error: restore failed (${restoreRes.status} ${restoreRes.statusText})`);
    process.exit(1);
  }

  console.log();
  console.log('Done. Local instance is restarting with staging data.');
}

function cleanup(file: string) {
  try {
    unlinkSync(file);
  } catch {
    // ignore
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
