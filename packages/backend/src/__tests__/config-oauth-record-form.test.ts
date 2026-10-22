import { isOAuthPlaceholderUrl } from '@plexus/shared';
import { describe, expect, test } from 'vitest';

import { getProviderTypes, ProviderConfigSchema, validateConfig } from '../config';

const oauthProvider = {
  api_key: 'oauth',
  oauth_provider: 'openai-codex',
  oauth_account: 'default',
};

describe('api_base_url oauth:// handling', () => {
  test.each([
    ['oauth://', true],
    [' OAUTH://account ', true],
    ['https://provider.example/oauth://', false],
    ['oauth:/', false],
    ['', false],
  ] as const)('classifies shared OAuth placeholder %j as %j', (url, expected) => {
    expect(isOAuthPlaceholderUrl(url)).toBe(expected);
  });

  test.each(['oauth://', 'OAuth://', ' OAUTH:// '])(
    'accepts string placeholder %j without a static API key',
    (api_base_url) => {
      const parsed = ProviderConfigSchema.parse({
        oauth_provider: oauthProvider.oauth_provider,
        oauth_account: oauthProvider.oauth_account,
        api_base_url,
      });

      expect(getProviderTypes(parsed)).toEqual(['oauth']);
    }
  );

  test.each(['OAuth://', ' oauth:// ', ' OAUTH:// '])(
    'requires an OAuth provider for string placeholder %j even with a static key',
    (api_base_url) => {
      const parsed = ProviderConfigSchema.safeParse({ api_key: 'key', api_base_url });

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining(["'oauth_provider' must be specified when using oauth://"])
      );
    }
  );

  test.each(['oauth://', 'OAuth://', ' oauth:// '])(
    'accepts a placeholder %j with no account (derived from the provider slug)',
    (api_base_url) => {
      const parsed = ProviderConfigSchema.safeParse({
        oauth_provider: oauthProvider.oauth_provider,
        api_base_url,
      });

      expect(parsed.success).toBe(true);
    }
  );

  test.each(['OAuth://', ' oauth:// ', ' OAUTH:// '])(
    'rejects raw passthrough for string placeholder %j',
    (api_base_url) => {
      const parsed = ProviderConfigSchema.safeParse({
        ...oauthProvider,
        api_base_url,
        raw_passthrough: { enabled: true, base_url: 'https://provider.example/v1' },
      });

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((issue) => issue.message)).toContain(
        'raw_passthrough currently supports static API-key providers only'
      );
    }
  );

  test.each(['oauth://', 'OAuth://', ' OAUTH:// '])(
    'migrates a legacy OAuth account for placeholder %j',
    (api_base_url) => {
      const config = validateConfig(
        JSON.stringify({
          providers: { legacy: { api_base_url, oauth_provider: 'openai-codex' } },
          models: {},
          keys: {},
        })
      );

      expect(config.providers.legacy?.oauth_account).toBe('legacy');
    }
  );

  test('accepts the string form for OAuth providers', () => {
    const parsed = ProviderConfigSchema.safeParse({
      ...oauthProvider,
      api_base_url: 'oauth://',
    });

    expect(parsed.success).toBe(true);
  });

  test.each(['oauth://', 'OAuth://', ' oauth:// ', ' OAUTH:// '])(
    'rejects placeholder %j inside the record form',
    (placeholder) => {
      const parsed = ProviderConfigSchema.safeParse({
        ...oauthProvider,
        api_base_url: { 'codex-images': placeholder },
      });

      expect(parsed.success).toBe(false);
      expect(JSON.stringify(parsed.error?.issues)).toContain(
        "use the string form api_base_url: 'oauth://'"
      );
    }
  );

  test('rejects oauth:// alongside real URLs in the record form', () => {
    const parsed = ProviderConfigSchema.safeParse({
      ...oauthProvider,
      api_base_url: { chat: 'https://provider.example/v1', 'codex-images': 'oauth://' },
    });

    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain(
      "use the string form api_base_url: 'oauth://'"
    );
  });

  test('still accepts a record form of real URLs', () => {
    const parsed = ProviderConfigSchema.safeParse({
      api_key: 'provider-key',
      api_base_url: { chat: 'https://provider.example/v1', gemini: 'https://gemini.example' },
    });

    expect(parsed.success).toBe(true);
  });
});
