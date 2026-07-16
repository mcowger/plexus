import { describe, expect, test } from 'vitest';
import { getCacheRoutingHeaders } from '../cache-routing-headers';

describe('getCacheRoutingHeaders', () => {
  test('extracts session affinity headers from an incoming request', () => {
    expect(
      getCacheRoutingHeaders({
        'session-id': 'conversation-1',
        'x-session-affinity': 'conversation-1',
        'x-session-id': 'conversation-1',
        'x-prompt-cache-isolation-key': 'tenant-1',
        'x-multi-turn-session-id': 'rollout-1',
      })
    ).toEqual({
      session_id: 'conversation-1',
      'x-client-request-id': undefined,
      'x-session-affinity': 'conversation-1',
      'x-session-id': 'conversation-1',
      'x-prompt-cache-isolation-key': 'tenant-1',
      'x-multi-turn-session-id': 'rollout-1',
    });
  });

  test('preserves prompt cache key fallbacks for Responses requests', () => {
    expect(getCacheRoutingHeaders({}, 'prompt-1')).toEqual({
      session_id: 'prompt-1',
      'x-client-request-id': 'prompt-1',
      'x-session-affinity': undefined,
      'x-session-id': undefined,
      'x-prompt-cache-isolation-key': undefined,
      'x-multi-turn-session-id': undefined,
    });
  });

  test('returns undefined when no cache routing values are present', () => {
    expect(getCacheRoutingHeaders({})).toBeUndefined();
  });
});
