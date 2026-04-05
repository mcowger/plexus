import { describe, expect, it } from 'bun:test';
import { validateConfig } from '../config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal valid YAML wrapper — only specify the provider fields that matter.
 */
const makeYaml = (providersYaml: string) => `
providers:
${providersYaml}
models: {}
keys: {}
`;

// ---------------------------------------------------------------------------
// disable_quota_check: default behaviour (false)
// ---------------------------------------------------------------------------

describe('disable_quota_check — default behaviour', () => {
  it('does NOT suppress implicit quota checker for openai-codex when field is absent', () => {
    const config = validateConfig(
      makeYaml(`
  codex-provider:
    api_base_url: "oauth://"
    api_key: "oauth"
    oauth_provider: "openai-codex"
    oauth_account: "test-account"`)
    );
    expect(config.quotas).toHaveLength(1);
    expect(config.quotas[0]).toMatchObject({
      provider: 'codex-provider',
      type: 'openai-codex',
    });
  });

  it('does NOT suppress implicit quota checker when disable_quota_check is explicitly false', () => {
    const config = validateConfig(
      makeYaml(`
  codex-provider:
    api_base_url: "oauth://"
    api_key: "oauth"
    oauth_provider: "openai-codex"
    oauth_account: "test-account"
    disable_quota_check: false`)
    );
    expect(config.quotas).toHaveLength(1);
    expect(config.quotas[0]).toMatchObject({
      provider: 'codex-provider',
      type: 'openai-codex',
    });
  });
});

// ---------------------------------------------------------------------------
// disable_quota_check: suppression behaviour (true)
// ---------------------------------------------------------------------------

describe('disable_quota_check — suppression behaviour', () => {
  it('suppresses implicit quota checker for openai-codex when set to true', () => {
    const config = validateConfig(
      makeYaml(`
  codex-provider:
    api_base_url: "oauth://"
    api_key: "oauth"
    oauth_provider: "openai-codex"
    oauth_account: "test-account"
    disable_quota_check: true`)
    );
    expect(config.quotas).toHaveLength(0);
  });

  it('suppresses implicit quota checker for github-copilot when set to true', () => {
    const config = validateConfig(
      makeYaml(`
  copilot-provider:
    api_base_url: "oauth://"
    api_key: "oauth"
    oauth_provider: "github-copilot"
    oauth_account: "test-account"
    disable_quota_check: true`)
    );
    expect(config.quotas).toHaveLength(0);
  });

  it('suppresses implicit quota checker for google-gemini-cli when set to true', () => {
    const config = validateConfig(
      makeYaml(`
  gemini-provider:
    api_base_url: "oauth://"
    api_key: "oauth"
    oauth_provider: "google-gemini-cli"
    oauth_account: "test-account"
    disable_quota_check: true`)
    );
    expect(config.quotas).toHaveLength(0);
  });

  it('suppresses implicit quota checker for google-antigravity when set to true', () => {
    const config = validateConfig(
      makeYaml(`
  antigravity-provider:
    api_base_url: "oauth://"
    api_key: "oauth"
    oauth_provider: "google-antigravity"
    oauth_account: "test-account"
    disable_quota_check: true`)
    );
    expect(config.quotas).toHaveLength(0);
  });

  it('produces zero quotas when the sole provider opts out', () => {
    const config = validateConfig(
      makeYaml(`
  single-provider:
    api_base_url: "oauth://"
    api_key: "oauth"
    oauth_provider: "openai-codex"
    oauth_account: "acct"
    disable_quota_check: true`)
    );
    expect(config.quotas).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// disable_quota_check: also suppresses explicit quota_checker blocks
// ---------------------------------------------------------------------------

describe('disable_quota_check — also suppresses explicit quota_checker blocks', () => {
  it('suppresses an explicit quota_checker block when disable_quota_check is true', () => {
    const config = validateConfig(
      makeYaml(`
  codex-provider:
    api_base_url: "oauth://"
    api_key: "oauth"
    oauth_provider: "openai-codex"
    oauth_account: "test-account"
    disable_quota_check: true
    quota_checker:
      type: openai-codex
      intervalMinutes: 15`)
    );
    // disable_quota_check overrides even an explicitly-configured checker
    expect(config.quotas).toHaveLength(0);
  });

  it('still registers an explicit quota_checker when disable_quota_check is false', () => {
    const config = validateConfig(
      makeYaml(`
  codex-provider:
    api_base_url: "oauth://"
    api_key: "oauth"
    oauth_provider: "openai-codex"
    oauth_account: "test-account"
    disable_quota_check: false
    quota_checker:
      type: openai-codex
      intervalMinutes: 15`)
    );
    expect(config.quotas).toHaveLength(1);
    expect(config.quotas[0]).toMatchObject({
      provider: 'codex-provider',
      type: 'openai-codex',
      intervalMinutes: 15,
    });
  });

  it('suppresses an explicit quota_checker on a non-OAuth provider when disable_quota_check is true', () => {
    const config = validateConfig(
      makeYaml(`
  openai-provider:
    api_base_url: "https://api.openai.com/v1"
    api_key: "sk-test"
    disable_quota_check: true
    quota_checker:
      type: synthetic`)
    );
    expect(config.quotas).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// disable_quota_check: selective suppression in multi-provider configs
// ---------------------------------------------------------------------------

describe('disable_quota_check — selective suppression in multi-provider configs', () => {
  it('suppresses only the opted-out provider while leaving others intact', () => {
    const config = validateConfig(
      makeYaml(`
  opted-out-provider:
    api_base_url: "oauth://"
    api_key: "oauth"
    oauth_provider: "openai-codex"
    oauth_account: "account-a"
    disable_quota_check: true

  active-provider:
    api_base_url: "oauth://"
    api_key: "oauth"
    oauth_provider: "github-copilot"
    oauth_account: "account-b"`)
    );

    expect(config.quotas).toHaveLength(1);
    expect(config.quotas[0]).toMatchObject({
      provider: 'active-provider',
      type: 'copilot',
    });
    expect(config.quotas.some((q) => q.provider === 'opted-out-provider')).toBe(false);
  });

  it('suppresses both providers when both have disable_quota_check: true', () => {
    const config = validateConfig(
      makeYaml(`
  provider-a:
    api_base_url: "oauth://"
    api_key: "oauth"
    oauth_provider: "openai-codex"
    oauth_account: "account-a"
    disable_quota_check: true

  provider-b:
    api_base_url: "oauth://"
    api_key: "oauth"
    oauth_provider: "github-copilot"
    oauth_account: "account-b"
    disable_quota_check: true`)
    );

    expect(config.quotas).toHaveLength(0);
  });

  it('both providers get implicit checkers when neither opts out', () => {
    const config = validateConfig(
      makeYaml(`
  provider-a:
    api_base_url: "oauth://"
    api_key: "oauth"
    oauth_provider: "openai-codex"
    oauth_account: "account-a"

  provider-b:
    api_base_url: "oauth://"
    api_key: "oauth"
    oauth_provider: "github-copilot"
    oauth_account: "account-b"`)
    );

    expect(config.quotas).toHaveLength(2);
    const types = config.quotas.map((q) => q.type).sort();
    expect(types).toContain('openai-codex');
    expect(types).toContain('copilot');
  });
});

// ---------------------------------------------------------------------------
// disable_quota_check: non-OAuth providers — field is accepted but has no effect
// ---------------------------------------------------------------------------

describe('disable_quota_check — non-OAuth providers', () => {
  it('is accepted on a regular API provider without validation error', () => {
    expect(() =>
      validateConfig(
        makeYaml(`
  openai-provider:
    api_base_url: "https://api.openai.com/v1"
    api_key: "sk-test-key"
    disable_quota_check: true`)
      )
    ).not.toThrow();
  });

  it('has no effect on a non-OAuth provider (no implicit checkers are injected anyway)', () => {
    const config = validateConfig(
      makeYaml(`
  openai-provider:
    api_base_url: "https://api.openai.com/v1"
    api_key: "sk-test-key"
    disable_quota_check: true`)
    );
    expect(config.quotas).toHaveLength(0);
  });
});
