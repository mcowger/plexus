import { join, basename } from 'path';
import { tmpdir } from 'os';
import { createServer } from 'net';
import { writeFileSync, unlinkSync } from 'fs';
import { spawn as nodeSpawn, type ChildProcess } from 'child_process';

// --- Dev defaults (only applied when not already set in environment) ---

const dirName = basename(process.cwd());

function readOptionValue(args: string[], index: number, option: string) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    console.error(`Missing value for ${option}`);
    process.exit(1);
  }
  return value;
}

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];

  if (arg.startsWith('DATABASE_URL=')) {
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
    console.error('   or: bun run dev [--database-url ...] [--port ...] [--admin-key ...]');
    process.exit(1);
  }
}

// Stable port derived from the worktree directory name, range 10000-19999.
// Two worktrees running simultaneously will land on different ports automatically.
// Override with: PORT=4000 bun run dev
if (!process.env.PORT) {
  let hash = 5381;
  for (let i = 0; i < dirName.length; i++) {
    hash = (hash * 33) ^ dirName.charCodeAt(i);
  }
  process.env.PORT = String(10000 + (Math.abs(hash) % 10000));
}

// Per-worktree SQLite file — persists across restarts, isolated per branch.
// Override with: DATABASE_URL=postgresql://... bun run dev
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = `sqlite://${join(tmpdir(), `plexus-${dirName}.db`)}`;
}

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

// --- Startup ---

const BACKEND_DIR = join(process.cwd(), 'packages/backend');
const FRONTEND_DIR = join(process.cwd(), 'packages/frontend');

console.log('Starting Plexus Dev Stack...');
console.log(`  PORT:         ${process.env.PORT}`);
console.log(`  DATABASE_URL: ${process.env.DATABASE_URL}`);
console.log(`  ADMIN_KEY:    ${process.env.ADMIN_KEY}`);

// --- Process management ---
//
// Bun's --watch processes trap SIGINT and *restart* instead of exiting.
// So on shutdown we must SIGKILL them to force-terminate. Otherwise they
// become orphaned and accumulate, eventually exhausting memory.
//
// Each child is spawned in its own process group (detached: true / setsid)
// so that process.kill(-pgid) kills the entire subtree including
// grandchildren spawned by --watch restarts.
//
// Note: terminal close (SIGHUP) is not reliably delivered to this process
// because Bun may not propagate it. If you close your terminal without
// Ctrl+C, run: pkill -f "bun run" to clean up.

const WIN = process.platform === 'win32';

const childPgids: number[] = [];
let isShuttingDown = false;

function spawnManaged(args: string[], cwd: string): ChildProcess {
  const proc = nodeSpawn('bun', args, {
    cwd,
    env: { ...process.env },
    stdio: 'inherit',
    detached: true, // own process group → can kill -pgid
    ...(WIN ? { shell: true } : {}),
  });
  // Don't unref() — we need the child handles to keep the event loop alive.
  // Without them, Bun sees no pending work and exits immediately.
  childPgids.push(proc.pid!);
  return proc;
}

function killAll() {
  if (isShuttingDown) return;
  isShuttingDown = true;

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

function spawnBackend(): ChildProcess {
  return spawnManaged(['run', '--watch', '--no-clear-screen', 'src/index.ts'], BACKEND_DIR);
}

let backend = spawnBackend();

console.log('[Frontend] Starting builder (watch mode)...');
const frontend = spawnManaged(['run', 'dev'], FRONTEND_DIR);

console.log(`Backend: http://localhost:${process.env.PORT}`);
console.log('Watching for changes...');

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

// Synchronous fallback — runs even if the signal handler doesn't complete.
process.on('exit', killAll);
