/**
 * dev-agent.ts
 *
 * Agent-friendly launcher for the full dev stack. Unlike `bun run dev:full`
 * (which runs in the foreground under a file watcher and never returns), this
 * starts the stack detached, waits only until the server is healthy, then exits
 * 0 while the stack keeps running in the background. This lets an agent boot the
 * app and immediately move on to driving it, without managing backgrounding.
 *
 * Usage:
 *   bun run dev:agent            # start (or reuse) and block until healthy, then return
 *   bun run dev:agent --no-wait  # start detached and return immediately (don't wait for health)
 *   bun run dev:agent stop       # stop the background dev stack for this worktree
 *
 * Worktree-safe: the port, log path, and pid file are all derived from the
 * worktree directory name, matching scripts/dev.ts.
 */

import { basename, join } from 'path';
import { tmpdir } from 'os';
import { openSync, existsSync, readFileSync } from 'fs';
import { spawn } from 'child_process';

const dirName = basename(process.cwd());

function derivePort(): string {
  if (process.env.PORT) return process.env.PORT;
  let hash = 5381;
  for (let i = 0; i < dirName.length; i++) {
    hash = (hash * 33) ^ dirName.charCodeAt(i);
  }
  return String(10000 + (Math.abs(hash) % 10000));
}

const PORT = derivePort();
const ADMIN_KEY = process.env.ADMIN_KEY ?? 'password';
const BASE = `http://localhost:${PORT}`;
const LOGIN_URL = `${BASE}/ui/login?token=${encodeURIComponent(ADMIN_KEY)}`;
const LOG_FILE = join(tmpdir(), `plexus-dev-${dirName}.log`);
const PID_FILE = join(tmpdir(), `plexus-${dirName}.pid`);

const READY_TIMEOUT_MS = 180_000; // first boot also seeds data + restarts
const CONSECUTIVE_OK = 3; // require stable health to ride out the post-seed restart

async function isHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForHealthy(timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  let ok = 0;
  while (Date.now() - start < timeoutMs) {
    if (await isHealthy()) {
      if (++ok >= CONSECUTIVE_OK) return true;
    } else {
      ok = 0;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function printReady(prefix: string) {
  console.log(prefix);
  console.log(`PORT=${PORT}`);
  console.log(`ADMIN_KEY=${ADMIN_KEY}`);
  console.log(`URL=${LOGIN_URL}`);
  console.log(`LOG=${LOG_FILE}`);
}

const subcommand = process.argv[2];

if (subcommand === 'stop') {
  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`Stopped dev stack for "${dirName}" (pid ${pid}).`);
    } catch {
      console.log(`No live dev stack for "${dirName}" (stale pid file).`);
    }
  } else {
    console.log(`No dev stack running for "${dirName}".`);
  }
  process.exit(0);
}

// --- start (default) ---

if (await isHealthy()) {
  printReady('Dev stack already running — reusing it.');
  process.exit(0);
}

const noWait = process.argv.includes('--no-wait');
const logFd = openSync(LOG_FILE, 'a');

const child = spawn('bun', ['run', 'scripts/dev.ts', '--full', '--no-open'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT, ADMIN_KEY },
  detached: true, // own session — survives after this launcher exits
  stdio: ['ignore', logFd, logFd],
});
child.unref();

console.log(`Starting Plexus dev stack in background (logs: ${LOG_FILE})...`);

if (noWait) {
  console.log(`PORT=${PORT}`);
  console.log(`Poll ${BASE}/health until ready, then log in at ${LOGIN_URL}`);
  process.exit(0);
}

if (await waitForHealthy(READY_TIMEOUT_MS)) {
  printReady('Ready.');
  process.exit(0);
}

console.error(`Server did not become healthy within ${READY_TIMEOUT_MS / 1000}s. Recent log:`);
try {
  console.error(readFileSync(LOG_FILE, 'utf8').split('\n').slice(-25).join('\n'));
} catch {}
console.error(
  `\nThe stack may still be starting — inspect ${LOG_FILE} or stop it with: bun run dev:stop`
);
process.exit(1);
