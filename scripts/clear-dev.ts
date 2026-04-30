/**
 * clear-dev.ts
 *
 * Resets the local dev database by deleting the SQLite file from /tmp and
 * issuing a graceful restart to the running Plexus server. The process
 * manager (bun --watch in dev mode) will restart the server automatically
 * against the fresh database.
 *
 * Usage:
 *   bun run scripts/clear-dev.ts
 *
 * Environment variables (all optional — defaults match `bun run dev` defaults):
 *   PLEXUS_URL       Base URL of the Plexus instance  (default: http://localhost)
 *   PLEXUS_PORT      Port                             (default: derived from cwd)
 *   PLEXUS_ADMIN_KEY Admin key                        (default: password)
 */

import { join, basename } from 'path';
import { unlinkSync, existsSync, readFileSync } from 'fs';

// ---------------------------------------------------------------------------
// Config from environment — mirrors dev.ts and populate-dev.ts defaults
// ---------------------------------------------------------------------------

const BASE_URL = process.env.PLEXUS_URL ?? 'http://localhost';
const ADMIN_KEY = process.env.PLEXUS_ADMIN_KEY ?? 'password';

function deriveDevPort(): string {
  const dirName = basename(process.cwd());
  let hash = 5381;
  for (let i = 0; i < dirName.length; i++) {
    hash = (hash * 33) ^ dirName.charCodeAt(i);
  }
  return String(10000 + (Math.abs(hash) % 10000));
}

function deriveDbPath(): string {
  const dirName = basename(process.cwd());
  return `/tmp/plexus-${dirName}.db`;
}

const PORT = process.env.PLEXUS_PORT ?? deriveDevPort();
const DB_PATH = process.env.DATABASE_URL?.replace('sqlite://', '') ?? deriveDbPath();
const API_ROOT = `${BASE_URL}:${PORT}`;
const PID_FILE = `/tmp/plexus-${basename(process.cwd())}.pid`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('╔════════════════════════════════════════╗');
console.log('║        Plexus Dev Clear Script         ║');
console.log('╚════════════════════════════════════════╝');
console.log(`\n  Target:   ${API_ROOT}`);
console.log(`  DB file:  ${DB_PATH}`);
console.log(
  `  Admin key: ${ADMIN_KEY.slice(0, 4)}${'*'.repeat(Math.max(0, ADMIN_KEY.length - 4))}\n`
);

// Step 1 — delete the database file
process.stdout.write('  Deleting database file...');
if (existsSync(DB_PATH)) {
  try {
    unlinkSync(DB_PATH);
    console.log(' done');
  } catch (err) {
    console.error(` failed\n\n  ✗  ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
} else {
  console.log(' not found (already clean)');
}

// Step 2 — send SIGHUP to dev.ts via its PID file, which kills and respawns
// the backend against the now-empty database.
process.stdout.write('  Sending SIGHUP to dev server...');
try {
  if (!existsSync(PID_FILE)) {
    console.log(' skipped (no PID file — server not running)');
    console.log('\n  ✓  Database cleared. Start the server with: bun run dev\n');
  } else {
    const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
    process.kill(pid, 'SIGHUP');
    console.log(` done (PID ${pid})`);
    console.log('\n  ✓  Backend is restarting against a fresh database.\n');
  }
} catch (err) {
  console.error(` failed\n\n  ✗  ${err instanceof Error ? err.message : String(err)}`);
  console.error('\n  Database was cleared but the server could not be signalled.');
  console.error('  Restart it manually: bun run dev\n');
  process.exit(1);
}
