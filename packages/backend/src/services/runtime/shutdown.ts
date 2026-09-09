interface ShutdownDependencies {
  closeServer(): Promise<void>;
  stopBackground(): Promise<void>;
  stopProcesses(): Promise<void>;
  drainTelemetry(): Promise<void>;
  closeStorage(): Promise<void>;
}

/** Stops producers and drains their writes before storage closes, once per process. */
export function createShutdown(dependencies: ShutdownDependencies, timeoutMs = 30_000) {
  let shutdown: Promise<void> | undefined;
  return (): Promise<void> => {
    if (shutdown) return shutdown;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new Error(`Shutdown did not finish within ${timeoutMs}ms`));
      }, timeoutMs);
    });
    const work = async () => {
      // Closing admission must also drain handler work after sockets close.
      // Wait for all producers even when one reports a cleanup failure.
      const producers = await Promise.allSettled([
        dependencies.closeServer(),
        dependencies.stopBackground(),
      ]);
      if (timedOut) return;
      const errors = producers.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : []
      );
      // An admitted MCP handler may start a child; stop children only after
      // every handler is done so none can be spawned after this phase.
      try {
        await dependencies.stopProcesses();
      } catch (error) {
        errors.push(error);
      }
      if (timedOut) return;
      try {
        await dependencies.drainTelemetry();
      } catch (error) {
        errors.push(error);
      }
      if (timedOut) return;
      if (errors.length) throw new AggregateError(errors, 'Shutdown cleanup failed');
      await dependencies.closeStorage();
    };
    shutdown = Promise.race([work(), deadline]).finally(() => clearTimeout(timer));
    return shutdown;
  };
}
