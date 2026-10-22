/**
 * Per-host outbound fetch sessions (Bun 1.4.3 `Bun.FetchSession`).
 *
 * A session gives one origin its own connection pool plus TLS/proxy/keep-alive
 * settings; sessions never share connections with each other or with plain
 * `fetch()`. Sessions are cached per origin in an LRU capped at MAX_SESSIONS
 * map entries.
 *
 * Only low-cardinality, admin-configured origins are routed here (provider
 * base URLs, quota-checker endpoints, pi.dev). Untrusted high-cardinality
 * URLs such as user-supplied image downloads intentionally stay on plain
 * global fetch.
 *
 * Eviction drops the entry without force-closing: the entry is removed from
 * the map and its idle sockets die via `idleTimeout`, so a live stream on an
 * evicted origin is never aborted. Live pools can therefore transiently
 * exceed MAX_SESSIONS under origin churn, but stay bounded by distinct
 * origins per idle window — a non-issue for the configured origins above.
 *
 * Proxy behaviour is inherited from the environment (`NO_PROXY` wildcards/CIDR,
 * `ALL_PROXY` fallback); per-request options still override the session. A
 * refused proxy tunnel surfaces as `ERR_PROXY_TUNNEL` rejection, handled by the
 * existing fetch error paths at each call site.
 *
 * Test seam: under the test runner (`PLEXUS_UNDER_TEST=true`, set by the
 * bun-test preload) this delegates to `globalThis.fetch` via dynamic lookup
 * so `spyOn(globalThis, 'fetch')` keeps intercepting. Pooling is a transport
 * detail; request shape is unchanged. Tests that need the session paths use
 * `overrideSessionFactoryForTesting` (which also lifts the delegation). The
 * gate intentionally ignores `NODE_ENV` so `NODE_ENV=test` deployments
 * (staging, CI smoke runs) still get pooling.
 */

const MAX_SESSIONS = 50;

type SessionFactory = () => Bun.FetchSession;

const sessions = new Map<string, Bun.FetchSession>();

let testFactory: SessionFactory | undefined;

/** Test-only session constructor override. Pass `undefined` to restore. */
export function overrideSessionFactoryForTesting(factory: SessionFactory | undefined): void {
  testFactory = factory;
}

function createSession(): Bun.FetchSession {
  if (testFactory) return testFactory();
  return new Bun.FetchSession({
    keepAlive: { idleTimeout: 30, maxIdleSockets: 8 },
  });
}

function getOrCreateSession(origin: string): Bun.FetchSession | undefined {
  const existing = sessions.get(origin);
  if (existing) {
    // Refresh LRU position.
    sessions.delete(origin);
    sessions.set(origin, existing);
    return existing;
  }
  if (!testFactory && (typeof Bun === 'undefined' || !Bun.FetchSession)) return undefined;
  const session = createSession();
  sessions.set(origin, session);
  if (sessions.size > MAX_SESSIONS) {
    // Drop the oldest entry without closing: see module docstring.
    const oldest = sessions.keys().next();
    if (!oldest.done) sessions.delete(oldest.value);
  }
  return session;
}

/** Drop-in replacement for global `fetch` for outbound provider traffic. */
export function fetchWithSession(input: string | URL, init?: RequestInit): Promise<Response> {
  if (!testFactory && process.env.PLEXUS_UNDER_TEST === 'true') {
    return globalThis.fetch(input as string, init);
  }
  let origin: string | undefined;
  try {
    const url = typeof input === 'string' ? new URL(input) : new URL(input.toString());
    if (url.protocol === 'http:' || url.protocol === 'https:') origin = url.origin;
  } catch {
    origin = undefined;
  }
  const session = origin ? getOrCreateSession(origin) : undefined;
  if (!session) return globalThis.fetch(input as string, init);
  return session.fetch(input as string, init);
}

/** Close all pooled sessions. Call on server shutdown, after draining. */
export function closeFetchSessions(): void {
  for (const session of sessions.values()) {
    try {
      session.close();
    } catch {
      // Ignore close errors during shutdown.
    }
  }
  sessions.clear();
}
