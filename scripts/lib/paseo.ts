import { type ChildProcess, spawn, spawnSync } from 'child_process';

export interface WorkspaceScriptPayload {
  scriptName: string;
  type: 'service' | 'command';
  hostname?: string;
  port?: number;
  proxyUrl?: string;
  lifecycle: 'running' | 'stopped' | 'starting' | 'error';
  health?: 'healthy' | 'unhealthy' | 'starting' | '-';
  terminalId?: string;
  exitCode?: number | null;
}

/**
 * Checks if `paseo script` management is available in current cwd for the target script.
 */
export function isPaseoScriptAvailable(scriptName?: string, cwd = process.cwd()): boolean {
  try {
    const res = spawnSync('paseo', ['script', 'ls', '--json', '--cwd', cwd], {
      encoding: 'utf8',
      env: process.env,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (res.status !== 0 || !res.stdout) return false;

    const parsed = JSON.parse(res.stdout);
    const scripts: WorkspaceScriptPayload[] = parsed.data ?? parsed;
    if (!Array.isArray(scripts)) return false;

    return scriptName ? scripts.some((s) => s.scriptName === scriptName) : true;
  } catch {
    return false;
  }
}

/**
 * Retrieves status for all workspace scripts or a single script via Paseo.
 */
export function getPaseoScriptStatus(
  scriptName: string,
  cwd = process.cwd()
): WorkspaceScriptPayload | null {
  try {
    const res = spawnSync('paseo', ['script', 'ls', '--json', '--cwd', cwd], {
      encoding: 'utf8',
      env: process.env,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (res.status !== 0 || !res.stdout) return null;

    const parsed = JSON.parse(res.stdout);
    const scripts: WorkspaceScriptPayload[] = parsed.data ?? parsed;
    if (!Array.isArray(scripts)) return null;

    return scripts.find((s) => s.scriptName === scriptName) ?? null;
  } catch {
    return null;
  }
}

/**
 * Starts or retrieves a target workspace script via Paseo.
 * Idempotent: If already running, returns current script metadata & terminalId.
 */
export function startPaseoScript(
  scriptName: string,
  cwd = process.cwd()
): WorkspaceScriptPayload | null {
  try {
    const res = spawnSync('paseo', ['script', 'start', scriptName, '--json', '--cwd', cwd], {
      encoding: 'utf8',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (res.status === 0 && res.stdout) {
      const parsed = JSON.parse(res.stdout);
      return parsed.data ?? parsed;
    }

    // If script is already running, fetch and return current running script metadata
    const currentStatus = getPaseoScriptStatus(scriptName, cwd);
    if (
      currentStatus &&
      (currentStatus.lifecycle === 'running' || currentStatus.lifecycle === 'starting')
    ) {
      return currentStatus;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Stops a running target workspace script via Paseo.
 */
export function stopPaseoScript(scriptName: string, cwd = process.cwd()): boolean {
  try {
    const res = spawnSync('paseo', ['script', 'stop', scriptName, '--cwd', cwd], {
      encoding: 'utf8',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return res.status === 0;
  } catch {
    return false;
  }
}

/**
 * Attaches to a Paseo supervised terminal and pipes stdout/stderr in real-time.
 */
export function attachPaseoTerminal(terminalId: string): ChildProcess {
  return spawn('paseo', ['terminal', 'capture', terminalId, '--follow'], {
    env: process.env,
    stdio: 'inherit',
  });
}
