import { describe, expect, test } from 'bun:test';

import { ProviderConfigSchema } from '../../../config';
import type { UnifiedChatRequest } from '../../../types/unified';
import type { RouteResult } from '../../routing/router';
import { setupProviderHeaders } from '../provider-request-headers';

function messagesRoute(config: Record<string, unknown>): RouteResult {
  return {
    provider: 'kilocode',
    model: 'anthropic/claude-haiku-5.5',
    config: ProviderConfigSchema.parse({
      api_base_url: 'https://api.kilo.ai/api/gateway',
      api_key: 'provider-key',
      ...config,
    }),
  };
}

const messagesRequest: UnifiedChatRequest = {
  model: 'anthropic/claude-haiku-5.5',
  messages: [],
  stream: false,
};

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

  test('sends only x-api-key on Messages by default', () => {
    const headers = setupProviderHeaders(messagesRoute({}), 'messages', messagesRequest);

    expect(headers['x-api-key']).toBe('provider-key');
    expect(headers).not.toHaveProperty('Authorization');
  });

  test('also sends Bearer auth on Messages when messages_bearer_auth is set', () => {
    const headers = setupProviderHeaders(
      messagesRoute({ messages_bearer_auth: true }),
      'messages',
      messagesRequest
    );

    expect(headers['x-api-key']).toBe('provider-key');
    expect(headers['Authorization']).toBe('Bearer provider-key');
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

  test('sends a dedicated OpenCode session without a generic session-id', () => {
    const headers = setupProviderHeaders(
      {
        provider: 'opencode-go-provider',
        config: { api_key: 'provider-key', pi_ai_provider: 'opencode-go', auto_compat: true },
      } as any,
      'chat',
      {
        stream: true,
        cacheRoutingHeaders: { 'x-opencode-session': 'zen-session-1' },
      } as any
    );

    expect(headers['x-opencode-session']).toBe('zen-session-1');
    expect(headers).not.toHaveProperty('session-id');
  });

  test('prefers the dedicated OpenCode session over the generic session id', () => {
    const headers = setupProviderHeaders(
      {
        provider: 'opencode-go-provider',
        config: { api_key: 'provider-key', pi_ai_provider: 'opencode-go', auto_compat: true },
      } as any,
      'chat',
      {
        stream: true,
        cacheRoutingHeaders: {
          session_id: 'conversation-1',
          'x-opencode-session': 'zen-session-1',
        },
      } as any
    );

    expect(headers['x-opencode-session']).toBe('zen-session-1');
    expect(headers['session-id']).toBe('conversation-1');
  });

  test('does not forward a dedicated OpenCode session to other providers', () => {
    const headers = setupProviderHeaders(
      {
        provider: 'openai',
        config: { api_key: 'provider-key', auto_compat: true },
      } as any,
      'chat',
      {
        stream: true,
        cacheRoutingHeaders: { 'x-opencode-session': 'zen-session-1' },
      } as any
    );

    expect(headers).not.toHaveProperty('x-opencode-session');
    expect(headers).not.toHaveProperty('session-id');
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
