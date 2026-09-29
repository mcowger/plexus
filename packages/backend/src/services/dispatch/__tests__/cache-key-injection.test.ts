import { describe, expect, it } from 'vitest';
import type { ProviderConfig } from '../../../config';
import type { UnifiedChatRequest } from '../../../types/unified';
import { StickySessionManager } from '../../routing/sticky-session-manager';
import {
  applyBodyCacheKeyInjection,
  applyHeaderCacheKeyInjection,
  deriveCacheInjectionKey,
  resolveCacheKeyInjection,
} from '../cache-key-injection';

function route(config: Partial<ProviderConfig> = {}) {
  return {
    provider: 'meta',
    model: 'muse-spark-1.3-contributor',
    canonicalModel: 'muse-spark-1.3',
    config: config as ProviderConfig,
  } as any;
}

function request(overrides: Partial<UnifiedChatRequest> = {}): UnifiedChatRequest {
  return {
    model: 'muse-spark-1.3',
    messages: [],
    ...overrides,
  } as UnifiedChatRequest;
}

describe('resolveCacheKeyInjection', () => {
  it('returns undefined when unset on a non-Meta provider', () => {
    expect(resolveCacheKeyInjection({} as ProviderConfig)).toBeUndefined();
  });

  it('honors an explicit destination', () => {
    expect(
      resolveCacheKeyInjection({ cache_key_injection: 'x-session-affinity' } as ProviderConfig)
    ).toBe('x-session-affinity');
  });

  it('treats off as disabled even for Meta OAuth', () => {
    expect(
      resolveCacheKeyInjection({
        oauth_provider: 'meta',
        cache_key_injection: 'off',
      } as ProviderConfig)
    ).toBeUndefined();
  });

  it('defaults Meta OAuth to prompt_cache_key', () => {
    expect(resolveCacheKeyInjection({ oauth_provider: 'meta' } as ProviderConfig)).toBe(
      'prompt_cache_key'
    );
  });
});

describe('deriveCacheInjectionKey', () => {
  it('prefers the session affinity identity', () => {
    expect(
      deriveCacheInjectionKey(
        request({
          cacheRoutingHeaders: { session_id: 'sess-1' },
          prompt_cache_key: 'body-key',
        })
      )
    ).toBe('sess-1');
  });

  it('falls back to the client body key', () => {
    expect(deriveCacheInjectionKey(request({ prompt_cache_key: 'body-key' }))).toBe('body-key');
  });

  it('excludes the previousResponseId chain so the key stays stable across turns', () => {
    const req = request({
      previousResponseId: 'resp-1',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ] as any,
    });
    expect(deriveCacheInjectionKey(req)).toBe(
      StickySessionManager.computeSessionKey({ ...req, previousResponseId: undefined })
    );
    expect(deriveCacheInjectionKey(req)).not.toBe('r:resp-1');
  });

  it('uses the first-two-messages hash for a client without a response chain', () => {
    const req = request({
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ] as any,
    });
    expect(deriveCacheInjectionKey(req)).toBe(StickySessionManager.computeSessionKey(req));
  });

  it('returns undefined when no client or Plexus key exists', () => {
    expect(deriveCacheInjectionKey(request({ messages: [] }))).toBeUndefined();
  });
});

describe('applyBodyCacheKeyInjection', () => {
  it('sets prompt_cache_key on OpenAI-style targets', () => {
    const out = applyBodyCacheKeyInjection(
      { input: [] },
      route({ cache_key_injection: 'prompt_cache_key' }),
      request({ prompt_cache_key: 'k' }),
      'responses'
    );
    expect(out.prompt_cache_key).toBe('k');
  });

  it('does not add unknown fields to messages targets', () => {
    const out = applyBodyCacheKeyInjection(
      { messages: [] },
      route({ cache_key_injection: 'prompt_cache_key' }),
      request({ prompt_cache_key: 'k' }),
      'messages'
    );
    expect(out.prompt_cache_key).toBeUndefined();
  });

  it('ignores header destinations', () => {
    const out = applyBodyCacheKeyInjection(
      { input: [] },
      route({ cache_key_injection: 'session_id' }),
      request({ prompt_cache_key: 'k' }),
      'responses'
    );
    expect(out.prompt_cache_key).toBeUndefined();
  });
});

describe('applyHeaderCacheKeyInjection', () => {
  it('maps the session_id option to the session-id wire header', () => {
    const out = applyHeaderCacheKeyInjection(
      { Authorization: 'Bearer x' },
      route({ oauth_provider: 'meta', cache_key_injection: 'session_id' }),
      request({ prompt_cache_key: 'k' })
    );
    expect(out['session-id']).toBe('k');
    expect(out['session_id']).toBeUndefined();
  });

  it('does not overwrite a client header that is already present (any casing)', () => {
    const out = applyHeaderCacheKeyInjection(
      { 'X-Session-Affinity': 'client-value' },
      route({ oauth_provider: 'meta', cache_key_injection: 'x-session-affinity' }),
      request({ prompt_cache_key: 'k' })
    );
    expect(out['x-session-affinity']).toBeUndefined();
    expect(out['X-Session-Affinity']).toBe('client-value');
  });

  it('ignores body destinations', () => {
    const out = applyHeaderCacheKeyInjection(
      { Authorization: 'Bearer x' },
      route({ oauth_provider: 'meta' }),
      request({ prompt_cache_key: 'k' })
    );
    expect(out['prompt_cache_key']).toBeUndefined();
    expect(out['x-client-request-id']).toBeUndefined();
  });

  it('hashes an unsafe client body key before using it as a header value', () => {
    const out = applyHeaderCacheKeyInjection(
      { Authorization: 'Bearer x' },
      route({ oauth_provider: 'meta', cache_key_injection: 'x-session-affinity' }),
      request({ prompt_cache_key: 'bad\r\nvalue' })
    );
    expect(out['x-session-affinity']).toMatch(/^[0-9a-f]{64}$/);
  });
});
