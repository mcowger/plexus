import { afterEach, describe, expect, test, vi } from 'vitest';
import { createShutdown } from '../shutdown';
import { PendingTasks } from '../pending-tasks';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => vi.useRealTimers());

describe('shutdown', () => {
  test('closes admission immediately and waits for producers and telemetry before storage', async () => {
    const handlers = deferred();
    const background = deferred();
    const telemetry = deferred();
    const dependencies = {
      closeServer: vi.fn(() => handlers.promise),
      stopBackground: vi.fn(() => background.promise),
      stopProcesses: vi.fn(async () => {}),
      drainTelemetry: vi.fn(() => telemetry.promise),
      closeStorage: vi.fn(async () => {}),
    };
    const shutdown = createShutdown(dependencies);
    const first = shutdown();
    expect(shutdown()).toBe(first);
    expect(dependencies.closeServer).toHaveBeenCalledTimes(1);
    handlers.resolve();
    await Promise.resolve();
    expect(dependencies.drainTelemetry).not.toHaveBeenCalled();
    background.resolve();
    await vi.waitFor(() => expect(dependencies.drainTelemetry).toHaveBeenCalledTimes(1));
    expect(dependencies.closeStorage).not.toHaveBeenCalled();
    telemetry.resolve();
    await first;
    expect(dependencies.closeStorage).toHaveBeenCalledTimes(1);
  });

  test('reports deadline expiry without later closing storage under running producers', async () => {
    vi.useFakeTimers();
    const background = deferred();
    const closeStorage = vi.fn(async () => {});
    const shutdown = createShutdown(
      {
        closeServer: async () => {},
        stopBackground: () => background.promise,
        stopProcesses: async () => {},
        drainTelemetry: async () => {},
        closeStorage,
      },
      100
    );
    const pending = shutdown();
    const rejected = expect(pending).rejects.toThrow('Shutdown did not finish within 100ms');
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    background.resolve();
    await vi.advanceTimersByTimeAsync(1);
    expect(closeStorage).not.toHaveBeenCalled();
    expect(shutdown()).toBe(pending);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('reports cleanup failure without closing storage', async () => {
    const closeStorage = vi.fn(async () => {});
    const shutdown = createShutdown({
      closeServer: async () => {},
      stopBackground: async () => {},
      stopProcesses: async () => {
        throw new Error('child still running');
      },
      drainTelemetry: async () => {},
      closeStorage,
    });
    await expect(shutdown()).rejects.toThrow('Shutdown cleanup failed');
    expect(closeStorage).not.toHaveBeenCalled();
  });

  test('waits for handlers and drains telemetry even when a background stop fails', async () => {
    const handlers = deferred();
    const stopProcesses = vi.fn(async () => {});
    const drainTelemetry = vi.fn(async () => {});
    const closeStorage = vi.fn(async () => {});
    const shutdown = createShutdown({
      closeServer: () => handlers.promise,
      stopBackground: async () => {
        throw new Error('background stop failed');
      },
      stopProcesses,
      drainTelemetry,
      closeStorage,
    });
    const rejected = expect(shutdown()).rejects.toThrow('Shutdown cleanup failed');
    await Promise.resolve();
    await Promise.resolve();
    expect(stopProcesses).not.toHaveBeenCalled();
    expect(drainTelemetry).not.toHaveBeenCalled();
    handlers.resolve();
    await rejected;
    expect(stopProcesses).toHaveBeenCalledTimes(1);
    expect(drainTelemetry).toHaveBeenCalledTimes(1);
    expect(closeStorage).not.toHaveBeenCalled();
  });
});

test('pending task drain includes follow-on work and tolerates handled failures', async () => {
  const tasks = new PendingTasks();
  const first = deferred();
  const second = deferred();
  tasks.track(
    first.promise.then(() => {
      tasks.track(second.promise);
    })
  );
  tasks.track(Promise.reject(new Error('handled'))).catch(() => {});
  let drained = false;
  const draining = tasks.drain().then(() => {
    drained = true;
  });
  first.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(drained).toBe(false);
  second.resolve();
  await draining;
  expect(drained).toBe(true);
});
