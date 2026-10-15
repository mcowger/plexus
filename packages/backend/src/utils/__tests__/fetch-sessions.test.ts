import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerSpy } from '../../../test/test-utils';
import {
  fetchWithSession,
  closeFetchSessions,
  overrideSessionFactoryForTesting,
} from '../fetch-sessions';

type StubSession = {
  fetch: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

function makeStubSession(): StubSession {
  return {
    fetch: vi.fn(async () => new Response('ok')),
    close: vi.fn(),
  };
}

describe('fetchWithSession', () => {
  let stubs: StubSession[];

  function stubAt(index: number): StubSession {
    const stub = stubs[index];
    expect(stub).toBeDefined();
    return stub as StubSession;
  }

  beforeEach(() => {
    stubs = [];
    overrideSessionFactoryForTesting(() => {
      const stub = makeStubSession();
      stubs.push(stub);
      return stub as unknown as Bun.FetchSession;
    });
  });

  afterEach(() => {
    closeFetchSessions();
    overrideSessionFactoryForTesting(undefined);
    vi.unstubAllGlobals();
  });

  it('reuses one session per origin', async () => {
    await fetchWithSession('https://api.example.com/v1/chat');
    await fetchWithSession('https://api.example.com/v1/models');
    expect(stubs).toHaveLength(1);
    expect(stubAt(0).fetch).toHaveBeenCalledTimes(2);
  });

  it('creates distinct sessions per origin', async () => {
    await fetchWithSession('https://a.example.com/x');
    await fetchWithSession('https://b.example.com/x');
    expect(stubs).toHaveLength(2);
  });

  it('bounds the pool and drops evicted entries without closing', async () => {
    for (let i = 0; i < 55; i++) {
      await fetchWithSession(`https://host-${i}.example.com/x`);
    }
    expect(stubs).toHaveLength(55);
    // Eviction drops from the map; it must never abort a live origin.
    for (const stub of stubs) expect(stub.close).not.toHaveBeenCalled();
    // The first origin was evicted, so it builds a fresh session.
    await fetchWithSession('https://host-0.example.com/x');
    expect(stubs).toHaveLength(56);
  });

  it('closeFetchSessions closes every pooled session once', async () => {
    await fetchWithSession('https://a.example.com/x');
    await fetchWithSession('https://b.example.com/x');
    closeFetchSessions();
    expect(stubAt(0).close).toHaveBeenCalledTimes(1);
    expect(stubAt(1).close).toHaveBeenCalledTimes(1);
    closeFetchSessions();
    expect(stubAt(0).close).toHaveBeenCalledTimes(1);
  });

  it('passes non-HTTP(S) and unparsable input to global fetch', async () => {
    const spy = registerSpy(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    await fetchWithSession('s3://bucket/key');
    await fetchWithSession('file:///tmp/x');
    await fetchWithSession('not a url');
    expect(spy).toHaveBeenCalledTimes(3);
    expect(stubs).toHaveLength(0);
  });

  it('delegates to global fetch under Vitest without a factory override', async () => {
    overrideSessionFactoryForTesting(undefined);
    const spy = registerSpy(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    await fetchWithSession('https://api.example.com/v1/chat');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
