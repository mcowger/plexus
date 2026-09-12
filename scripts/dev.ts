import { join, basename } from 'path';
import { tmpdir } from 'os';
import { createServer } from 'net';
import { existsSync, writeFileSync, unlinkSync, statSync, readFileSync } from 'fs';
import { spawn as nodeSpawn, type ChildProcess } from 'child_process';
import { deriveDevPort } from './dev-port-allocator';
import {
  buildFrpcArgs,
  buildFrpcEndpoint,
  DEFAULT_FRPC_SERVER_PORT,
  getRepositoryName,
  isFrpcAvailable,
  removeFrpcUrlFile,
  writeFrpcUrlFile,
} from './frpc';

// --- Dev defaults (only applied when not already set in environment) ---

const dirName = basename(process.cwd());

// Tracks the mtime of the saved backup we last restored, so `--full` can
// detect a fresher backup (e.g. after `bun run prep-dev:save`) and re-restore
// it even when the dev DB already exists.
const DEV_DATA_PATH = process.env.PLEXUS_DEV_DATA_PATH ?? '.dev-data';
const SAVED_BACKUP_FILE = join(process.cwd(), DEV_DATA_PATH, 'backup.tar.gz');
const RESTORE_MARKER_FILE = join(tmpdir(), `plexus-${dirName}.restored-backup`);

function savedBackupIsNewerThanLastRestore(): boolean {
  if (!existsSync(SAVED_BACKUP_FILE) || !existsSync(RESTORE_MARKER_FILE)) return false;
  const backupMtime = statSync(SAVED_BACKUP_FILE).mtimeMs;
  const lastRestoredMtime = Number(readFileSync(RESTORE_MARKER_FILE, 'utf8').trim());
  return Number.isFinite(lastRestoredMtime) && backupMtime > lastRestoredMtime;
}

function writeRestoreMarker() {
  if (!existsSync(SAVED_BACKUP_FILE)) return;
  writeFileSync(RESTORE_MARKER_FILE, String(statSync(SAVED_BACKUP_FILE).mtimeMs));
}

function readOptionValue(args: string[], index: number, option: string) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    console.error(`Missing value for ${option}`);
    process.exit(1);
  }
  return value;
}

let fullMode = false;
let profileMode = false;
let noOpen = false;

function sqlitePathFromDatabaseUrl(databaseUrl: string): string | null {
  if (!databaseUrl.startsWith('sqlite://')) return null;
  return databaseUrl.slice('sqlite://'.length);
}

function shouldLoadFullData(): boolean {
  if (!fullMode) return false;

  let dbMissing: boolean;
  if (process.env.PLEXUS_POSTGRES_DRIVER === 'pglite') {
    dbMissing = process.env.PLEXUS_PGLITE_DATA_DIR
      ? !existsSync(process.env.PLEXUS_PGLITE_DATA_DIR)
      : true;
  } else {
    const dbPath = sqlitePathFromDatabaseUrl(process.env.DATABASE_URL!);
    dbMissing = dbPath ? !existsSync(dbPath) : false;
  }

  return dbMissing || savedBackupIsNewerThanLastRestore();
}

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];

  if (arg === '--profile') {
    profileMode = true;
  } else if (arg === '--pglite') {
    process.env.PLEXUS_POSTGRES_DRIVER = 'pglite';
  } else if (arg === '--full') {
    fullMode = true;
  } else if (arg === '--no-open') {
    noOpen = true;
  } else if (arg.startsWith('DATABASE_URL=')) {
    process.env.DATABASE_URL = arg.slice('DATABASE_URL='.length);
  } else if (arg.startsWith('PORT=')) {
    process.env.PORT = arg.slice('PORT='.length);
  } else if (arg.startsWith('ADMIN_KEY=')) {
    process.env.ADMIN_KEY = arg.slice('ADMIN_KEY='.length);
  } else if (arg === '--database-url') {
    process.env.DATABASE_URL = readOptionValue(process.argv, i, arg);
    i++;
  } else if (arg.startsWith('--database-url=')) {
    process.env.DATABASE_URL = arg.slice('--database-url='.length);
  } else if (arg === '--port') {
    process.env.PORT = readOptionValue(process.argv, i, arg);
    i++;
  } else if (arg.startsWith('--port=')) {
    process.env.PORT = arg.slice('--port='.length);
  } else if (arg === '--admin-key') {
    process.env.ADMIN_KEY = readOptionValue(process.argv, i, arg);
    i++;
  } else if (arg.startsWith('--admin-key=')) {
    process.env.ADMIN_KEY = arg.slice('--admin-key='.length);
  } else {
    console.error(`Unknown option: ${arg}`);
    console.error('Usage: bun run dev [DATABASE_URL=...] [PORT=...] [ADMIN_KEY=...]');
    console.error(
      '   or: bun run dev [--database-url ...] [--port ...] [--admin-key ...] [--pglite] [--full] [--no-open] [--profile]'
    );
    process.exit(1);
  }
}

// Stable port derived from the worktree directory name, range 10000-19999.
// Two worktrees running simultaneously will land on different ports automatically.
// Override with: PORT=4000 bun run dev
if (!process.env.PORT) {
  process.env.PORT = deriveDevPort(process.cwd(), 'dev');
}

// Per-worktree database — persists across restarts, isolated per branch.
// PGlite mode: bun run dev --pglite  (or PLEXUS_POSTGRES_DRIVER=pglite)
// Postgres mode: DATABASE_URL=postgresql://... bun run dev
if (!process.env.DATABASE_URL) {
  if (process.env.PLEXUS_POSTGRES_DRIVER === 'pglite') {
    if (!process.env.PLEXUS_PGLITE_DATA_DIR) {
      process.env.PLEXUS_PGLITE_DATA_DIR = join(tmpdir(), `plexus-${dirName}.pglite`);
    }
    // Placeholder URL — dialect detection requires postgres://, actual storage is PLEXUS_PGLITE_DATA_DIR
    process.env.DATABASE_URL = 'postgres://localhost/plexus';
  } else {
    process.env.DATABASE_URL = `sqlite://${join(tmpdir(), `plexus-${dirName}.db`)}`;
  }
}

const shouldLoadFullDevData = shouldLoadFullData();

// Dev-only admin key.
// Override with: ADMIN_KEY=secret bun run dev
if (!process.env.ADMIN_KEY) {
  process.env.ADMIN_KEY = 'password';
}

// --- Port availability check ---

await new Promise<void>((resolve, reject) => {
  const probe = createServer();
  probe.once('error', () =>
    reject(
      new Error(
        `Port ${process.env.PORT} is already in use. Is another worktree running? Override with: PORT=<number> bun run dev`
      )
    )
  );
  probe.once('listening', () => probe.close(resolve));
  probe.listen(parseInt(process.env.PORT!));
}).catch((err) => {
  console.error(err.message);
  process.exit(1);
});

// --- PID file ---
// Written so that clear-dev.ts can send SIGUSR1 to trigger a backend restart.

const PID_FILE = join(tmpdir(), `plexus-${dirName}.pid`);
writeFileSync(PID_FILE, String(process.pid));
removeFrpcUrlFile(dirName);

// --- Startup ---

const BACKEND_DIR = join(process.cwd(), 'packages/backend');
const FRONTEND_DIR = join(process.cwd(), 'packages/frontend');

const WIN = process.platform === 'win32';

const childPgids: number[] = [];
let isShuttingDown = false;
let frpcProcess: ChildProcess | undefined;

function spawnManaged(
  command: string,
  args: string[],
  cwd: string,
  options: { detached?: boolean } = {}
): ChildProcess {
  const detached = options.detached ?? true;
  const proc = nodeSpawn(command, args, {
    cwd,
    env: { ...process.env },
    stdio: 'inherit',
    detached,
    ...(WIN ? { shell: true } : {}),
  });
  proc.on('error', (error) => {
    console.error(`[${command}] ${error.message}`);
  });
  if (proc.pid && detached) childPgids.push(proc.pid);
  return proc;
}

function killAll() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  removeFrpcUrlFile(dirName);

  if (frpcProcess?.pid) {
    try {
      process.kill(frpcProcess.pid, WIN ? undefined : 'SIGTERM');
    } catch {
      // already dead
    }
  }

  for (const pgid of childPgids) {
    try {
      if (WIN) {
        process.kill(pgid);
      } else {
        process.kill(-pgid, 'SIGKILL');
      }
    } catch {
      // already dead
    }
  }

  try {
    unlinkSync(PID_FILE);
  } catch {}
}

process.on('exit', killAll);

function startFrpc() {
  if (!isFrpcAvailable()) {
    console.log('[frpc] Tunnel disabled: frpc is not available on PATH.');
    return;
  }

  const serverAddr = process.env.FRPC_SERVER_ADDR;
  const token = process.env.FRPC_AUTH_TOKEN;
  if (!serverAddr && !token) {
    console.log('[frpc] Tunnel disabled: FRPC_SERVER_ADDR and FRPC_AUTH_TOKEN are not set.');
    return;
  }
  if (!serverAddr || !token) {
    console.warn('[frpc] Tunnel disabled: set both FRPC_SERVER_ADDR and FRPC_AUTH_TOKEN.');
    return;
  }

  const serverPort = Number(process.env.FRPC_SERVER_PORT ?? DEFAULT_FRPC_SERVER_PORT);
  if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535) {
    console.error(
      `[frpc] Tunnel disabled: invalid FRPC_SERVER_PORT "${process.env.FRPC_SERVER_PORT}".`
    );
    return;
  }

  const repositoryName = getRepositoryName(process.cwd());
  const worktreeName = basename(process.cwd());
  const { subdomain, url: publicUrl } = buildFrpcEndpoint(
    repositoryName,
    worktreeName,
    process.env.FRPC_SUBDOMAIN_HOST
  );
  const args = buildFrpcArgs({
    serverAddr,
    serverPort,
    token,
    proxyName: subdomain,
    localPort: Number(process.env.PORT),
    subdomain,
  });

  if (publicUrl) {
    writeFrpcUrlFile(publicUrl, dirName);
  }

  console.log(`[frpc] Starting tunnel for subdomain: ${subdomain}`);
  const proc = spawnManaged('frpc', args, process.cwd(), { detached: false });
  frpcProcess = proc;
  proc.on('error', () => removeFrpcUrlFile(dirName));
  proc.on('exit', (code, signal) => {
    if (frpcProcess === proc) frpcProcess = undefined;
    removeFrpcUrlFile(dirName);
    if (!isShuttingDown && code !== 0) {
      console.error(`[frpc] Tunnel exited with ${signal ? `signal ${signal}` : `code ${code}`}.`);
    }
  });
  console.log(`[frpc] ${publicUrl ? `URL=${publicUrl}` : `Subdomain=${subdomain}`}`);
}

console.log('Starting Plexus Dev Stack...');
console.log(`  PORT:         ${process.env.PORT}`);
if (process.env.PLEXUS_POSTGRES_DRIVER === 'pglite') {
  console.log(`  DB Driver:    PGlite`);
  console.log(`  DB Data Dir:  ${process.env.PLEXUS_PGLITE_DATA_DIR}`);
} else {
  console.log(`  DATABASE_URL: ${process.env.DATABASE_URL}`);
}
console.log(`  ADMIN_KEY:    ${process.env.ADMIN_KEY}`);

// --- Profile mode: CPU profiling without watcher ---

if (profileMode) {
  const profDir = join(process.cwd(), '.prof');
  console.log('\n--- PROFILE MODE: CPU profiling enabled ---');
  console.log(`Profiles will be written to: ${profDir}`);
  console.log('  - CPU profiling (100μs interval for higher precision)');
  console.log('Press Ctrl+C to stop profiling.\n');

  await new Promise<void>((resolve, reject) => {
    const proc = nodeSpawn(
      'bun',
      [
        'run',
        '--cpu-prof',
        '--cpu-prof-md',
        '--cpu-prof-interval=100',
        '--cpu-prof-dir',
        profDir,
        'src/index.ts',
      ],
      {
        cwd: BACKEND_DIR,
        env: { ...process.env },
        stdio: 'inherit',
      }
    );
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Backend exited with code ${code}`));
    });
    proc.on('error', reject);
  }).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
  process.exit(0);
}

function spawnBackend(): ChildProcess {
  return spawnManaged('bun', ['run', '--watch', '--no-clear-screen', 'src/index.ts'], BACKEND_DIR);
}

let backend = spawnBackend();

console.log('[Frontend] Starting builder (watch mode)...');
const frontend = spawnManaged('bun', ['run', 'dev'], FRONTEND_DIR);

console.log(`Backend: http://localhost:${process.env.PORT}`);
console.log('Watching for changes...');

// --- Auto-open browser (unless --no-open) ---

function openBrowser(url: string) {
  try {
    if (process.platform === 'win32') {
      nodeSpawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      const child = nodeSpawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], {
        detached: true,
        stdio: 'ignore',
      });
      child.on('error', () => {});
      child.unref();
    }
  } catch {
    // Silently ignore if browser opener is not available
  }
}

if (!noOpen) {
  (async () => {
    console.log(`\n[dev] Waiting for server at http://localhost:${process.env.PORT}...`);
    try {
      await waitForServer();
      const url = `http://localhost:${process.env.PORT}/ui/login?token=${encodeURIComponent(process.env.ADMIN_KEY!)}`;
      console.log(`[dev] Server ready. Opening browser: ${url}`);
      openBrowser(url);
    } catch (err) {
      console.error(`[dev] ${err instanceof Error ? err.message : err}. Not opening browser.`);
    }
  })();
}

// --- Full mode: wait for server ready, then run prep-dev ---

async function waitForServer(timeout = 30000): Promise<void> {
  const url = `http://localhost:${process.env.PORT}`;
  const start = Date.now();
  let consecutiveOk = 0;
  const requiredOk = 5;
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) {
        consecutiveOk++;
        if (consecutiveOk >= requiredOk) return;
      } else {
        consecutiveOk = 0;
      }
    } catch {
      consecutiveOk = 0;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server did not become ready within ${timeout / 1000}s`);
}

(async () => {
  try {
    await waitForServer();
    startFrpc();
  } catch (error) {
    console.warn(
      `[frpc] Tunnel disabled: server did not become ready (${error instanceof Error ? error.message : 'unknown error'}).`
    );
  }
})();

if (fullMode) {
  (async () => {
    if (!shouldLoadFullDevData) {
      console.log('[full] Existing dev database found. Skipping prep-dev restore.');
      return;
    }
    if (savedBackupIsNewerThanLastRestore()) {
      console.log('[full] Saved backup is newer than last restore. Reloading dev data...');
    }

    console.log(`\n[full] Waiting for server at http://localhost:${process.env.PORT}...`);
    try {
      await waitForServer();
      console.log('[full] Server ready. Loading dev data...\n');
    } catch (err) {
      console.error(`[full] ${err instanceof Error ? err.message : err}. Skipping prep-dev.`);
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const proc = nodeSpawn('bun', ['run', 'prep-dev'], {
        cwd: process.cwd(),
        // Force prep-dev to target *this* server: override PLEXUS_PORT/PLEXUS_ADMIN_KEY
        // rather than letting prep-dev re-derive them (Bun reloads .env fresh per
        // process, so a stale PLEXUS_ADMIN_KEY in .env would otherwise take priority
        // over the port/key this server actually started with).
        env: {
          ...process.env,
          PLEXUS_PORT: process.env.PORT,
          PLEXUS_ADMIN_KEY: process.env.ADMIN_KEY,
        },
        stdio: 'inherit',
      });
      proc.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`prep-dev exited with code ${code}`))
      );
      proc.on('error', reject);
    })
      .then(writeRestoreMarker)
      .catch((err) => console.error(`[full] ${err instanceof Error ? err.message : err}`));

    // prep-dev triggers a server restart after restore, so wait for it to come back up
    console.log('[full] Waiting for server to restart after restore...');
    try {
      await waitForServer();
      console.log('[full] Server restarted and ready.\n');
      if (!noOpen) {
        const url = `http://localhost:${process.env.PORT}/ui/login?token=${encodeURIComponent(process.env.ADMIN_KEY!)}`;
        console.log(`[full] Opening browser: ${url}`);
        openBrowser(url);
      }
    } catch (err) {
      console.error(`[full] ${err instanceof Error ? err.message : err}.`);
    }
  })();
}

// Keep the event loop alive. The child handles already do this, but
// the interval acts as a safety net in case Bun optimises them away.
const keepalive = setInterval(() => {}, 60000);
keepalive.unref();

// --- Signal handling ---

process.on('SIGINT', () => {
  console.log('\nStopping...');
  killAll();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nStopping (SIGTERM)...');
  killAll();
  process.exit(0);
});

process.on('SIGHUP', () => {
  console.log('\nStopping (SIGHUP)...');
  killAll();
  process.exit(0);
});

// SIGUSR1 — kill and respawn the backend (used by clear-dev.ts after DB wipe).
// We use SIGUSR1 instead of SIGHUP because SIGHUP is the standard signal
// for "your controlling terminal went away" and should trigger shutdown.
process.on('SIGUSR1', () => {
  if (isShuttingDown) return;
  console.log('\n[dev] SIGUSR1 received — restarting backend...');
  try {
    process.kill(-backend.pid!, 'SIGKILL');
  } catch {
    // already dead
  }
  const idx = childPgids.indexOf(backend.pid!);
  if (idx >= 0) childPgids.splice(idx, 1);
  backend = spawnBackend();
  console.log('[dev] Backend restarted.');
});
