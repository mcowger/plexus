// Integration tests against a real listening Fastify server: draining depends on
// socket lifecycles, so the stream handlers pace output with real sleeps and
// fake timers cannot drive them.
import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { AddressInfo } from 'node:net';
import net from 'node:net';

import Fastify, { type FastifyInstance } from 'fastify';

import { GracefulShutdown } from '../runtime/graceful-shutdown';

const CHUNKS = 5;
const CHUNK_INTERVAL_MS = 100;
const SLOW_BODY = Array.from({ length: CHUNKS }, (_, i) => `data: ${i}\n\n`).join('');

let activeServer: FastifyInstance | undefined;

afterEach(async () => {
  activeServer?.server.closeAllConnections();
  await activeServer?.close();
  activeServer = undefined;
});

async function startServer(drainTimeoutMs: number) {
  const fastify = Fastify({
    logger: false,
    forceCloseConnections: false,
    return503OnClosing: false,
  });
  activeServer = fastify;
  const shutdown = new GracefulShutdown();
  shutdown.attach(fastify);

  fastify.get('/slow', async (_request, reply) => {
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (let i = 0; i < CHUNKS; i++) {
      reply.raw.write(`data: ${i}\n\n`);
      await Bun.sleep(CHUNK_INTERVAL_MS);
    }
    reply.raw.end();
  });

  fastify.get('/endless', async (_request, reply) => {
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream' });
    while (!reply.raw.destroyed) {
      reply.raw.write('data: tick\n\n');
      await Bun.sleep(CHUNK_INTERVAL_MS);
    }
  });

  fastify.get('/subscription', async (_request, reply) => {
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const stopDrainWatch = shutdown.onDrain(() => reply.raw.end());
    reply.raw.on('close', stopDrainWatch);
    while (!reply.raw.destroyed) {
      reply.raw.write('data: tick\n\n');
      await Bun.sleep(CHUNK_INTERVAL_MS);
    }
  });

  fastify.get('/fast', async () => ({ ok: true }));

  const address = await fastify.listen({ port: 0, host: '127.0.0.1' });
  const port = (fastify.server.address() as AddressInfo).port;
  const cleanup = mock(async () => {});
  const exit = mock((_code: number) => {});
  shutdown.configure({ drainTimeoutMs, cleanup, exit });
  return { shutdown, address, port, cleanup, exit };
}

interface StreamResult {
  body: string;
  error?: string;
}

/**
 * Resolves once response headers arrive (the handler is running); `result`
 * yields the full body, or the error message if the socket is reset.
 */
async function openStream(url: string): Promise<{ result: Promise<StreamResult> }> {
  const response = await fetch(url);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const readAll = async (): Promise<StreamResult> => {
    let body = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return { body };
        body += decoder.decode(value);
      }
    } catch (error) {
      return { body, error: (error as Error).message };
    }
  };
  return { result: readAll() };
}

describe('GracefulShutdown', () => {
  test('lets an in-flight stream finish, answers late requests with a retryable 503, then exits', async () => {
    const { shutdown, address, port, cleanup, exit } = await startServer(10_000);

    const stream = await openStream(`${address}/slow`);

    // A second in-flight stream on a raw keep-alive socket, so a request can
    // arrive on an already-open connection after the drain has started.
    const socket = net.connect(port, '127.0.0.1');
    let raw = '';
    const firstChunk = Promise.withResolvers<void>();
    socket.on('data', (chunk) => {
      raw += chunk.toString();
      firstChunk.resolve();
    });
    const socketClosed = Promise.withResolvers<void>();
    socket.on('close', () => socketClosed.resolve());
    socket.write('GET /slow HTTP/1.1\r\nHost: test\r\n\r\n');
    await firstChunk.promise;

    const draining = shutdown.request('SIGUSR1', 'drain');
    socket.write('GET /fast HTTP/1.1\r\nHost: test\r\n\r\n');
    await draining;

    const { body, error } = await stream.result;
    expect(error).toBeUndefined();
    expect(body).toBe(SLOW_BODY);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);

    await socketClosed.promise;
    expect(raw).toContain('data: 4');
    expect(raw).toMatch(/HTTP\/1\.1 503[\s\S]*retry-after: 5/i);
  });

  test('force-closes a stream that outlives the drain deadline', async () => {
    const drainTimeoutMs = 300;
    const { shutdown, address, exit } = await startServer(drainTimeoutMs);

    const stream = await openStream(`${address}/endless`);
    const startedAt = Date.now();
    await shutdown.request('SIGUSR1', 'drain');
    const elapsed = Date.now() - startedAt;

    expect(elapsed).toBeGreaterThanOrEqual(drainTimeoutMs - 50);
    expect(elapsed).toBeLessThan(drainTimeoutMs + 2_000);
    expect((await stream.result).error).toBeDefined();
    expect(exit).toHaveBeenCalledWith(0);
  });

  test('a force request during the drain closes connections without waiting for the deadline', async () => {
    const { shutdown, address, exit } = await startServer(10_000);

    const stream = await openStream(`${address}/endless`);
    const startedAt = Date.now();
    const draining = shutdown.request('SIGUSR1', 'drain');
    await shutdown.request('SIGTERM', 'force');
    await draining;

    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect((await stream.result).error).toBeDefined();
    expect(exit).toHaveBeenCalledTimes(1);
  });

  test('ends onDrain subscription streams cleanly instead of waiting for the deadline', async () => {
    const { shutdown, address, exit } = await startServer(10_000);

    const stream = await openStream(`${address}/subscription`);
    const startedAt = Date.now();
    await shutdown.request('SIGUSR1', 'drain');

    const { body, error } = await stream.result;
    expect(error).toBeUndefined();
    expect(body).toContain('data: tick');
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(exit).toHaveBeenCalledWith(0);
  });

  test('a repeated force request exits without waiting for a hung cleanup', async () => {
    const { shutdown, exit } = await startServer(10_000);
    const cleanupStarted = Promise.withResolvers<void>();
    shutdown.configure({
      drainTimeoutMs: 10_000,
      cleanup: () => {
        cleanupStarted.resolve();
        return new Promise<void>(() => {});
      },
      exit,
    });

    void shutdown.request('SIGTERM', 'force');
    await cleanupStarted.promise;
    expect(exit).not.toHaveBeenCalled();

    await shutdown.request('SIGINT', 'force');
    expect(exit).toHaveBeenCalledWith(1);
  });

  test('a throwing drain listener does not stop the shutdown', async () => {
    const { shutdown, cleanup, exit } = await startServer(10_000);
    shutdown.onDrain(() => {
      throw new Error('stream in a bad state');
    });

    await shutdown.request('SIGUSR1', 'drain');

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });
});
