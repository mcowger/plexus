import { describe, expect, test } from 'vitest';
import type { ProviderConfig } from '../../config';
import {
  buildRawUpstreamHeaders,
  buildRawUpstreamUrl,
  filterRawResponseHeaders,
} from '../raw-passthrough';

const provider: ProviderConfig = {
  api_base_url: 'https://provider.example/v1',
  api_key: 'provider-secret',
  disable_cooldown: false,
  stall_cooldown: false,
  estimateTokens: false,
  useClaudeMasking: false,
  raw_passthrough: {
    enabled: true,
    base_url: 'https://provider.example/api',
    auth: 'bearer',
  },
};

describe('raw passthrough transport helpers', () => {
  test('preserves non-authentication request headers', () => {
    const headers = buildRawUpstreamHeaders(
      {
        authorization: 'Bearer plexus-secret',
        host: 'plexus.example',
        connection: 'keep-alive',
        'keep-alive': 'timeout=5',
        'transfer-encoding': 'chunked',
        cookie: 'provider-session=value',
        'x-client-feature': 'enabled',
        'x-plexus-internal': 'remove-me',
      },
      provider,
      12
    );

    expect(headers.authorization).toBe('Bearer provider-secret');
    expect(headers.host).toBeUndefined();
    expect(headers.connection).toBe('keep-alive');
    expect(headers['keep-alive']).toBe('timeout=5');
    expect(headers['transfer-encoding']).toBe('chunked');
    expect(headers.cookie).toBe('provider-session=value');
    expect(headers['x-client-feature']).toBe('enabled');
    expect(headers['x-plexus-internal']).toBeUndefined();
    expect(headers['content-length']).toBeUndefined();
  });

  test('preserves response connection and framing headers', () => {
    expect(
      filterRawResponseHeaders({
        connection: 'keep-alive',
        'keep-alive': 'timeout=5',
        'transfer-encoding': 'chunked',
        'content-type': 'application/octet-stream',
      })
    ).toEqual({
      connection: 'keep-alive',
      'keep-alive': 'timeout=5',
      'transfer-encoding': 'chunked',
      'content-type': 'application/octet-stream',
    });
  });

  test.each([
    '/../admin',
    '/%2e%2e/admin',
    '/.%2e/admin',
    '/%252e%252e/admin',
  ])('rejects base-path traversal through %s', (suffix) => {
    expect(() => buildRawUpstreamUrl('https://provider.example/api', suffix)).toThrow(
      'cannot contain dot segments'
    );
  });

  test('keeps normal raw paths under the configured base path', () => {
    expect(
      buildRawUpstreamUrl(
        'https://provider.example/api',
        '/v1/responses?redirect=https%3A%2F%2Fother.example'
      ).href
    ).toBe('https://provider.example/api/v1/responses?redirect=https%3A%2F%2Fother.example');
  });
});
