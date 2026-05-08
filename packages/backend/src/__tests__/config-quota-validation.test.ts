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

  it('accepts minimax quota checker when groupid and hertzSession are provided', () => {
    const config = validateConfig(
      makeConfigJson({
        groupid: 'group-123',
        hertzSession: 'session-secret',
      })
    );

    expect(config.quotas).toHaveLength(1);
    expect(config.quotas[0]).toMatchObject({
      id: 'minimax-provider',
      provider: 'minimax-provider',
      type: 'minimax',
      options: {
        groupid: 'group-123',
        hertzSession: 'session-secret',
      },
    });
  });

  it('rejects minimax quota checker when groupid is missing', () => {
    expect(() => validateConfig(makeConfigJson({ hertzSession: 'session-secret' }))).toThrow(
      '"groupid"'
    );
  });

  it('rejects minimax quota checker when hertzSession is missing', () => {
    expect(() => validateConfig(makeConfigJson({ groupid: 'group-123' }))).toThrow(
      '"hertzSession"'
    );
  });

  it('rejects minimax quota checker when required fields are empty strings', () => {
    expect(() =>
      validateConfig(
        makeConfigJson({
          groupid: '   ',
          hertzSession: '   ',
        })
      )
    ).toThrow('MiniMax groupid is required');
  });

  it('accepts devpass quota checker with session cookie', () => {
    const config = validateConfig(`
providers:
  devpass-provider:
    api_base_url: "https://internal.llmgateway.io"
    api_key: "devpass-api-key"
    quota_checker:
      type: devpass
      options:
        session: "my-session-token"
models: {}
keys: {}
`);

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
});
