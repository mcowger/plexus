import { describe, expect, it } from 'vitest';
import {
  matchPiAiProviderByUrls,
  normalizeEndpointUrl,
  resolvePiAiProvider,
} from '../provider-endpoint-match';

const ENDPOINTS = [
  { id: 'anthropic', baseUrl: 'https://api.anthropic.com' },
  { id: 'fireworks', baseUrl: 'https://api.fireworks.ai/inference' },
  { id: 'openai', baseUrl: 'https://api.openai.com/v1' },
  { id: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'no-base-url', baseUrl: '' },
];

describe('normalizeEndpointUrl', () => {
  it('trims, lowercases, and strips trailing slashes', () => {
    expect(normalizeEndpointUrl('  HTTPS://API.OpenAI.COM/v1/ ')).toBe('https://api.openai.com/v1');
  });
});

describe('matchPiAiProviderByUrls', () => {
  it('matches exact base URLs', () => {
    expect(matchPiAiProviderByUrls(['https://api.openai.com/v1'], ENDPOINTS)).toBe('openai');
  });

  it('tolerates trailing slashes and casing', () => {
    expect(matchPiAiProviderByUrls(['https://api.anthropic.com/'], ENDPOINTS)).toBe('anthropic');
  });

  it('matches user URLs that extend a builtin base URL', () => {
    expect(matchPiAiProviderByUrls(['https://api.fireworks.ai/inference/v1'], ENDPOINTS)).toBe(
      'fireworks'
    );
  });

  it('matches a bare host against a longer builtin base URL', () => {
    expect(matchPiAiProviderByUrls(['https://api.openai.com'], ENDPOINTS)).toBe('openai');
  });

  it('prefers exact matches over prefix matches', () => {
    const endpoints = [
      ...ENDPOINTS,
      { id: 'openai-other', baseUrl: 'https://api.openai.com/v1/extra' },
    ];
    expect(matchPiAiProviderByUrls(['https://api.openai.com/v1'], endpoints)).toBe('openai');
  });

  it('prefers the longest prefix on ties', () => {
    const endpoints = [
      { id: 'short', baseUrl: 'https://example.com/api' },
      { id: 'long', baseUrl: 'https://example.com/api/v1' },
    ];
    expect(matchPiAiProviderByUrls(['https://example.com/api/v1/models'], endpoints)).toBe('long');
  });

  it('resolves shared base URLs deterministically', () => {
    const endpoints = [
      { id: 'b-second', baseUrl: 'https://shared.example.com/v1' },
      { id: 'a-first', baseUrl: 'https://shared.example.com/v1' },
    ];
    // First endpoint in list order wins — callers pass sorted ids.
    expect(matchPiAiProviderByUrls(['https://shared.example.com/v1'], endpoints)).toBe('b-second');
  });

  it('returns null for unknown, empty, or blank URLs', () => {
    expect(matchPiAiProviderByUrls(['https://unknown.example.com/v1'], ENDPOINTS)).toBeNull();
    expect(matchPiAiProviderByUrls([], ENDPOINTS)).toBeNull();
    expect(matchPiAiProviderByUrls(['  ', ''], ENDPOINTS)).toBeNull();
  });

  it('rejects sibling hostnames that share a string prefix', () => {
    expect(
      matchPiAiProviderByUrls(['https://api.openai.com.evil.example/v1'], ENDPOINTS)
    ).toBeNull();
    expect(
      matchPiAiProviderByUrls(['https://api.openai.com-example.com/v1'], ENDPOINTS)
    ).toBeNull();
  });

  it('requires path prefixes to end at a segment boundary', () => {
    expect(matchPiAiProviderByUrls(['https://api.openai.com/v10'], ENDPOINTS)).toBeNull();
    expect(matchPiAiProviderByUrls(['https://api.openai.com/v1beta'], ENDPOINTS)).toBeNull();
  });

  it('is sensitive to ports but lenient about http vs https', () => {
    expect(matchPiAiProviderByUrls(['https://api.openai.com:8443/v1'], ENDPOINTS)).toBeNull();
    expect(matchPiAiProviderByUrls(['http://api.openai.com/v1'], ENDPOINTS)).toBe('openai');
  });

  it('ignores non-URL input', () => {
    expect(matchPiAiProviderByUrls(['not a url', 'openai'], ENDPOINTS)).toBeNull();
  });

  it('never matches providers without a base URL', () => {
    expect(matchPiAiProviderByUrls(['no-base-url'], ENDPOINTS)).toBeNull();
  });
});

describe('resolvePiAiProvider', () => {
  const deps = {
    builtinProviderIds: ['anthropic', 'openai-codex', 'openai'],
    endpoints: ENDPOINTS,
  };

  it('prefers a known OAuth provider id over URL matching', () => {
    expect(
      resolvePiAiProvider(
        { oauthProvider: 'openai-codex', urls: ['https://api.openai.com/v1'] },
        deps
      )
    ).toBe('openai-codex');
  });

  it('falls back to URL matching for unknown OAuth ids', () => {
    expect(
      resolvePiAiProvider(
        { oauthProvider: 'not-a-provider', urls: ['https://api.openai.com/v1'] },
        deps
      )
    ).toBe('openai');
  });

  it('returns null when neither OAuth nor URLs match', () => {
    expect(resolvePiAiProvider({ urls: ['https://unknown.example.com'] }, deps)).toBeNull();
    expect(resolvePiAiProvider({}, deps)).toBeNull();
  });
});
