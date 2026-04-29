import { spawn } from 'bun';
import { join, basename } from 'path';
import { createServer } from 'net';

// --- Dev defaults (only applied when not already set in environment) ---

const dirName = basename(process.cwd());

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
  process.env.DATABASE_URL = `sqlite:///tmp/plexus-${dirName}.db`;
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

// --- Startup ---

const BACKEND_DIR = join(process.cwd(), 'packages/backend');
const FRONTEND_DIR = join(process.cwd(), 'packages/frontend');

console.log('Starting Plexus Dev Stack...');
console.log(`  PORT:         ${process.env.PORT}`);
console.log(`  DATABASE_URL: ${process.env.DATABASE_URL}`);
console.log(`  ADMIN_KEY:    ${process.env.ADMIN_KEY}`);

const backend = spawn(['bun', 'run', '--watch', '--no-clear-screen', 'src/index.ts'], {
  cwd: BACKEND_DIR,
  env: { ...process.env },
  stdout: 'inherit',
  stderr: 'inherit',
});

console.log('[Frontend] Starting builder (watch mode)...');
const frontend = spawn(['bun', 'run', 'dev'], {
  cwd: FRONTEND_DIR,
  stdout: 'inherit',
  stderr: 'inherit',
});

console.log(`Backend: http://localhost:${process.env.PORT}`);
console.log('Watching for changes...');

// Cleanup on exit
process.on('SIGINT', async () => {
  console.log('\nStopping...');
  backend.kill('SIGINT');
  frontend.kill('SIGINT');
  await Promise.all([backend.exited, frontend.exited]);
  process.exit(0);
});
