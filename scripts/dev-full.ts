/**
 * dev-full.ts
 *
 * Starts the dev server and loads saved staging data.
 * Combines `bun run dev` + `bun run prep-dev` in one command.
 *
 * Usage:
 *   bun run dev:full              # Start dev server and load saved data
 *   bun run dev:full --save       # Download fresh from staging first
 *   bun run dev:full --live       # Use staging data directly (one-off)
 */

import { createServer } from 'net';
import { spawn as nodeSpawn, type ChildProcess } from 'child_process';
import { basename } from 'path';

const args = process.argv.slice(2);
const shouldSave = args.includes('--save');
const shouldUseLive = args.includes('--live');

// Derive port the same way dev.ts does
const deriveDevPort = (): string => {
  const dirName = basename(process.cwd());
  let hash = 5381;
  for (let i = 0; i < dirName.length; i++) {
    hash = (hash * 33) ^ dirName.charCodeAt(i);
  }
  return String(10000 + (Math.abs(hash) % 10000));
};

const PORT = parseInt(process.env.PORT ?? deriveDevPort());
const BASE_URL = `http://localhost:${PORT}`;

const WIN = process.platform === 'win32';
const childPgids: number[] = [];
let isShuttingDown = false;

function spawnManaged(args: string[], cwd: string): ChildProcess {
  const proc = nodeSpawn('bun', args, {
    cwd,
    env: { ...process.env },
    stdio: 'inherit',
    detached: true,
    ...(WIN ? { shell: true } : {}),
  });
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
}

async function waitForServer(url: string, timeout = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(`${url}/v0/health`, { method: 'GET' });
      if (res.ok) return;
    } catch {
      // server not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Server did not become ready in time');
}

async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║       Plexus Dev Full Stack            ║');
  console.log('╚════════════════════════════════════════╝\n');

  // Start the dev server in background
  console.log(`Starting dev server on port ${PORT}...`);
  const devProc = spawnManaged(['run', 'dev'], process.cwd());
  childPgids.push(devProc.pid!);

  // Wait for server to be ready
  console.log(`Waiting for server at ${BASE_URL}...`);
  try {
    await waitForServer(BASE_URL);
    console.log('✓ Server is ready\n');
  } catch (err) {
    console.error('Server failed to start:', err);
    killAll();
    process.exit(1);
  }

  // Run prep-dev to load data
  console.log('Loading dev data...\n');
  const prepArgs =
    shouldUseLive || shouldSave
      ? ['run', 'scripts/prep-dev.ts', '--save']
      : ['run', 'scripts/prep-dev.ts'];

  await new Promise<void>((resolve, reject) => {
    const proc = nodeSpawn('bun', prepArgs, {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: 'inherit',
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`prep-dev exited with code ${code}`));
    });
    proc.on('error', reject);
  });

  console.log('\n✓ Dev stack ready!');
  console.log(`  Server: ${BASE_URL}`);
  console.log('  (Press Ctrl+C to stop)\n');

  // Keep alive
  const keepalive = setInterval(() => {}, 60000);
  keepalive.unref();

  // Handle shutdown
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
  process.on('exit', killAll);
}

main().catch((err) => {
  console.error(err);
  killAll();
  process.exit(1);
});
