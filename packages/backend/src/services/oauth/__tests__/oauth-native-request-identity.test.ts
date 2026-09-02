/**
 * Regression test (mcowger/plexus#842): the native Anthropic OAuth request's
 * Claude Code identity must be internally consistent and current.
 *
 * Anthropic gates new models on the advertised Claude Code version — read
 * from both the `user-agent` header and the `x-anthropic-billing-header`
 * system block's `cc_version`. An outdated identity is rejected with
 * `claude_code_version_too_old` (claude-fable-5-1 requires >= 2.1.251),
 * so both fields must derive from the same, up-to-date CC_VERSION constant.
 */

import { describe, expect, it } from 'vitest';
import { CC_VERSION } from '../../../transformers/oauth/masking/cc-constants';
import { prepareOAuthNativeRequest } from '../oauth-native-request';

const AUTH = { mode: 'oauth', token: 'oauth-token-for-test' } as const;

function preparedIdentity(): { userAgent: string; ccVersion: string } {
  const prepared = prepareOAuthNativeRequest(
    'anthropic',
    'claude-fable-5-1',
    AUTH,
    {
      model: 'claude-fable-5-1',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'hello' }],
    },
    false
  );
  const userAgent = prepared.headers['user-agent'] ?? '';
  const billingBlock = (prepared.body.system ?? []).find(
    (block: any) =>
      typeof block?.text === 'string' && block.text.startsWith('x-anthropic-billing-header:')
  );
  const ccVersion = /cc_version=([^;]+);/.exec(billingBlock?.text ?? '')?.[1] ?? '';
  return { userAgent, ccVersion };
}

/** Component-wise semantic version comparison (all parts numeric). */
function isVersionAtLeast(candidate: string, minimum: string): boolean {
  const a = candidate.split('.').map(Number);
  const b = minimum.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return true;
}

describe('prepareOAuthNativeRequest — Claude Code identity', () => {
  it('advertises CC_VERSION in the user-agent header', () => {
    const { userAgent } = preparedIdentity();
    expect(userAgent).toBe(`claude-cli/${CC_VERSION} (external, cli)`);
  });

  it('advertises the same CC_VERSION in the billing header cc_version', () => {
    const { ccVersion } = preparedIdentity();
    // cc_version is "<version>.<3-hex build hash>"; the version prefix must
    // match the user-agent so Anthropic's gate sees one consistent identity.
    const escaped = CC_VERSION.replace(/\./g, '\\.');
    expect(ccVersion).toMatch(new RegExp(`^${escaped}\\.[0-9a-f]{3}$`));
  });

  it('is at least the version Anthropic requires for claude-fable-5-1', () => {
    // mcowger/plexus#842: "Claude Code 2.1.207 does not support this model;
    // version 2.1.251 or newer is required." Bump this floor if a future
    // model raises the gate.
    expect(isVersionAtLeast(CC_VERSION, '2.1.251')).toBe(true);
  });
});
