import { describe, expect, test } from 'vitest';
import {
  captureConnectionDraft,
  connectionModeOf,
  oauthConnectionDraft,
  switchConnectionMode,
} from '../../../frontend/src/lib/providerConnectionDraft';

interface TestProvider {
  id: string;
  name: string;
  type: string | string[];
  apiBaseUrl?: string | Record<string, string>;
  apiKey: string;
  oauthProvider?: string;
  models?: Record<string, unknown>;
  pi_ai_quirks?: Record<string, unknown>;
}

function urlProvider(): TestProvider {
  return {
    id: 'acme',
    name: 'Acme',
    type: ['chat', 'embeddings'],
    apiBaseUrl: {
      chat: 'https://acme.test/v1',
      embeddings: 'https://acme.test/v1/embeddings',
    },
    apiKey: 'sk-secret',
    oauthProvider: '',
    models: { 'gpt-x': { pricing: { input: 1, output: 2 } } },
    pi_ai_quirks: { disableStreaming: true },
  };
}

function oauthProvider(): TestProvider {
  return {
    id: 'acme',
    name: 'Acme',
    type: ['oauth'],
    apiBaseUrl: 'oauth://',
    apiKey: 'oauth',
    oauthProvider: 'anthropic',
    models: { 'claude-x': { pricing: { input: 1, output: 2 } } },
    pi_ai_quirks: { disableStreaming: true },
  };
}

describe('connectionModeOf', () => {
  test('detects OAuth from the oauth:// placeholder', () => {
    expect(connectionModeOf({ apiBaseUrl: 'oauth://' })).toBe('oauth');
    expect(connectionModeOf({ apiBaseUrl: 'oauth://account' })).toBe('oauth');
  });

  test('treats map and plain URLs as URL mode', () => {
    expect(connectionModeOf({ apiBaseUrl: { chat: 'https://x.test/v1' } })).toBe('url');
    expect(connectionModeOf({ apiBaseUrl: 'https://x.test/v1' })).toBe('url');
    expect(connectionModeOf({ apiBaseUrl: {} })).toBe('url');
    expect(connectionModeOf({})).toBe('url');
  });
});

describe('captureConnectionDraft', () => {
  test('copies the map so later edits do not mutate the snapshot', () => {
    const provider = urlProvider();
    const draft = captureConnectionDraft(provider);
    (provider.apiBaseUrl as Record<string, string>).chat = 'https://mutated.test/v1';
    expect(draft.apiBaseUrl).toEqual({
      chat: 'https://acme.test/v1',
      embeddings: 'https://acme.test/v1/embeddings',
    });
  });
});

describe('switchConnectionMode', () => {
  test('URL -> OAuth -> URL preserves the URL connection draft', () => {
    const provider = urlProvider();

    const toOAuth = switchConnectionMode(provider, 'oauth', {}, 'openai-codex');
    expect(toOAuth.provider.apiBaseUrl).toBe('oauth://');
    expect(toOAuth.provider.apiKey).toBe('oauth');
    expect(toOAuth.provider.oauthProvider).toBe('openai-codex');
    expect(toOAuth.provider.type).toEqual(['oauth']);

    const backToUrl = switchConnectionMode(toOAuth.provider, 'url', toOAuth.drafts, 'openai-codex');
    expect(backToUrl.provider.apiBaseUrl).toEqual(provider.apiBaseUrl);
    expect(backToUrl.provider.apiKey).toBe('sk-secret');
    expect(backToUrl.provider.oauthProvider).toBe('');
    expect(backToUrl.provider.type).toEqual(['chat', 'embeddings']);
  });

  test('OAuth -> URL -> OAuth preserves the OAuth connection draft', () => {
    const provider = oauthProvider();

    const toUrl = switchConnectionMode(provider, 'url', {}, 'openai-codex');
    expect(toUrl.provider.apiBaseUrl).toEqual({});
    expect(toUrl.provider.apiKey).toBe('');
    expect(toUrl.provider.type).toEqual([]);

    const backToOAuth = switchConnectionMode(toUrl.provider, 'oauth', toUrl.drafts, 'openai-codex');
    expect(backToOAuth.provider.apiBaseUrl).toBe('oauth://');
    expect(backToOAuth.provider.apiKey).toBe('oauth');
    expect(backToOAuth.provider.oauthProvider).toBe('anthropic');
    expect(backToOAuth.provider.type).toEqual(['oauth']);
  });

  test('round trip keeps models, quirks, and other unrelated fields', () => {
    const provider = urlProvider();
    const toOAuth = switchConnectionMode(provider, 'oauth', {}, 'openai-codex');
    const backToUrl = switchConnectionMode(toOAuth.provider, 'url', toOAuth.drafts, 'openai-codex');

    expect(backToUrl.provider.id).toBe('acme');
    expect(backToUrl.provider.name).toBe('Acme');
    expect(backToUrl.provider.models).toEqual(provider.models);
    expect(backToUrl.provider.pi_ai_quirks).toEqual(provider.pi_ai_quirks);
  });

  test('returns a copied map so mutating the original draft does not leak', () => {
    const provider = urlProvider();
    const toOAuth = switchConnectionMode(provider, 'oauth', {}, 'openai-codex');
    (provider.apiBaseUrl as Record<string, string>).chat = 'https://mutated.test/v1';

    const backToUrl = switchConnectionMode(toOAuth.provider, 'url', toOAuth.drafts, 'openai-codex');
    expect(backToUrl.provider.apiBaseUrl).toEqual({
      chat: 'https://acme.test/v1',
      embeddings: 'https://acme.test/v1/embeddings',
    });
  });

  test('switching to the current mode is a no-op', () => {
    const provider = urlProvider();
    const drafts = { oauth: oauthConnectionDraft('anthropic') };
    const result = switchConnectionMode(provider, 'url', drafts, 'openai-codex');
    expect(result.provider).toBe(provider);
    expect(result.drafts).toBe(drafts);
  });

  test('a first OAuth switch uses the draft OAuth provider before the fallback', () => {
    const provider = { ...urlProvider(), oauthProvider: 'meta' };
    const result = switchConnectionMode(provider, 'oauth', {}, 'openai-codex');
    expect(result.provider.oauthProvider).toBe('meta');
  });
});
