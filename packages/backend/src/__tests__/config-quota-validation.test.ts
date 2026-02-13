import { describe, expect, it } from 'bun:test';
import { validateConfig } from '../config';

const makeConfigYaml = (quotaCheckerOptionsYaml: string): string => `
providers:
  minimax-provider:
    api_base_url: "https://platform.minimax.io"
    api_key: "test-api-key"
    quota_checker:
      type: minimax
      options:
${quotaCheckerOptionsYaml}
models: {}
keys: {}
adminKey: "admin-secret"
`;

describe('config quota checker validation', () => {
  it('accepts minimax quota checker when groupid and hertzSession are provided', () => {
    const config = validateConfig(
      makeConfigYaml(`        groupid: "group-123"
        hertzSession: "session-secret"`)
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
    expect(() =>
      validateConfig(
        makeConfigYaml(`        hertzSession: "session-secret"`)
      )
    ).toThrow('"groupid"');
  });

  it('rejects minimax quota checker when hertzSession is missing', () => {
    expect(() =>
      validateConfig(
        makeConfigYaml(`        groupid: "group-123"`)
      )
    ).toThrow('"hertzSession"');
  });

  it('rejects minimax quota checker when required fields are empty strings', () => {
    expect(() =>
      validateConfig(
        makeConfigYaml(`        groupid: "   "
        hertzSession: "   "`)
      )
    ).toThrow('MiniMax groupid is required');
  });
});
