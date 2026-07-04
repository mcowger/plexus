import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Request-scoped context carried alongside an inference request.
 *
 * Consumers like DebugManager read the active key name from here so they
 * can decide whether to capture a trace without having to plumb the value
 * through every call site.
 */
export interface RequestContext {
  keyName?: string;
  requestId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Set the request context for the current async flow. Anything downstream
 * (including awaited async code started after this call) will read the
 * same context via `getRequestContext()`.
 */
export function enterRequestContext(ctx: RequestContext): void {
  storage.enterWith(ctx);
}

/**
 * Read the active request context, or undefined if not inside one.
 */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Read just the key name from the active request context.
 */
export function getCurrentKeyName(): string | undefined {
  return storage.getStore()?.keyName;
}

/**
 * Read just the request id from the active request context.
 */
export function getCurrentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/**
 * Attach the request id to the active request context so downstream code
 * (notably DebugManager, reached via the cooldown path) can resolve the
 * request id without explicit plumbing. Replaces the store via `enterWith`
 * rather than mutating the existing object in place, so any other holder of
 * a reference to the prior store is unaffected. No-op when called outside a
 * request context.
 */
export function setCurrentRequestId(requestId: string): void {
  const store = storage.getStore();
  if (store) storage.enterWith({ ...store, requestId });
}

/**
 * Run a callback with a given request context. Prefer this wrapper in tests
 * or short-lived scopes; long-lived Fastify handlers should use
 * `enterRequestContext` on the onRequest hook instead.
 */
export function runInRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}
