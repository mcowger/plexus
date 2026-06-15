import { describe, expect, it } from 'vitest';
import { validateConfig } from '../config';

const makeConfigJson = (quotaCheckerOptions: Record<string, unknown>): string =>
  JSON.stringify({
    providers: {
      'minimax-provider': {
        api_base_url: 'https://platform.minimax.io',
        api_key: 'test-api-key',
        quota_checker: {
          type: 'minimax',
          options: quotaCheckerOptions,
        },
      },
    },
    models: {},
    keys: {},
  });

describe('config quota checker validation', () => {
  it('accepts openai-codex quota checker type', () => {
    const config = validateConfig(
      JSON.stringify({
        providers: {
          'codex-provider': {
            api_base_url: 'oauth://',
            api_key: 'oauth',
            oauth_provider: 'openai-codex',
            oauth_account: 'test-account',
            quota_checker: {
              type: 'openai-codex',
            },
          },
        },
        models: {},
        keys: {},
      })
    );

    expect(config.quotas).toHaveLength(1);
    expect(config.quotas[0]).toMatchObject({
      provider: 'codex-provider',
      type: 'openai-codex',
      intervalMinutes: 30,
    });
  });

  it('accepts claude-code quota checker type', () => {
    const config = validateConfig(
      JSON.stringify({
        providers: {
          'claude-provider': {
            api_base_url: 'oauth://',
            api_key: 'oauth',
            oauth_provider: 'anthropic',
            oauth_account: 'test-account',
            quota_checker: {
              type: 'claude-code',
            },
          },
        },
        models: {},
        keys: {},
      })
    );

    expect(config.quotas).toHaveLength(1);
    expect(config.quotas[0]).toMatchObject({
      provider: 'claude-provider',
      type: 'claude-code',
      intervalMinutes: 30,
    });
  });

  it('accepts minimax quota checker when groupid and token are provided', () => {
    const config = validateConfig(
      makeConfigJson({
        groupid: 'group-123',
        token: 'jwt-token-secret',
      })
    );

    expect(config.quotas).toHaveLength(1);
    expect(config.quotas[0]).toMatchObject({
      id: 'minimax-provider',
      provider: 'minimax-provider',
      type: 'minimax',
      options: {
        groupid: 'group-123',
        token: 'jwt-token-secret',
      },
    });
  });

  it('rejects minimax quota checker when groupid is missing', () => {
    expect(() => validateConfig(makeConfigJson({ token: 'jwt-token-secret' }))).toThrow(
      '"groupid"'
    );
  });

  it('rejects minimax quota checker when token is missing', () => {
    expect(() => validateConfig(makeConfigJson({ groupid: 'group-123' }))).toThrow('"token"');
  });

  it('rejects minimax quota checker when required fields are empty strings', () => {
    expect(() =>
      validateConfig(
        makeConfigJson({
          groupid: '   ',
          token: '   ',
        })
      )
    ).toThrow('MiniMax groupid is required');
  });

  it('accepts devpass quota checker with session cookie', () => {
    const config = validateConfig(
      JSON.stringify({
        providers: {
          'devpass-provider': {
            api_base_url: 'https://internal.llmgateway.io',
            api_key: 'devpass-api-key',
            quota_checker: {
              type: 'devpass',
              options: {
                session: 'my-session-token',
              },
            },
          },
        },
        models: {},
        keys: {},
      })
    );

    expect(config.quotas).toHaveLength(1);
    expect(config.quotas[0]).toMatchObject({
      provider: 'devpass-provider',
      type: 'devpass',
      intervalMinutes: 30,
      options: {
        session: 'my-session-token',
      },
    });
  });

  it('accepts kilo quota checker with optional organizationId', () => {
    const config = validateConfig(
      JSON.stringify({
        providers: {
          'kilo-provider': {
            api_base_url: 'https://api.kilo.ai',
            api_key: 'kilo-api-key',
            quota_checker: {
              type: 'kilo',
              options: {
                endpoint: 'https://api.kilo.ai/api/profile/balance',
                organizationId: 'org-123',
              },
            },
          },
        },
        models: {},
        keys: {},
      })
    );

    expect(config.quotas).toHaveLength(1);
    expect(config.quotas[0]).toMatchObject({
      id: 'kilo-provider',
      provider: 'kilo-provider',
      type: 'kilo',
      options: {
        endpoint: 'https://api.kilo.ai/api/profile/balance',
        organizationId: 'org-123',
      },
    });
  });

  describe('routing-run quota checker', () => {
    it('accepts routing-run without options and injects the provider api key', () => {
      const config = validateConfig(
        JSON.stringify({
          providers: {
            'routing-provider': {
              api_base_url: 'https://api.routing.run',
              api_key: 'routing-secret',
              quota_checker: {
                type: 'routing-run',
              },
            },
          },
          models: {},
          keys: {},
        })
      );

      expect(config.quotas).toHaveLength(1);
      expect(config.quotas[0]).toMatchObject({
        provider: 'routing-provider',
        type: 'routing-run',
        intervalMinutes: 30,
      });
      expect(config.quotas[0]?.options).toMatchObject({
        apiKey: 'routing-secret',
      });
    });

    it('accepts a valid endpoint and preserves it', () => {
      const config = validateConfig(
        JSON.stringify({
          providers: {
            'routing-provider': {
              api_base_url: 'https://api.routing.run',
              api_key: 'routing-secret',
              quota_checker: {
                type: 'routing-run',
                options: {
                  endpoint: 'https://api.routing.run/v1/key',
                },
              },
            },
          },
          models: {},
          keys: {},
        })
      );

      expect(config.quotas[0]?.options).toMatchObject({
        endpoint: 'https://api.routing.run/v1/key',
        apiKey: 'routing-secret',
      });
    });

    it('rejects an invalid endpoint', () => {
      expect(() =>
        validateConfig(
          JSON.stringify({
            providers: {
              'routing-provider': {
                api_base_url: 'https://api.routing.run',
                api_key: 'routing-secret',
                quota_checker: {
                  type: 'routing-run',
                  options: {
                    endpoint: 'not-a-url',
                  },
                },
              },
            },
            models: {},
            keys: {},
          })
        )
      ).toThrow('endpoint');
    });
  });
});
