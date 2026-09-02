/**
 * Regression test: the caller's `anthropic-beta` header must survive the native
 * OAuth path.
 *
 * `prepareAnthropicOAuthRequest` used to build the outbound header as
 * `REQUIRED_BETAS.join(',')`, which OVERWRITES whatever the client sent.
 * `REQUIRED_BETAS` is a hand-maintained snapshot of a genuine Claude Code
 * request (see its "TO UPDATE: inspect a genuine Claude Code CLI request"
 * comment), so it goes stale whenever the client ships a new beta-gated
 * feature — and every flag the client added beyond the snapshot was silently
 * dropped. Anthropic then rejected the tool that flag gates, e.g.
 *
 *   400 tools.N: Input tag 'advisor_20260301' found using 'type' does not
 *       match any of the expected tags: ...
 *
 * The union must keep REQUIRED_BETAS too: masking-critical flags such as
 * `oauth-2025-04-20` are never sent by the caller.
 */

import { describe, expect, it } from 'vitest';
import { CC_VERSION, REQUIRED_BETAS } from '../../../transformers/oauth/masking';
import { prepareOAuthNativeRequest } from '../oauth-native-request';

const AUTH = { mode: 'oauth', token: 'oauth-token-for-test' } as const;

const nativeBody = () => ({
  model: 'claude-sonnet-4-5',
  max_tokens: 64,
  messages: [{ role: 'user', content: 'hello' }],
});

function betasFor(callerBetas?: string): string[] {
  const prepared = prepareOAuthNativeRequest(
    'anthropic',
    'claude-sonnet-4-5',
    AUTH,
    nativeBody(),
    false,
    callerBetas === undefined ? undefined : { callerBetas }
  );
  const header = prepared.headers['anthropic-beta'];
  expect(header).toBeDefined();
  return (header ?? '').split(',');
}

describe('prepareOAuthNativeRequest — anthropic-beta merging', () => {
  it("forwards the caller's beta flags alongside REQUIRED_BETAS", () => {
    const betas = betasFor(
      'claude-code-20250219,advisor-tool-2026-03-01,some-future-beta-2026-09-09'
    );

    // Caller-only flags survive instead of being discarded.
    expect(betas).toContain('advisor-tool-2026-03-01');
    expect(betas).toContain('some-future-beta-2026-09-09');

    // ...and the masking-critical flags the caller never sends are still there.
    for (const required of REQUIRED_BETAS) {
      expect(betas).toContain(required);
    }
  });

  it('does not duplicate flags the caller and REQUIRED_BETAS share', () => {
    const betas = betasFor(
      'advisor-tool-2026-03-01, claude-code-20250219 ,advisor-tool-2026-03-01'
    );

    expect(betas).toEqual([...new Set(betas)]);
    expect(betas.filter((b) => b === 'claude-code-20250219')).toHaveLength(1);
    expect(betas.filter((b) => b === 'advisor-tool-2026-03-01')).toHaveLength(1);
    // Whitespace around a caller flag must not leak into the wire value.
    expect(betas).not.toContain(' claude-code-20250219 ');
  });

  it('emits exactly REQUIRED_BETAS when the caller sent no header', () => {
    expect(betasFor(undefined)).toEqual([...REQUIRED_BETAS]);
    expect(betasFor('')).toEqual([...REQUIRED_BETAS]);
  });
});

describe('prepareOAuthNativeRequest — Claude Code identity', () => {
  // The version gate applies to both the HTTP identity and billing identity.
  it('uses the current shared version in the user agent and billing header', () => {
    const prepared = prepareOAuthNativeRequest(
      'anthropic',
      'claude-sonnet-4-5',
      AUTH,
      nativeBody(),
      false
    );
    const sentBody = prepared.body;
    const billingHeader = sentBody.system[0].text as string;

    expect(prepared.headers['user-agent']).toBe(`claude-cli/${CC_VERSION} (external, cli)`);
    expect(billingHeader).toContain(`cc_version=${CC_VERSION}.`);
  });
});
