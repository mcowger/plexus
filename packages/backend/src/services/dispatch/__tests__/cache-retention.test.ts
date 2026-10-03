import { describe, expect, it } from 'vitest';
import { resolveStickyCacheTtlMs } from '../cache-retention';

describe('resolveStickyCacheTtlMs', () => {
  it.each([
    [{}, 'chat', 5],
    [null, 'messages', 5],
    [{ prompt_cache_key: 'session' }, 'responses', 5],
    [{ prompt_cache_retention: 'in_memory' }, 'chat', 5],
    [{ prompt_cache_retention: 'unknown' }, 'responses', 5],
    [{ prompt_cache_retention: '24h' }, 'responses:lite', 1440],
    [{ prompt_cache_retention: '24h' }, 'chat', 1440],
    [{ prompt_cache_options: { ttl: '30m' } }, 'responses', 30],
    [{ prompt_cache_options: { ttl: '15m' } }, 'chat', 5],
    [{ prompt_cache_retention: '24h' }, 'gemini', 5],
    [{ prompt_cache_retention: '24h' }, 'messages', 5],
  ])('resolves %j on %s to %i minutes', (payload, apiType, minutes) => {
    expect(resolveStickyCacheTtlMs(payload, apiType)).toBe(minutes * 60 * 1000);
  });

  it.each(['system', 'tools', 'messages'])('reads Anthropic %s breakpoints', (field) => {
    const payload = {
      [field]: [{ cache_control: { type: 'ephemeral', ttl: '1h' } }],
    };
    expect(resolveStickyCacheTtlMs(payload, 'messages')).toBe(60 * 60 * 1000);
    expect(resolveStickyCacheTtlMs(payload, 'chat')).toBe(5 * 60 * 1000);
  });

  it('uses the longest mixed Anthropic TTL and supports automatic caching', () => {
    const payload = {
      system: [{ type: 'text', cache_control: { type: 'ephemeral', ttl: '1h' } }],
      messages: [{ content: [{ cache_control: { type: 'ephemeral', ttl: '5m' } }] }],
    };
    expect(resolveStickyCacheTtlMs(payload, 'messages')).toBe(60 * 60 * 1000);
    expect(
      resolveStickyCacheTtlMs({ cache_control: { type: 'ephemeral', ttl: '1h' } }, 'messages')
    ).toBe(60 * 60 * 1000);
  });

  it('ignores unsupported markers and cache-looking fields inside tool arguments', () => {
    expect(
      resolveStickyCacheTtlMs(
        {
          system: [{ cache_control: { type: 'unknown', ttl: '1h' } }],
          messages: [{ content: [{ input: { cache_control: { type: 'ephemeral', ttl: '1h' } } }] }],
        },
        'messages'
      )
    ).toBe(5 * 60 * 1000);
  });
});
