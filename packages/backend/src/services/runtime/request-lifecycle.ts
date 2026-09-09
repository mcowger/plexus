import type { FastifyInstance, FastifyReply } from 'fastify';
import { PendingTasks } from './pending-tasks';

const REQUEST_HOOKS = new Set([
  'onRequest',
  'preParsing',
  'preValidation',
  'preHandler',
  'preSerialization',
  'onSend',
  'onResponse',
  'onError',
  'onTimeout',
  'onRequestAbort',
]);

type Callable = (this: any, ...args: any[]) => any;

/** Install before registering plugins/routes; sockets can close before their work finishes. */
export function trackRequestHandlers(server: FastifyInstance): PendingTasks {
  const tasks = new PendingTasks();
  const responses = new Set<FastifyReply['raw']>();
  const hookWrappers = new WeakMap<Callable, Callable>();
  const handlerWrappers = new WeakMap<Callable, Callable>();
  const registrations = new WeakSet<Callable>();

  const wrapHook = (hook: Callable): Callable => {
    const existing = hookWrappers.get(hook);
    if (existing) return existing;
    const invoke: Callable = function (...args) {
      let complete!: () => void;
      const pending = new Promise<void>((resolve) => {
        complete = resolve;
      });
      tasks.track(pending);
      const reply = args[1]?.raw ? (args[1] as FastifyReply) : undefined;
      let invoked = false;
      let promiseReturned = false;
      let responseFinished = false;
      const finish = () => {
        reply?.raw.removeListener('finish', onResponseFinished);
        reply?.raw.removeListener('error', onResponseFinished);
        complete();
      };
      const onResponseFinished = () => {
        responseFinished = true;
        // Callback hooks may intentionally reply without calling done (e.g. CORS).
        // Promise hooks may keep working after reply.send(), so await their promise.
        if (invoked && !promiseReturned) finish();
      };
      reply?.raw.once('finish', onResponseFinished);
      reply?.raw.once('error', onResponseFinished);
      const callbackIndex = args.length - 1;
      const callback = args[callbackIndex];
      const hasCallback = typeof callback === 'function';
      if (hasCallback) {
        args[callbackIndex] = function (this: unknown, ...callbackArgs: any[]) {
          try {
            // Advance the hook chain before retiring this task, preventing a
            // temporary empty queue between a hook and its downstream handler.
            return callback.apply(this, callbackArgs);
          } finally {
            finish();
          }
        };
      }
      try {
        const result = hook.apply(this, args);
        invoked = true;
        if (result && typeof result.then === 'function') {
          promiseReturned = true;
          void Promise.resolve(result).then(finish, finish);
        } else if (!hasCallback || reply?.sent || responseFinished) {
          finish();
        }
        return result;
      } catch (error) {
        finish();
        throw error;
      }
    };
    // A function proxy retains arity/constructor metadata, including Fastify's
    // validation of async hook signatures, while forwarding the original result.
    const wrapped = new Proxy(hook, {
      apply(_target, thisArg, args) {
        return invoke.apply(thisArg, args);
      },
    });
    hookWrappers.set(hook, wrapped);
    hookWrappers.set(wrapped, wrapped);
    return wrapped;
  };

  const instrumentRegistration = (instance: FastifyInstance) => {
    const addHook = instance.addHook;
    if (registrations.has(addHook)) return;
    // onRoute exposes route-local hooks, but not hooks inherited from plugins.
    // Intercept their public registration API rather than inspecting Fastify internals.
    const wrapped = function (this: FastifyInstance, name: string, hook: Callable) {
      return (addHook as Callable).call(
        this,
        name,
        REQUEST_HOOKS.has(name) && typeof hook === 'function' ? wrapHook(hook) : hook
      );
    };
    registrations.add(wrapped);
    instance.addHook = wrapped as typeof instance.addHook;
  };

  // Bun can leave a streaming ServerResponse open after closeAllConnections().
  // Destroy response objects explicitly; tracked hook/handler work must still settle.
  server.addHook('onRequest', (_request, reply, done) => {
    responses.add(reply.raw);
    const forget = () => {
      responses.delete(reply.raw);
      reply.raw.removeListener('finish', forget);
      reply.raw.removeListener('close', forget);
    };
    reply.raw.once('finish', forget);
    reply.raw.once('close', forget);
    done();
  });
  server.addHook('preClose', async () => {
    for (const response of responses) response.destroy();
  });

  server.addHook('onRegister', (instance) => instrumentRegistration(instance));
  server.addHook('onRoute', (route) => {
    for (const name of REQUEST_HOOKS) {
      const hooks = (route as unknown as Record<string, unknown>)[name];
      if (typeof hooks === 'function') {
        (route as unknown as Record<string, unknown>)[name] = wrapHook(hooks as Callable);
      } else if (Array.isArray(hooks)) {
        (route as unknown as Record<string, unknown>)[name] = hooks.map(wrapHook);
      }
    }
    const handler = route.handler;
    const existing = handlerWrappers.get(handler);
    if (existing) {
      route.handler = existing;
      return;
    }
    const wrapped: typeof handler = function (request, reply) {
      const result = handler.call(this, request, reply);
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        tasks.track(Promise.resolve(result));
      }
      return result;
    };
    handlerWrappers.set(handler, wrapped);
    handlerWrappers.set(wrapped, wrapped);
    route.handler = wrapped;
  });
  instrumentRegistration(server);
  return tasks;
}
