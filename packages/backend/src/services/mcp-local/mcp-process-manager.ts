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
  startPromise: Promise<void> | null;
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
    const state = this.getState(serverName);
    const configFingerprint = this.getConfigFingerprint(config);
    if (state.status === 'running' && state.process) {
      if (state.configFingerprint !== configFingerprint) {
        logger.info(`[mcp-local:${serverName}] local MCP config changed; restarting process`, {
          pid: state.process.pid,
          url: this.getLocalUrl(config),
        });
        await this.stop(serverName);
      } else {
        logger.debug(`[mcp-local:${serverName}] process already running`, {
          pid: state.process.pid,
          url: this.getLocalUrl(config),
        });
        return;
      }
    }
    if (state.startPromise) {
      logger.info(`[mcp-local:${serverName}] startup already in progress`);
      return state.startPromise;
    }
    logger.info(`[mcp-local:${serverName}] ensuring local MCP server is running`, {
      status: state.status,
      launcher: config.launcher,
      package: config.package,
      port: config.port,
      path: config.path || '/mcp',
    });
    state.startPromise = this.startInternal(serverName, config, configFingerprint).finally(() => {
      state.startPromise = null;
    });
    return state.startPromise;
  }

  async start(serverName: string, config: McpServerConfig): Promise<LocalMcpRuntimeStatus> {
    if (config.mode !== 'local_http') throw new Error('MCP server is not local_http');
    await this.ensureRunning(serverName, config);
    return this.getStatus(serverName, config);
  }

  async stop(serverName: string): Promise<LocalMcpRuntimeStatus> {
    const state = this.getState(serverName);
    const child = state.process;
    state.process = null;
    state.startPromise = null;
    if (child) {
      try {
        logger.info(`[mcp-local:${serverName}] stopping local MCP process`, { pid: child.pid });
        child.kill('SIGTERM');
        await Promise.race([child.exited, Bun.sleep(3000)]);
      } catch (error) {
        logger.warn(`[mcp-local:${serverName}] failed to stop local MCP process`, error);
        this.appendLog(state, 'Failed to stop process: ' + (error as Error).message);
      }
    } else {
      logger.info(`[mcp-local:${serverName}] stop requested but no process is running`, {
        status: state.status,
      });
    }
    state.status = 'stopped';
    state.exitedAt = new Date().toISOString();
    return this.getStatus(serverName);
  }

  async restart(serverName: string, config: McpServerConfig): Promise<LocalMcpRuntimeStatus> {
    await this.stop(serverName);
    return this.start(serverName, config);
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
    await Promise.all([...this.states.keys()].map((serverName) => this.stop(serverName)));
  }

  private async startInternal(
    serverName: string,
    config: McpServerConfig,
    configFingerprint: string
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
      await this.waitForReady(config);
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
      child.kill('SIGTERM');
      throw error;
    }
  }

  private async waitForReady(config: McpServerConfig): Promise<void> {
    const url = this.getLocalUrl(config);
    if (!url || config.mode !== 'local_http') return;
    const deadline = Date.now() + (config.startup_timeout_ms || 30000);
    let lastError = '';
    let attempts = 0;
    logger.info(`[mcp-local] waiting for local MCP server readiness`, {
      url,
      timeoutMs: config.startup_timeout_ms || 30000,
    });
    while (Date.now() < deadline) {
      attempts++;
      try {
        const response = await fetch(url, { method: 'GET' });
        if (response.status < 500) {
          logger.info(`[mcp-local] readiness check passed`, {
            url,
            status: response.status,
            attempts,
          });
          return;
        }
        lastError = 'HTTP ' + response.status;
      } catch (error) {
        lastError = (error as Error).message;
      }
      await Bun.sleep(500);
    }
    logger.warn(`[mcp-local] readiness check timed out`, { url, attempts, lastError });
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
        startPromise: null,
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
