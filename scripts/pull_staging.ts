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
 *   PLEXUS_EXCLUDE_OAUTH        Exclude OAuth providers from restore (default: true)
 */

import { createWriteStream, unlinkSync } from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import readline from 'readline';
import { gzipSync, gunzipSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// Config from environment
// ---------------------------------------------------------------------------

const STAGING_URL = process.env.PLEXUS_STAGING_URL;
const STAGING_KEY = process.env.PLEXUS_STAGING_ADMIN_KEY;
const LOCAL_URL = process.env.PLEXUS_LOCAL_URL ?? 'http://localhost:4000';
const LOCAL_KEY = process.env.PLEXUS_LOCAL_ADMIN_KEY;
const EXCLUDE_OAUTH = (process.env.PLEXUS_EXCLUDE_OAUTH ?? 'true').toLowerCase() !== 'false';

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

  // --- Optionally strip OAuth providers ---
  let restoreBody: Buffer = (await Bun.file(tmpFile).arrayBuffer()) as unknown as Buffer;
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

  // --- Confirmation ---
  console.log();
  console.log('WARNING: This will overwrite your local Plexus database with staging data.');
  if (removedOAuthProviders.length > 0) {
    console.log(`  (${removedOAuthProviders.length} OAuth provider(s) will be excluded)`);
  }
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
    body: restoreBody,
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
