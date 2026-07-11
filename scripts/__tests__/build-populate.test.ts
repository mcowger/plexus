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
          },
          extraBody: {
            nested: { clientSecret: 'nested-live-secret', id_token: 'live-id-token' },
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
    expect(result.providers.example.headers).toEqual({
      Authorization: 'mock-authorization-value',
      'x-custom-auth': 'mock-x-custom-auth-value',
    });
    expect(result.providers.example.extraBody).toMatchObject({
      nested: {
        clientSecret: 'mock-clientsecret-value',
        id_token: 'mock-id-token-value',
      },
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
});
