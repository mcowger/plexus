import { describe, expect, it } from 'bun:test';

import {
  getOAuthProviderAuth,
  isKnownOAuthProviderId,
  listOAuthProviders,
} from '../oauth-providers';

// Plexus keeps every OAuth-capable pi-ai provider available, but hides
// retired choices from the management UI list (see oauth-providers.ts).
describe('oauth-providers facade', () => {
  it('recognizes every OAuth-capable pi-ai provider except radius', () => {
    for (const id of [
      'anthropic',
      'openai-codex',
      'github-copilot',
      'xai',
      'kimi-coding',
      'openrouter',
      'meta',
    ]) {
      expect(isKnownOAuthProviderId(id)).toBe(true);
      expect(getOAuthProviderAuth(id)).toBeDefined();
    }
  });

  it('uses the Plexus copy-code login for anthropic (no callback server)', () => {
    const descriptor = getOAuthProviderAuth('anthropic');
    expect(descriptor?.usesCallbackServer).toBe(false);
    expect(descriptor?.oauth.login).toBeTypeOf('function');
  });

  it('recognizes pi-ai\u2019s native meta (Muse subscription) provider', () => {
    expect(isKnownOAuthProviderId('meta')).toBe(true);
    const descriptor = getOAuthProviderAuth('meta');
    expect(descriptor?.id).toBe('meta');
    expect(descriptor?.usesCallbackServer).toBe(false);
    expect(listOAuthProviders().some((p) => p.id === 'meta')).toBe(true);
  });

  it('blocks radius', () => {
    expect(isKnownOAuthProviderId('radius')).toBe(false);
    expect(getOAuthProviderAuth('radius')).toBeUndefined();
  });

  it('rejects unknown/non-OAuth provider ids', () => {
    expect(isKnownOAuthProviderId('not-a-real-provider')).toBe(false);
    expect(isKnownOAuthProviderId('openai')).toBe(false); // no auth.oauth
  });

  it('does not list radius or legacy OpenAI Codex for new provider choices', () => {
    const listedIds = listOAuthProviders().map((p) => p.id);
    expect(listedIds).not.toContain('radius');
    expect(listedIds).not.toContain('openai-codex');
  });

  it('retains legacy OpenAI Codex OAuth support for existing configurations', () => {
    expect(isKnownOAuthProviderId('openai-codex')).toBe(true);
    expect(getOAuthProviderAuth('openai-codex')).toBeDefined();
  });

  it('lists each provider id once even when overridden', () => {
    const ids = listOAuthProviders().map((p) => p.id);
    expect(ids.length).toBe(new Set(ids).size);
    expect(ids.filter((id) => id === 'anthropic')).toHaveLength(1);
  });
});
