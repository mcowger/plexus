/**
 * Per-host outbound fetch sessions (Bun 1.4.3 `Bun.FetchSession`).
 *
 * A session gives one origin its own connection pool plus TLS/proxy/keep-alive
 * settings; sessions never share connections with each other or with plain
 * `fetch()`. Sessions are cached per origin in a bounded LRU so unbounded host
 * cardinality (e.g. user-supplied image URLs) cannot leak sockets.
 *
 * Proxy behaviour is inherited from the environment (`NO_PROXY` wildcards/CIDR,
 * `ALL_PROXY` fallback); per-request options still override the session. A
 * refused proxy tunnel surfaces as `ERR_PROXY_TUNNEL` rejection, handled by the
 * existing fetch error paths at each call site.
 *
 * Test seam: under Vitest this delegates to `globalThis.fetch` via dynamic
 * lookup so `vi.spyOn(globalThis, 'fetch')` keeps intercepting. Pooling is a
 * transport detail; request shape is unchanged.
 */

const MAX_SESSIONS = 50;

const sessions = new Map<string, Bun.FetchSession>();

function isTestEnv(): boolean {
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
}

function getOrCreateSession(origin: string): Bun.FetchSession | undefined {
  const existing = sessions.get(origin);
  if (existing) {
    // Refresh LRU position.
    sessions.delete(origin);
    sessions.set(origin, existing);
    return existing;
  }
  if (typeof Bun === 'undefined' || !Bun.FetchSession) return undefined;
  const session = new Bun.FetchSession({
    keepAlive: { idleTimeout: 30, maxIdleSockets: 8 },
  });
  sessions.set(origin, session);
  if (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next();
    if (!oldest.done) {
      sessions.get(oldest.value)?.close();
      sessions.delete(oldest.value);
    }
  }
  return session;
}

/** Drop-in replacement for global `fetch` for outbound provider traffic. */
export function fetchWithSession(input: string | URL, init?: RequestInit): Promise<Response> {
  if (isTestEnv()) return globalThis.fetch(input as string, init);
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

/** Close all pooled sessions. Call on server shutdown. */
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
