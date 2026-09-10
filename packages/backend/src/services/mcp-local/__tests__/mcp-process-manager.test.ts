import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { registerSpy } from '../../../../test/test-utils';
import type { LocalHttpMcpServerConfig } from '../../../types/mcp';
import { mcpProcessManager } from '../mcp-process-manager';

const config: LocalHttpMcpServerConfig = {
  mode: 'local_http',
  enabled: true,
  launcher: 'bunx',
  package: 'test-mcp',
  port: 12345,
  startup_timeout_ms: 1200,
};

function makeChild(pid: number, exitOn: string | null = 'SIGTERM') {
  let finish!: (code: number) => void;
  const exited = new Promise<number>((resolve) => {
    finish = resolve;
  });
  const child = {
    pid,
    exited,
    stdout: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    }),
    stderr: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    }),
    kill: vi.fn((signal: string) => {
      if (signal === exitOn) finish(0);
    }),
    finish,
  };
  children.push(child);
  return child;
}
let children: Array<{ finish: (code: number) => void }> = [];

beforeEach(async () => {
  await mcpProcessManager.resetForTesting();
  children = [];
  vi.useFakeTimers();
});

afterEach(async () => {
  for (const child of children) child.finish(0);
  try {
    await mcpProcessManager.resetForTesting();
  } finally {
    vi.useRealTimers();
  }
});

describe('local MCP process supervision', () => {
  test('accepts HTTP 405 readiness and releases an indefinite response body', async () => {
    registerSpy(Bun, 'spawn').mockReturnValue(makeChild(101));
    const cancel = vi.fn();
    const body = new ReadableStream({ cancel });
    registerSpy(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 405 }));

    const status = await mcpProcessManager.start('test', config);

    expect(status.status).toBe('running');
    expect(status.pid).toBe(101);
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('aborts hanging readiness requests at the startup deadline and cleans up', async () => {
    const child = makeChild(102);
    registerSpy(Bun, 'spawn').mockReturnValue(child);
    const signals: AbortSignal[] = [];
    registerSpy(globalThis, 'fetch').mockImplementation((_url: string, init: RequestInit) => {
      const signal = init.signal!;
      signals.push(signal);
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    const result = mcpProcessManager.start('test', config);
    const assertion = expect(result).rejects.toThrow('did not become ready');
    await vi.advanceTimersByTimeAsync(1200);
    await assertion;

    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(mcpProcessManager.getStatus('test')).toMatchObject({ status: 'failed', pid: null });
    expect(vi.getTimerCount()).toBe(0);
  });

  test('allows a readiness request to use a proportional share of a larger startup budget', async () => {
    registerSpy(Bun, 'spawn').mockReturnValue(makeChild(110));
    let readinessSignal: AbortSignal | undefined;
    registerSpy(globalThis, 'fetch').mockImplementation((_url: string, init: RequestInit) => {
      readinessSignal = init.signal!;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response(null, { status: 405 })), 1500);
        readinessSignal!.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(readinessSignal!.reason);
          },
          { once: true }
        );
      });
    });

    const starting = mcpProcessManager.start('test', { ...config, startup_timeout_ms: 8000 });
    await vi.advanceTimersByTimeAsync(1499);
    expect(readinessSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(starting).resolves.toMatchObject({ status: 'running', pid: 110 });
  });

  test('waits for SIGTERM grace then escalates and confirms exit', async () => {
    const child = makeChild(103, 'SIGKILL');
    registerSpy(Bun, 'spawn').mockReturnValue(child);
    registerSpy(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 405 }));
    await mcpProcessManager.start('test', config);

    const stopping = mcpProcessManager.stop('test');
    await vi.advanceTimersByTimeAsync(2999);
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    expect(mcpProcessManager.getStatus('test').pid).toBe(103);
    await vi.advanceTimersByTimeAsync(1);
    expect(await stopping).toMatchObject({ status: 'stopped', pid: null });
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('retains the live process and refuses a replacement if termination fails', async () => {
    const child = makeChild(104, null);
    const spawn = registerSpy(Bun, 'spawn').mockReturnValue(child);
    registerSpy(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 405 }));
    await mcpProcessManager.start('test', config);

    const stopped = expect(mcpProcessManager.stop('test')).rejects.toThrow('after SIGKILL');
    await vi.advanceTimersByTimeAsync(4000);
    await stopped;
    expect(mcpProcessManager.getStatus('test')).toMatchObject({ status: 'failed', pid: 104 });

    const restarted = expect(mcpProcessManager.restart('test', config)).rejects.toThrow(
      'after SIGKILL'
    );
    await vi.advanceTimersByTimeAsync(4000);
    await restarted;
    expect(spawn).toHaveBeenCalledOnce();
  });

  test('clears test state while propagating an unconfirmed termination failure', async () => {
    const child = makeChild(111, null);
    registerSpy(Bun, 'spawn').mockReturnValue(child);
    registerSpy(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 405 }));
    await mcpProcessManager.start('test', config);

    const resetting = expect(mcpProcessManager.resetForTesting()).rejects.toBeInstanceOf(
      AggregateError
    );
    await vi.advanceTimersByTimeAsync(4000);
    await resetting;

    expect(mcpProcessManager.getStatus('test')).toMatchObject({ status: 'stopped', pid: null });
  });

  test('preserves a cleanup failure after startup readiness fails', async () => {
    registerSpy(Bun, 'spawn').mockReturnValue(makeChild(112, null));
    registerSpy(globalThis, 'fetch').mockImplementation((_url: string, init: RequestInit) => {
      const signal = init.signal!;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });

    const starting = expect(mcpProcessManager.start('test', config)).rejects.toThrow(
      'did not become ready'
    );
    await vi.advanceTimersByTimeAsync(5200);
    await starting;

    expect(mcpProcessManager.getStatus('test')).toMatchObject({
      status: 'failed',
      pid: 112,
      lastError:
        'Local MCP server did not become ready: Readiness request timed out; cleanup failed: Local MCP process did not exit after SIGKILL',
    });
  });

  test('cancels in-progress startup before a queued restart and ignores the old probe', async () => {
    const first = makeChild(105);
    const second = makeChild(106);
    const spawn = registerSpy(Bun, 'spawn').mockReturnValueOnce(first).mockReturnValueOnce(second);
    let firstSignal: AbortSignal | undefined;
    registerSpy(globalThis, 'fetch')
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        firstSignal = init.signal!;
        return new Promise((_resolve, reject) => {
          firstSignal!.addEventListener('abort', () => reject(firstSignal!.reason), { once: true });
        });
      })
      .mockResolvedValue(new Response(null, { status: 405 }));
    const initial = expect(mcpProcessManager.start('test', config)).rejects.toThrow('cancelled');
    await vi.advanceTimersByTimeAsync(0);
    const restart = mcpProcessManager.restart('test', config);
    await initial;
    expect(await restart).toMatchObject({ status: 'running', pid: 106 });
    expect(firstSignal?.aborted).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(first.kill).toHaveBeenCalledWith('SIGTERM');
  });

  test('stop cancels a queued start before it spawns', async () => {
    const spawn = registerSpy(Bun, 'spawn');
    const initial = expect(mcpProcessManager.start('test', config)).rejects.toThrow('cancelled');
    const stopped = mcpProcessManager.stop('test');
    await initial;
    expect(await stopped).toMatchObject({ status: 'stopped', pid: null });
    expect(spawn).not.toHaveBeenCalled();
  });

  test('an early child exit aborts the readiness request immediately', async () => {
    const child = makeChild(109);
    registerSpy(Bun, 'spawn').mockReturnValue(child);
    let signal: AbortSignal | undefined;
    registerSpy(globalThis, 'fetch').mockImplementation((_url: string, init: RequestInit) => {
      signal = init.signal!;
      return new Promise((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
      });
    });
    const initial = expect(mcpProcessManager.start('test', config)).rejects.toThrow(
      'exited before readiness'
    );
    await vi.advanceTimersByTimeAsync(0);
    child.finish(1);
    await initial;
    expect(signal?.aborted).toBe(true);
    expect(mcpProcessManager.getStatus('test')).toMatchObject({ status: 'failed', pid: null });
    expect(vi.getTimerCount()).toBe(0);
  });

  test('serializes simultaneous starts and config changes without duplicate children', async () => {
    const first = makeChild(107);
    const second = makeChild(108);
    const spawn = registerSpy(Bun, 'spawn').mockReturnValueOnce(first).mockReturnValueOnce(second);
    registerSpy(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response(null, { status: 405 }))
    );

    await Promise.all([
      mcpProcessManager.ensureRunning('test', config),
      mcpProcessManager.ensureRunning('test', config),
      mcpProcessManager.ensureRunning('test', { ...config, port: 12346 }),
    ]);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(first.kill).toHaveBeenCalledWith('SIGTERM');
    expect(mcpProcessManager.getStatus('test')).toMatchObject({ status: 'running', pid: 108 });
  });
});
