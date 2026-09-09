import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, test } from 'vitest';
import { trackRequestHandlers } from '../request-lifecycle';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const servers: FastifyInstance[] = [];
const gates: ReturnType<typeof deferred>[] = [];
function gate() {
  const result = deferred();
  gates.push(result);
  return result;
}
function setup() {
  const server = Fastify({ forceCloseConnections: true });
  servers.push(server);
  return { server, tasks: trackRequestHandlers(server) };
}
async function listen(server: FastifyInstance) {
  return server.listen({ host: '127.0.0.1', port: 0 });
}
async function nextTurn() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

afterEach(async () => {
  for (const pending of gates.splice(0)) pending.resolve();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('request lifecycle shutdown drain', () => {
  test('waits for a handler after Fastify destroys its socket', async () => {
    const { server, tasks } = setup();
    const entered = gate();
    const finish = gate();
    let completed = false;
    server.get('/', async () => {
      entered.resolve();
      await finish.promise;
      completed = true;
      return 'ok';
    });
    const url = await listen(server);
    const request = fetch(url).catch(() => undefined);
    await entered.promise;
    await server.close();
    let drained = false;
    const drain = tasks.drain().then(() => {
      drained = true;
    });
    await nextTurn();
    expect(completed).toBe(false);
    expect(drained).toBe(false);
    finish.resolve();
    await drain;
    await request;
    expect(completed).toBe(true);
  });

  test.each(['async', 'callback'])(
    'waits through an inherited %s preHandler and its later handler',
    async (style) => {
      const { server, tasks } = setup();
      const hookEntered = gate();
      const hookFinish = gate();
      const handlerEntered = gate();
      const handlerFinish = gate();
      let completed = false;
      let nestedInstance: FastifyInstance;
      await server.register(async (plugin) => {
        if (style === 'async') {
          plugin.addHook('preHandler', async function () {
            expect(this).toBe(nestedInstance);
            hookEntered.resolve();
            await hookFinish.promise;
          });
        } else {
          plugin.addHook('preHandler', function (_request, _reply, done) {
            expect(this).toBe(nestedInstance);
            hookEntered.resolve();
            void hookFinish.promise.then(() => done());
          });
        }
        await plugin.register(async (nested) => {
          nestedInstance = nested;
          nested.get('/', async () => {
            handlerEntered.resolve();
            await handlerFinish.promise;
            completed = true;
            return 'ok';
          });
        });
      });
      const url = await listen(server);
      const request = fetch(url).catch(() => undefined);
      await hookEntered.promise;
      await server.close();
      let drained = false;
      const drain = tasks.drain().then(() => {
        drained = true;
      });
      await nextTurn();
      expect(drained).toBe(false);
      hookFinish.resolve();
      await handlerEntered.promise;
      await nextTurn();
      expect(drained).toBe(false);
      handlerFinish.resolve();
      await drain;
      await request;
      expect(completed).toBe(true);
    }
  );

  test('closes an active raw SSE response and waits for its handler cleanup', async () => {
    const { server, tasks } = setup();
    const cleanup = gate();
    let closed = false;
    server.addHook('onRequest', async () => {});
    await server.register(async (plugin) => {
      plugin.addHook('preHandler', async () => {});
      plugin.get('/events', async (_request, reply) => {
        reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream' });
        reply.raw.write('data: connected\n\n');
        await new Promise<void>((resolve) => reply.raw.once('close', resolve));
        closed = true;
        await cleanup.promise;
      });
    });
    const url = await listen(server);
    const response = await fetch(url + '/events');
    const body = response.text().catch(() => undefined);
    await server.close();
    expect(closed).toBe(true);
    let drained = false;
    const drain = tasks.drain().then(() => {
      drained = true;
    });
    await nextTurn();
    expect(drained).toBe(false);
    cleanup.resolve();
    await drain;
    await body;
  });

  test('drains authentication rejection without invoking a handler', async () => {
    const { server, tasks } = setup();
    const entered = gate();
    const finish = gate();
    let called = false;
    server.addHook('preHandler', async () => {
      entered.resolve();
      await finish.promise;
      throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
    });
    server.get('/', () => {
      called = true;
      return 'ok';
    });
    const url = await listen(server);
    const request = fetch(url).catch(() => undefined);
    await entered.promise;
    await server.close();
    const drain = tasks.drain();
    finish.resolve();
    await drain;
    await request;
    expect(called).toBe(false);
  });

  test('preserves callback hooks, route-local hooks, payloads and normal HEAD responses', async () => {
    const { server, tasks } = setup();
    server.addHook('preHandler', function (request, reply, done) {
      expect(this).toBe(server);
      expect(request.method).toMatch(/GET|HEAD/);
      expect(reply.server).toBe(server);
      setImmediate(done);
    });
    server.get(
      '/',
      {
        preHandler: [
          async (_request, reply) => {
            reply.header('x-hook', 'yes');
          },
        ],
        onSend: (_request, _reply, payload, done) => done(null, payload),
      },
      async function () {
        return { ok: this === server };
      }
    );
    const response = await server.inject('/');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(response.headers['x-hook']).toBe('yes');
    const head = await server.inject({ method: 'HEAD', url: '/' });
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe('');
    await tasks.drain();
  });

  test('drains callback early replies and awaits async hooks working after reply.send', async () => {
    const { server, tasks } = setup();
    const finish = gate();
    server.get(
      '/callback',
      {
        preHandler: (_request, reply, _done) => {
          reply.code(401).send('unauthorized');
        },
      },
      () => 'unreachable'
    );
    server.get(
      '/async',
      {
        preHandler: async (_request, reply) => {
          reply.code(401).send('unauthorized');
          await finish.promise;
          return reply;
        },
      },
      () => 'unreachable'
    );
    const url = await listen(server);
    const callbackResponse = await fetch(url + '/callback');
    expect(callbackResponse.status).toBe(401);
    await callbackResponse.text();
    await tasks.drain();
    const asyncResponse = await fetch(url + '/async');
    expect(asyncResponse.status).toBe(401);
    await asyncResponse.text();
    let drained = false;
    const drain = tasks.drain().then(() => {
      drained = true;
    });
    await nextTurn();
    expect(drained).toBe(false);
    finish.resolve();
    await drain;
  });
});
