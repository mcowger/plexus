/**
 * dev-agent.ts
 *
 * Agent & contributor launcher for Plexus workspace scripts.
 *
 * Supports Paseo CLI managed execution when available (`paseo script start/stop/ls`),
 * with a zero-config fallback to direct background process execution for contributors
 * who do not use Paseo.
 *
 * Features:
 *   - Universal target support (defaults to `dev:full`, supports any target in paseo.json)
 *   - Idempotent: if target is already running, attaches to live logs
 *   - Tails live logs via Paseo terminal capture or local log tailing (pass --detach to skip)
 *
 * Usage:
 *   bun run dev:agent [target]           # start/attach target & stream logs (default: dev:full)
 *   bun run dev:agent [target] --detach  # start detached and return after health check
 *   bun run dev:agent stop [target]      # stop background execution for target
 *   bun run dev:agent stop --all        # stop all background stacks for this worktree
 */

import { basename, join } from 'path';
import { tmpdir } from 'os';
import { openSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { spawn } from 'child_process';
import { deriveDevPort } from './dev-port-allocator';
import {
  isPaseoScriptAvailable,
  startPaseoScript,
  stopPaseoScript,
  attachPaseoTerminal,
  type WorkspaceScriptPayload,
} from './lib/paseo';
import { loadPaseoScriptConfig, resolveFallbackCommand } from './lib/script-runner';

const dirName = basename(process.cwd());

const rawArgs = process.argv.slice(2);
const isStop = rawArgs[0] === 'stop';
const detach = rawArgs.includes('--detach') || rawArgs.includes('--no-wait');
const stopAll = isStop && rawArgs.includes('--all');

function sanitizeTarget(name?: string): string {
  if (!name || name.startsWith('--')) return 'dev:full';
  return name;
}

const targetName = isStop ? sanitizeTarget(rawArgs[1]) : sanitizeTarget(rawArgs[0]);

function derivePort(target: string): string {
  if (process.env.PORT) return process.env.PORT;
  return deriveDevPort(process.cwd(), target);
}

const PORT = derivePort(targetName);
const ADMIN_KEY = process.env.ADMIN_KEY ?? 'password';
const CONSECUTIVE_OK = 3;
const READY_TIMEOUT_MS = 180_000;

function getPidFile(target: string): string {
  return join(tmpdir(), `plexus-${target.replace(/[:/]/g, '_')}-${dirName}.pid`);
}

function getLogFile(target: string): string {
  return join(tmpdir(), `plexus-dev-${target.replace(/[:/]/g, '_')}-${dirName}.log`);
}

// Standard fallback PID file from previous dev-agent versions
const LEGACY_PID_FILE = join(tmpdir(), `plexus-${dirName}.pid`);

async function isHealthy(port = PORT): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForHealthy(port = PORT, timeoutMs = READY_TIMEOUT_MS): Promise<boolean> {
  const start = Date.now();
  let ok = 0;
  while (Date.now() - start < timeoutMs) {
    if (await isHealthy(port)) {
      if (++ok >= CONSECUTIVE_OK) return true;
    } else {
      ok = 0;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function printReady(target: string, port: string | number, proxyUrl?: string, prefix = 'Ready.') {
  const baseUrl = `http://localhost:${port}`;
  const loginUrl = `${baseUrl}/ui/login?token=${encodeURIComponent(ADMIN_KEY)}`;
  console.log(`\n${prefix}`);
  console.log(`TARGET=${target}`);
  console.log(`PORT=${port}`);
  console.log(`ADMIN_KEY=${ADMIN_KEY}`);
  console.log(`URL=${loginUrl}`);
  if (proxyUrl) {
    console.log(`PROXY_URL=${proxyUrl}`);
  }
}

// --- STOP ACTION ---

if (isStop) {
  let stoppedAny = false;

  if (isPaseoScriptAvailable(targetName)) {
    if (stopPaseoScript(targetName)) {
      console.log(`Stopped Paseo script "${targetName}" for "${dirName}".`);
      stoppedAny = true;
    }
  }

  const pidFiles = stopAll ? [getPidFile(targetName), LEGACY_PID_FILE] : [getPidFile(targetName)];

  for (const pidFile of pidFiles) {
    if (existsSync(pidFile)) {
      try {
        const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
        try {
          process.kill(-pid, 'SIGTERM');
        } catch {
          process.kill(pid, 'SIGTERM');
        }
        console.log(`Stopped standalone dev process for "${dirName}" (pid ${pid}).`);
        stoppedAny = true;
      } catch {
        console.log(`Cleaned stale pid file for "${dirName}".`);
      } finally {
        try {
          unlinkSync(pidFile);
        } catch {}
      }
    }
  }

  if (!stoppedAny) {
    console.log(`No running dev stack found for target "${targetName}" in "${dirName}".`);
  }
  process.exit(0);
}

// --- START / ATTACH ACTION ---

// Path A: Paseo Script Runner
if (isPaseoScriptAvailable(targetName)) {
  console.log(`Using Paseo workspace script launcher for target "${targetName}"...`);
  const scriptPayload: WorkspaceScriptPayload | null = startPaseoScript(targetName);

  if (scriptPayload) {
    const servicePort = scriptPayload.port ? String(scriptPayload.port) : PORT;
    const isService = scriptPayload.type === 'service' || Boolean(scriptPayload.port);

    if (isService) {
      console.log(`Waiting for ${targetName} to become healthy on port ${servicePort}...`);
      if (await waitForHealthy(servicePort)) {
        printReady(
          targetName,
          servicePort,
          scriptPayload.proxyUrl,
          `Target "${targetName}" ready (Paseo managed).`
        );
      } else {
        console.warn(`Warning: Target "${targetName}" did not respond to /health within timeout.`);
      }
    } else {
      console.log(`Executed Paseo command target "${targetName}".`);
    }

    if (detach) {
      process.exit(0);
    }

    if (scriptPayload.terminalId) {
      console.log(
        `\nAttaching to Paseo terminal logs (terminalId: ${scriptPayload.terminalId}). Press Ctrl+C to detach.\n`
      );
      const child = attachPaseoTerminal(scriptPayload.terminalId);
      child.on('exit', (code) => process.exit(code ?? 0));
      await new Promise(() => {}); // Keep alive until attached process exits
    } else {
      process.exit(0);
    }
  } else {
    console.warn(
      `Paseo failed to start "${targetName}". Falling back to direct process execution...`
    );
  }
}

// Path B: Fallback Direct Process Execution

const fallbackPort = PORT;
const pidFile = getPidFile(targetName);
const logFile = getLogFile(targetName);

if (await isHealthy(fallbackPort)) {
  printReady(
    targetName,
    fallbackPort,
    undefined,
    `Dev stack already running on port ${fallbackPort} — reusing it.`
  );
  if (detach) {
    process.exit(0);
  }

  if (existsSync(logFile)) {
    console.log(`\nAttaching to log output (${logFile}). Press Ctrl+C to detach.\n`);
    const tail = spawn('tail', ['-f', logFile], { stdio: 'inherit' });
    tail.on('exit', (code) => process.exit(code ?? 0));
    await new Promise(() => {});
  } else {
    process.exit(0);
  }
}

const targetConfig = loadPaseoScriptConfig(targetName);
const logFd = openSync(logFile, 'a');

let childProcess;
if (targetConfig) {
  const resolvedCmd = resolveFallbackCommand(targetConfig, fallbackPort);
  const execCmd = `exec env ${resolvedCmd}`;
  console.log(`Starting target "${targetName}" via paseo.json fallback: ${resolvedCmd}`);
  childProcess = spawn('sh', ['-c', execCmd], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: fallbackPort, ADMIN_KEY },
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
} else {
  console.log(`Starting target "${targetName}" via default fallback launcher...`);
  childProcess = spawn('bun', ['run', 'dev', '--full', '--no-open'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: fallbackPort, ADMIN_KEY },
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
}

writeFileSync(pidFile, String(childProcess.pid));
childProcess.unref();

console.log(`Started "${targetName}" in background (logs: ${logFile})...`);

if (await waitForHealthy(fallbackPort)) {
  printReady(targetName, fallbackPort, undefined, `Target "${targetName}" ready.`);
  if (detach) {
    process.exit(0);
  }

  console.log(`\nAttaching to log output (${logFile}). Press Ctrl+C to detach.\n`);
  const tail = spawn('tail', ['-f', logFile], { stdio: 'inherit' });
  tail.on('exit', (code) => process.exit(code ?? 0));
  await new Promise(() => {});
} else {
  console.error(
    `Target "${targetName}" did not become healthy within ${READY_TIMEOUT_MS / 1000}s. Recent log:`
  );
  try {
    console.error(readFileSync(logFile, 'utf8').split('\n').slice(-25).join('\n'));
  } catch {}
  console.error(`\nInspect ${logFile} or stop with: bun run dev:stop ${targetName}`);
  process.exit(1);
}
