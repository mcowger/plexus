import { logger } from '../../utils/logger';
import { McpServerConfig } from '../../types/mcp';

export type LocalMcpStatus = 'stopped' | 'starting' | 'running' | 'failed';

export interface LocalMcpRuntimeStatus {
  serverName: string;
  status: LocalMcpStatus;
  pid: number | null;
  url: string | null;
  lastError: string | null;
  startedAt: string | null;
  exitedAt: string | null;
}

interface LocalProcessState {
  status: LocalMcpStatus;
  process: Bun.Subprocess<'pipe', 'pipe', 'pipe'> | null;
  operation: Promise<unknown>;
  startupController: AbortController | null;
  lifecycleVersion: number;
  configFingerprint: string | null;
  logs: string[];
  lastError: string | null;
  startedAt: string | null;
  exitedAt: string | null;
}

const MAX_LOG_LINES = 500;
const SAFE_INHERITED_ENV_KEYS = [
  'PATH',
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'XDG_CACHE_HOME',
  'BUN_INSTALL',
  'UV_CACHE_DIR',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
];

class McpProcessManager {
  private states = new Map<string, LocalProcessState>();

  getLocalUrl(config: McpServerConfig): string | null {
    if (config.mode !== 'local_http') return null;
    return 'http://127.0.0.1:' + config.port + (config.path || '/mcp');
  }

  async ensureRunning(serverName: string, config: McpServerConfig): Promise<void> {
    if (config.mode !== 'local_http') return;
    const version = this.getState(serverName).lifecycleVersion;
    return this.enqueue(serverName, () => this.ensureRunningInternal(serverName, config, version));
  }

  private async ensureRunningInternal(
    serverName: string,
    config: McpServerConfig,
    version: number
  ): Promise<void> {
    const state = this.getState(serverName);
    if (state.lifecycleVersion !== version) throw new Error('Local MCP startup cancelled');
    const fingerprint = this.getConfigFingerprint(config);
    if (state.process) {
      if (state.status === 'running' && state.configFingerprint === fingerprint) return;
      await this.stopInternal(serverName);
    }
    if (state.lifecycleVersion !== version) throw new Error('Local MCP startup cancelled');
    const controller = new AbortController();
    state.startupController = controller;
    try {
      await this.startInternal(serverName, config, fingerprint, controller.signal);
    } finally {
      state.startupController = null;
    }
  }

  async start(serverName: string, config: McpServerConfig): Promise<LocalMcpRuntimeStatus> {
    if (config.mode !== 'local_http') throw new Error('MCP server is not local_http');
    const version = this.getState(serverName).lifecycleVersion;
    return this.enqueue(serverName, async () => {
      await this.ensureRunningInternal(serverName, config, version);
      return this.getStatus(serverName, config);
    });
  }

  async stop(serverName: string): Promise<LocalMcpRuntimeStatus> {
    const state = this.getState(serverName);
    state.lifecycleVersion++;
    state.startupController?.abort(new Error('Local MCP startup cancelled'));
    return this.enqueue(serverName, () => this.stopInternal(serverName));
  }

  private async stopInternal(serverName: string): Promise<LocalMcpRuntimeStatus> {
    const state = this.getState(serverName);
    const child = state.process;
    if (child) {
      try {
        logger.info(`[mcp-local:${serverName}] stopping local MCP process`, { pid: child.pid });
        child.kill('SIGTERM');
        if (!(await this.waitForExit(child, 3000))) {
          child.kill('SIGKILL');
          if (!(await this.waitForExit(child, 1000))) {
            throw new Error('Local MCP process did not exit after SIGKILL');
          }
        }
        if (state.process === child) state.process = null;
      } catch (error) {
        state.status = 'failed';
        state.lastError = (error as Error).message;
        logger.warn(`[mcp-local:${serverName}] failed to stop local MCP process`, error);
        this.appendLog(state, 'Failed to stop process: ' + state.lastError);
        throw error;
      }
    }
    state.status = 'stopped';
    state.lastError = null;
    state.exitedAt = new Date().toISOString();
    return this.getStatus(serverName);
  }

  async restart(serverName: string, config: McpServerConfig): Promise<LocalMcpRuntimeStatus> {
    if (config.mode !== 'local_http') throw new Error('MCP server is not local_http');
    const state = this.getState(serverName);
    const version = ++state.lifecycleVersion;
    state.startupController?.abort(new Error('Local MCP startup cancelled'));
    return this.enqueue(serverName, async () => {
      await this.stopInternal(serverName);
      await this.ensureRunningInternal(serverName, config, version);
      return this.getStatus(serverName, config);
    });
  }

  private enqueue<T>(serverName: string, operation: () => Promise<T>): Promise<T> {
    const state = this.getState(serverName);
    const result = state.operation.then(operation);
    // Failed operations must not prevent a later stop or restart.
    state.operation = result.catch(() => {});
    return result;
  }

  private async waitForExit(child: Bun.Subprocess, timeoutMs: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        child.exited.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async resetForTesting(): Promise<void> {
    await this.stopAll();
    this.states.clear();
  }

  getStatus(serverName: string, config?: McpServerConfig): LocalMcpRuntimeStatus {
    const state = this.getState(serverName);
    return {
      serverName,
      status: state.status,
      pid: state.process?.pid ?? null,
      url: config ? this.getLocalUrl(config) : null,
      lastError: state.lastError,
      startedAt: state.startedAt,
      exitedAt: state.exitedAt,
    };
  }

  getLogs(serverName: string): string[] {
    return [...this.getState(serverName).logs];
  }

  async stopAll(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.states.keys()].map((serverName) => this.stop(serverName))
    );
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length) {
      throw new AggregateError(
        failures.map((result) => result.reason),
        'Failed to stop local MCP processes'
      );
    }
  }

  private async startInternal(
    serverName: string,
    config: McpServerConfig,
    configFingerprint: string,
    signal: AbortSignal
  ): Promise<void> {
    if (config.mode !== 'local_http') return;
    const state = this.getState(serverName);
    state.status = 'starting';
    state.lastError = null;
    state.exitedAt = null;
    state.configFingerprint = configFingerprint;

    const args = [config.package, ...(config.args || [])].map((arg) =>
      arg.replaceAll('{{PORT}}', String(config.port)).replaceAll('{{HOST}}', '127.0.0.1')
    );
    const configuredEnv = config.env || Object.create(null);
    const configuredEnvKeys = Object.keys(configuredEnv);
    const command = [config.launcher, ...args];
    this.appendLog(state, 'Starting: ' + command.join(' '));
    logger.info(`[mcp-local:${serverName}] starting local MCP process`, {
      command: config.launcher,
      args,
      port: config.port,
      path: config.path || '/mcp',
      startupTimeoutMs: config.startup_timeout_ms || 30000,
      envKeys: configuredEnvKeys,
    });

    let child: Bun.Subprocess<'pipe', 'pipe', 'pipe'>;
    try {
      child = Bun.spawn(command, {
        stdout: 'pipe',
        stderr: 'pipe',
        stdin: 'pipe',
        env: this.buildChildEnv(config),
      });
    } catch (error) {
      state.status = 'failed';
      state.lastError = (error as Error).message;
      logger.error(`[mcp-local:${serverName}] failed to spawn local MCP process`, error);
      this.appendLog(state, 'Spawn failed: ' + state.lastError);
      throw error;
    }

    state.process = child;
    state.startedAt = new Date().toISOString();
    logger.info(`[mcp-local:${serverName}] local MCP process spawned`, { pid: child.pid });
    this.consumeStream(state, child.stdout, 'stdout');
    this.consumeStream(state, child.stderr, 'stderr');

    child.exited.then((code) => {
      if (state.process === child) {
        state.startupController?.abort(new Error('Local MCP process exited before readiness'));
        state.process = null;
        state.status = code === 0 ? 'stopped' : 'failed';
        state.lastError = code === 0 ? null : 'Process exited with code ' + code;
        state.exitedAt = new Date().toISOString();
      }
      const level = code === 0 ? 'info' : 'warn';
      logger[level](`[mcp-local:${serverName}] local MCP process exited`, {
        code,
        previousStatus: state.status,
      });
      this.appendLog(state, 'Process exited with code ' + code);
    });

    try {
      await this.waitForReady(config, signal);
      signal.throwIfAborted();
      if (state.process !== child) throw new Error('Local MCP process exited before readiness');
      if (state.process === child) {
        state.status = 'running';
        logger.info(`[mcp-local:${serverName}] local MCP server is ready`, {
          pid: child.pid,
          url: this.getLocalUrl(config),
        });
        this.appendLog(state, 'Ready at ' + this.getLocalUrl(config));
      }
    } catch (error) {
      state.status = 'failed';
      state.lastError = (error as Error).message;
      logger.error(`[mcp-local:${serverName}] local MCP server startup failed`, error);
      this.appendLog(state, 'Startup failed: ' + state.lastError);
      try {
        await this.stopInternal(serverName);
      } catch (stopError) {
        logger.warn(`[mcp-local:${serverName}] startup cleanup failed`, stopError);
      }
      state.status = 'failed';
      state.lastError = (error as Error).message;
      throw error;
    }
  }

  private async waitForReady(config: McpServerConfig, signal: AbortSignal): Promise<void> {
    const url = this.getLocalUrl(config);
    if (!url || config.mode !== 'local_http') return;
    const deadline = Date.now() + (config.startup_timeout_ms || 30000);
    let lastError = '';
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      const controller = new AbortController();
      const abort = () => controller.abort(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(
        () => controller.abort(new Error('Readiness request timed out')),
        Math.min(1000, deadline - Date.now())
      );
      try {
        const response = await fetch(url, { method: 'GET', signal: controller.signal });
        // GET may return 405 on a healthy HTTP MCP endpoint. Headers are enough;
        // never retain a response body (which may be an indefinite SSE stream).
        void response.body?.cancel().catch(() => {});
        if (response.status < 500) return;
        lastError = 'HTTP ' + response.status;
      } catch (error) {
        lastError = (error as Error).message;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        controller.abort();
      }
      signal.throwIfAborted();
      const remaining = deadline - Date.now();
      if (remaining > 0) {
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(retryTimer);
            signal.removeEventListener('abort', done);
            resolve();
          };
          const retryTimer = setTimeout(done, Math.min(500, remaining));
          signal.addEventListener('abort', done, { once: true });
        });
      }
    }
    signal.throwIfAborted();
    throw new Error('Local MCP server did not become ready: ' + lastError);
  }

  private buildChildEnv(config: McpServerConfig): Record<string, string> {
    const env: Record<string, string> = Object.create(null);
    for (const key of SAFE_INHERITED_ENV_KEYS) {
      const value = process.env[key];
      if (value !== undefined) env[key] = value;
    }
    if (config.mode === 'local_http' && config.env) Object.assign(env, config.env);
    if (config.mode === 'local_http') env.PORT = String(config.port);
    env.HOST = '127.0.0.1';
    return env;
  }

  private getConfigFingerprint(config: McpServerConfig): string {
    if (config.mode !== 'local_http') return '';
    return JSON.stringify({
      launcher: config.launcher,
      package: config.package,
      args: config.args || [],
      env: config.env || Object.create(null),
      port: config.port,
      path: config.path || '/mcp',
      startup_timeout_ms: config.startup_timeout_ms || 30000,
    });
  }

  private consumeStream(
    state: LocalProcessState,
    stream: ReadableStream<Uint8Array>,
    label: string
  ): void {
    const decoder = new TextDecoder();
    void (async () => {
      const reader = stream.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            const text = decoder.decode(value).trimEnd();
            this.appendLog(state, '[' + label + '] ' + text);
            if (label === 'stderr') {
              logger.warn(`[mcp-local:${label}] ${text}`);
            } else {
              logger.info(`[mcp-local:${label}] ${text}`);
            }
          }
        }
      } catch (error) {
        logger.silly('Local MCP log stream error: ' + (error as Error).message);
      } finally {
        reader.releaseLock();
      }
    })();
  }

  private appendLog(state: LocalProcessState, line: string): void {
    state.logs.push(new Date().toISOString() + ' ' + line);
    if (state.logs.length > MAX_LOG_LINES) state.logs.splice(0, state.logs.length - MAX_LOG_LINES);
  }

  private getState(serverName: string): LocalProcessState {
    let state = this.states.get(serverName);
    if (!state) {
      state = {
        status: 'stopped',
        process: null,
        operation: Promise.resolve(),
        startupController: null,
        lifecycleVersion: 0,
        configFingerprint: null,
        logs: [],
        lastError: null,
        startedAt: null,
        exitedAt: null,
      };
      this.states.set(serverName, state);
    }
    return state;
  }
}

export const mcpProcessManager = new McpProcessManager();
