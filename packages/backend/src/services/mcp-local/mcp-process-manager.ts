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
  logs: string[];
  lastError: string | null;
  startedAt: string | null;
  exitedAt: string | null;
}

const MAX_LOG_LINES = 500;

class McpProcessManager {
  private states = new Map<string, LocalProcessState>();

  getLocalUrl(config: McpServerConfig): string | null {
    if (config.mode !== 'local_http') return null;
    return 'http://127.0.0.1:' + config.port + (config.path || '/mcp');
  }

  async ensureRunning(serverName: string, config: McpServerConfig): Promise<void> {
    if (config.mode !== 'local_http') return;
    const state = this.getState(serverName);
    if (state.status === 'running' && state.process) return;
    if (state.startPromise) return state.startPromise;
    state.startPromise = this.startInternal(serverName, config).finally(() => {
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
        child.kill('SIGTERM');
        await Promise.race([child.exited, Bun.sleep(3000)]);
      } catch (error) {
        this.appendLog(state, 'Failed to stop process: ' + (error as Error).message);
      }
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

  private async startInternal(serverName: string, config: McpServerConfig): Promise<void> {
    if (config.mode !== 'local_http') return;
    const state = this.getState(serverName);
    state.status = 'starting';
    state.lastError = null;
    state.exitedAt = null;

    const args = [config.package, ...(config.args || [])].map((arg) =>
      arg.replaceAll('{{PORT}}', String(config.port)).replaceAll('{{HOST}}', '127.0.0.1')
    );
    const command = [config.launcher, ...args];
    this.appendLog(state, 'Starting: ' + command.join(' '));

    const child = Bun.spawn(command, {
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'pipe',
      env: { ...process.env, PORT: String(config.port), HOST: '127.0.0.1' },
    });

    state.process = child;
    state.startedAt = new Date().toISOString();
    this.consumeStream(state, child.stdout, 'stdout');
    this.consumeStream(state, child.stderr, 'stderr');

    child.exited.then((code) => {
      if (state.process === child) {
        state.process = null;
        state.status = code === 0 ? 'stopped' : 'failed';
        state.lastError = code === 0 ? null : 'Process exited with code ' + code;
        state.exitedAt = new Date().toISOString();
      }
      this.appendLog(state, 'Process exited with code ' + code);
    });

    try {
      await this.waitForReady(config);
      if (state.process === child) {
        state.status = 'running';
        this.appendLog(state, 'Ready at ' + this.getLocalUrl(config));
      }
    } catch (error) {
      state.status = 'failed';
      state.lastError = (error as Error).message;
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
    while (Date.now() < deadline) {
      try {
        const response = await fetch(url, { method: 'GET' });
        if (response.status < 500) return;
        lastError = 'HTTP ' + response.status;
      } catch (error) {
        lastError = (error as Error).message;
      }
      await Bun.sleep(500);
    }
    throw new Error('Local MCP server did not become ready: ' + lastError);
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
          if (value) this.appendLog(state, '[' + label + '] ' + decoder.decode(value).trimEnd());
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
