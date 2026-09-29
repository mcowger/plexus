import { describe, expect, test } from 'vitest';
import { ProviderConfigSchema } from '../config';

describe('provider cache key injection config', () => {
  test('accepts every documented destination', () => {
    for (const value of [
      'off',
      'prompt_cache_key',
      'session_id',
      'x-client-request-id',
      'x-session-affinity',
      'x-session-id',
      'x-prompt-cache-isolation-key',
      'x-multi-turn-session-id',
    ]) {
      const parsed = ProviderConfigSchema.safeParse({
        api_base_url: 'https://api.meta.ai/v1',
        api_key: 'provider-key',
        cache_key_injection: value,
      });
      expect(parsed.success, value).toBe(true);
    }
  });

  test('rejects an unknown destination', () => {
    const parsed = ProviderConfigSchema.safeParse({
      api_base_url: 'https://api.meta.ai/v1',
      api_key: 'provider-key',
      cache_key_injection: 'not-a-field',
    });
    expect(parsed.success).toBe(false);
  });

  test('is optional and leaves the client request untouched when unset', () => {
    const parsed = ProviderConfigSchema.parse({
      api_base_url: 'https://api.meta.ai/v1',
      api_key: 'provider-key',
    });
    expect(parsed.cache_key_injection).toBeUndefined();
  });
});
