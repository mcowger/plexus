import { describe, expect, it } from 'vitest';
import {
  getOAuthProviderAuth,
  isKnownOAuthProviderId,
  listOAuthProviders,
} from '../oauth-providers';

// Plexus exposes every OAuth-capable provider pi-ai ships except 'radius',
// which is a configurable gateway factory rather than a fixed identity
// provider (see oauth-providers.ts doc comment).
describe('oauth-providers facade', () => {
  it('recognizes every OAuth-capable pi-ai provider except radius', () => {
    for (const id of [
      'anthropic',
      'openai-codex',
      'github-copilot',
      'xai',
      'kimi-coding',
      'openrouter',
    ]) {
      expect(isKnownOAuthProviderId(id)).toBe(true);
      expect(getOAuthProviderAuth(id)).toBeDefined();
    }
  });

  it('blocks radius', () => {
    expect(isKnownOAuthProviderId('radius')).toBe(false);
    expect(getOAuthProviderAuth('radius')).toBeUndefined();
  });

  it('rejects unknown/non-OAuth provider ids', () => {
    expect(isKnownOAuthProviderId('not-a-real-provider')).toBe(false);
    expect(isKnownOAuthProviderId('openai')).toBe(false); // no auth.oauth
  });

  it('never lists radius', () => {
    expect(listOAuthProviders().some((p) => p.id === 'radius')).toBe(false);
  });
});
