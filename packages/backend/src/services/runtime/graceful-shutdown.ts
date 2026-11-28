import type { ServerResponse } from 'node:http';

import type { FastifyInstance } from 'fastify';

import { logger } from '../../utils/logger';

export const DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS = 30_000;
const IDLE_CONNECTION_SWEEP_MS = 250;
const DRAINING_RETRY_AFTER_SECONDS = 5;

/**
 * `drain` lets in-flight requests finish (up to the drain timeout) before
 * closing their connections; `force` closes every connection immediately.
 */
export type ShutdownMode = 'drain' | 'force';

export interface ShutdownOptions {
  drainTimeoutMs: number;
  /** Releases resources (jobs, child processes, DB) once every connection is closed. */
  cleanup: () => Promise<void>;
  exit: (code: number) => void;
}

/** Reads `SHUTDOWN_DRAIN_TIMEOUT_MS`; invalid values fall back to the default. */
export function parseDrainTimeoutMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS;
  const value = Number(raw);
  if (Number.isInteger(value) && value >= 0) return value;
  logger.warn(
    `Ignoring invalid SHUTDOWN_DRAIN_TIMEOUT_MS=${raw}; using ${DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS}ms`
  );
  return DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS;
}

/**
 * Coordinates process shutdown. A drain stops accepting connections, answers
 * requests that still arrive on open connections with a retryable 503, ends
 * long-lived subscription streams (dashboard SSE, MCP notification channels),
 * and waits for in-flight requests until the deadline. Remaining connections
 * are then destroyed. A force request at any point skips the rest of the wait;
 * a second force request exits at once, even while cleanup is still running.
 */
export class GracefulShutdown {
  private server?: FastifyInstance;
  private options?: ShutdownOptions;
  private draining = false;
  private forced = false;
  private readonly inFlight = new Set<ServerResponse>();
  private readonly drainListeners = new Set<() => void>();
  private readonly forceRequested = Promise.withResolvers<void>();

  /** Must run before routes are registered so the 503 hook covers every route. */
  attach(server: FastifyInstance): void {
    this.server = server;
    server.server.on('request', (_req, res: ServerResponse) => {
      this.inFlight.add(res);
      res.once('close', () => this.inFlight.delete(res));
    });
    server.addHook('onRequest', async (_request, reply) => {
      if (!this.draining) return;
      reply
        .code(503)
        .header('Retry-After', String(DRAINING_RETRY_AFTER_SECONDS))
        .header('Connection', 'close')
        .send({ error: { message: 'Server is shutting down', type: 'service_unavailable' } });
      return reply;
    });
  }

  configure(options: ShutdownOptions): void {
    this.options = options;
  }

  /**
   * Registers a callback that ends a long-lived stream when draining starts,
   * so it does not hold the drain open until the deadline. Returns an
   * unsubscribe function for when the stream closes on its own.
   */
  onDrain(listener: () => void): () => void {
    if (this.draining) {
      listener();
      return () => {};
    }
    this.drainListeners.add(listener);
    return () => this.drainListeners.delete(listener);
  }

  /**
   * Starts shutdown, escalates a running drain when `mode` is `force`, or
   * exits immediately on a repeated force request (e.g. Ctrl-C twice while
   * cleanup hangs). Resolves after `exit` has been called (or immediately
   * for repeat calls).
   */
  async request(reason: string, mode: ShutdownMode, exitCode = 0): Promise<void> {
    const { server, options } = this;
    if (!server || !options) throw new Error('GracefulShutdown is not attached and configured');

    if (this.draining) {
      if (mode !== 'force') return;
      if (this.forced) {
        logger.warn(`${reason} received again; exiting without waiting for shutdown to finish`);
        options.exit(1);
        return;
      }
      this.forced = true;
      this.forceRequested.resolve();
      logger.warn(`${reason} received during drain; force-closing connections`);
      return;
    }

    this.draining = true;
    if (mode === 'force') {
      this.forced = true;
      this.forceRequested.resolve();
    }
    logger.info(
      mode === 'force'
        ? `${reason} received, shutting down immediately`
        : `${reason} received, draining ${this.inFlight.size} in-flight request(s) for up to ${options.drainTimeoutMs}ms`
    );
    // One misbehaving stream must not stop the rest of the shutdown.
    for (const listener of this.drainListeners) {
      try {
        listener();
      } catch (error) {
        logger.warn('Drain listener failed', error);
      }
    }
    this.drainListeners.clear();

    let code = exitCode;
    try {
      await this.closeServer(server, options.drainTimeoutMs);
      await options.cleanup();
      logger.info('Shutdown complete');
    } catch (error) {
      logger.error('Error during shutdown', error);
      code = 1;
    }
    options.exit(code);
  }

  private async closeServer(server: FastifyInstance, drainTimeoutMs: number): Promise<void> {
    const httpServer = server.server;
    const startedAt = Date.now();
    const closed = server.close();
    // server.close() only reaps sockets idle at call time; keep-alive sockets
    // whose in-flight response finishes later must be swept as they go idle.
    const sweep = setInterval(() => httpServer.closeIdleConnections(), IDLE_CONNECTION_SWEEP_MS);
    const timedOut = Promise.withResolvers<'timeout'>();
    const deadline = setTimeout(() => timedOut.resolve('timeout'), drainTimeoutMs);
    try {
      const outcome = await Promise.race([
        Promise.resolve(closed).then(() => 'drained' as const),
        timedOut.promise,
        this.forceRequested.promise.then(() => 'forced' as const),
      ]);
      if (outcome === 'drained') {
        logger.info(`All in-flight requests completed in ${Date.now() - startedAt}ms`);
        return;
      }
      logger.warn(
        outcome === 'timeout'
          ? `Drain timeout of ${drainTimeoutMs}ms reached; force-closing ${this.inFlight.size} in-flight request(s)`
          : `Force-closing ${this.inFlight.size} in-flight request(s)`
      );
      httpServer.closeAllConnections();
      await closed;
    } finally {
      clearInterval(sweep);
      clearTimeout(deadline);
    }
  }
}

export const gracefulShutdown = new GracefulShutdown();
