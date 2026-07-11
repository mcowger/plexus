import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { buildPopulate } from '../build-populate';

function collectUrls(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.includes('://') ? [value] : [];
  }
  if (Array.isArray(value)) return value.flatMap(collectUrls);
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(collectUrls);
  }
  return [];
}

describe('buildPopulate', () => {
  it('replaces source key secrets and external provider endpoints', () => {
    const sourceSecret = 'sk-live-source-secret';
    const result = buildPopulate({
      providers: {
        example: {
          api_key: 'sk-live-provider-secret',
          api_base_url: { chat: 'https://api.example.com/v1' },
          headers: {
            Authorization: 'Bearer live-header-secret',
            'x-custom-auth': 'another-live-header-secret',
            'x-structured-auth': { value: 'structured-live-header-secret' },
          },
          extraBody: {
            nested: { clientSecret: 'nested-live-secret', id_token: 'live-id-token' },
            credentials: { value: 'opaque-live-credential', expiresAt: 12345 },
            estimateTokens: true,
          },
          quota_checker: {
            enabled: true,
            options: {
              endpoint: 'https://api.example.com/quota',
              session: 'live-session',
            },
          },
        },
      },
      keys: { CI: { secret: sourceSecret, comment: 'CI key' } },
    });

    expect(result.keys.CI.secret).toBe('sk-dev-ci-00000000000000000000000000000000');
    expect(JSON.stringify(result)).not.toContain(sourceSecret);
    expect(JSON.stringify(result)).not.toContain('live-header-secret');
    expect(JSON.stringify(result)).not.toContain('nested-live-secret');
    expect(JSON.stringify(result)).not.toContain('live-id-token');
    expect(JSON.stringify(result)).not.toContain('structured-live-header-secret');
    expect(JSON.stringify(result)).not.toContain('opaque-live-credential');
    expect(result.providers.example.headers).toEqual({
      Authorization: 'mock-authorization-value',
      'x-custom-auth': 'mock-x-custom-auth-value',
      'x-structured-auth': { value: 'mock-value-value' },
    });
    expect(result.providers.example.extraBody).toMatchObject({
      nested: {
        clientSecret: 'mock-clientsecret-value',
        id_token: 'mock-id-token-value',
      },
      credentials: { value: 'mock-value-value', expiresAt: 0 },
      estimateTokens: true,
    });
    expect(result.providers.example.api_base_url.chat).toBe('http://localhost:4010/v1');
    expect(result.providers.example.quota_checker).toMatchObject({
      enabled: false,
      options: {
        endpoint: 'http://localhost:4010/mock/quota',
        session: 'mock-session-value',
      },
    });
  });

  it('keeps every committed provider URL local', () => {
    const fixturePath = fileURLToPath(new URL('../default-populate.json', import.meta.url));
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const urls = collectUrls(fixture.providers);

    expect(urls.length).toBeGreaterThan(0);
    for (const value of urls) {
      expect(new URL(value).hostname).toBe('localhost');
    }
  });

  it('only grants keys access to routable model names', () => {
    const fixturePath = fileURLToPath(new URL('../default-populate.json', import.meta.url));
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const routableModels = new Set(Object.keys(fixture.aliases));
    for (const alias of Object.values(fixture.aliases) as any[]) {
      for (const additionalAlias of alias.additional_aliases ?? []) {
        routableModels.add(additionalAlias);
      }
    }

    for (const key of Object.values(fixture.keys) as any[]) {
      for (const allowedModel of key.allowedModels ?? []) {
        expect(routableModels.has(allowedModel), allowedModel).toBe(true);
      }
    }
  });
});
