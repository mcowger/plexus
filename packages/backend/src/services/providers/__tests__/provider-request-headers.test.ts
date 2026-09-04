import { describe, expect, test } from 'vitest';
import { setupProviderHeaders } from '../provider-request-headers';

describe('setupProviderHeaders', () => {
  test('forwards session affinity headers to a Messages provider', () => {
    const headers = setupProviderHeaders(
      {
        provider: 'wisgate',
        config: { api_key: 'provider-key' },
      } as any,
      'messages',
      {
        stream: true,
        cacheRoutingHeaders: {
          session_id: 'conversation-1',
          'x-session-affinity': 'conversation-1',
          'x-session-id': 'conversation-1',
          'x-prompt-cache-isolation-key': 'tenant-1',
          'x-multi-turn-session-id': 'rollout-1',
        },
        anthropicBeta: 'prompt-caching-2024-07-31',
      } as any
    );

    expect(headers['session-id']).toBe('conversation-1');
    expect(headers['x-session-affinity']).toBe('conversation-1');
    expect(headers['x-session-id']).toBe('conversation-1');
    expect(headers['x-prompt-cache-isolation-key']).toBe('tenant-1');
    expect(headers['x-multi-turn-session-id']).toBe('rollout-1');
    expect(headers['anthropic-beta']).toBe('prompt-caching-2024-07-31');
  });

  test('does not forward Anthropic beta features to non-Messages providers', () => {
    const headers = setupProviderHeaders(
      {
        provider: 'openai',
        config: { api_key: 'provider-key' },
      } as any,
      'chat',
      {
        stream: false,
        anthropicBeta: 'prompt-caching-2024-07-31',
      } as any
    );

    expect(headers).not.toHaveProperty('anthropic-beta');
  });

  test('uses the Plexus session id for OpenCode Go auto-compat requests', () => {
    const headers = setupProviderHeaders(
      {
        provider: 'opencode-go-provider',
        config: {
          api_key: 'provider-key',
          pi_ai_provider: 'opencode-go',
          auto_compat: true,
        },
      } as any,
      'chat',
      {
        stream: true,
        cacheRoutingHeaders: { session_id: 'conversation-1' },
      } as any
    );

    expect(headers['x-opencode-session']).toBe('conversation-1');
  });

  test('does not add the OpenCode Go session header without auto-compat', () => {
    const headers = setupProviderHeaders(
      {
        provider: 'opencode-go-provider',
        config: { api_key: 'provider-key', pi_ai_provider: 'opencode-go' },
      } as any,
      'chat',
      {
        stream: true,
        cacheRoutingHeaders: { session_id: 'conversation-1' },
      } as any
    );

    expect(headers).not.toHaveProperty('x-opencode-session');
  });

  test('supports model-level auto-compat for OpenCode Go', () => {
    const headers = setupProviderHeaders(
      {
        provider: 'opencode-go-provider',
        config: { api_key: 'provider-key', pi_ai_provider: 'opencode-go' },
        modelConfig: { auto_compat: true },
      } as any,
      'chat',
      {
        stream: true,
        cacheRoutingHeaders: { session_id: 'conversation-1' },
      } as any
    );

    expect(headers['x-opencode-session']).toBe('conversation-1');
  });
});
