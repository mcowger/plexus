/**
 * Lightweight utility to output dev server config values (port, db path)
 * so that shell scripts can source them.
 *
 * Usage:
 *   bun run dev:get:port        → prints the port number
 *   bun run dev:get:db_path     → prints the database URL/path
 */

import { join, basename } from 'path';
import { tmpdir } from 'os';

const dirName = basename(process.cwd());

// --- Port (same logic as dev.ts) ---
function getPort(): string {
  if (process.env.PORT) return process.env.PORT;
  let hash = 5381;
  for (let i = 0; i < dirName.length; i++) {
    hash = (hash * 33) ^ dirName.charCodeAt(i);
  }
  return String(10000 + (Math.abs(hash) % 10000));
}

// --- DB path (same logic as dev.ts) ---
function getDbPath(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.PLEXUS_POSTGRES_DRIVER === 'pglite') {
    const dataDir =
      process.env.PLEXUS_PGLITE_DATA_DIR ?? join(tmpdir(), `plexus-${dirName}.pglite`);
    return dataDir;
  }
  return `sqlite://${join(tmpdir(), `plexus-${dirName}.db`)}`;
}

// --- CLI ---
const command = process.argv[2];
if (command === 'port') {
  console.log(getPort());
} else if (command === 'db_path') {
  console.log(getDbPath());
} else {
  console.error(`Usage: bun run scripts/dev-config.ts <port|db_path>`);
  process.exit(1);
}
