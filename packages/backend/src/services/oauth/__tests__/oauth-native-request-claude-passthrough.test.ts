/**
 * Genuine Claude Code client detection + verbatim passthrough.
 *
 * A real Claude Code client talking to the real Anthropic endpoint needs no
 * masking (verified against staging traces — see isGenuineClaudeCodeRequest).
 * These tests cover the detector's fail-closed gates and the
 * `prepareOAuthNativeRequest` passthrough branch (body identity, caller
 * identity headers preserved, masking skipped).
 */

import { beforeEach, describe, expect, test } from 'vitest';

import type { UnifiedChatRequest } from '../../../types/unified';
import { ClaudeCodeVersionService } from '../claude-code-version-service';
import { isGenuineClaudeCodeRequest, prepareOAuthNativeRequest } from '../oauth-native-request';

const CLIENT_UA = 'claude-cli/2.1.278 (external, cli)';
const SESSION_ID = 'f30933dc-c43f-4e8f-82d2-8d87c3ef60e6';
const DEVICE_ID = '1563fdc89059aefd3317a1abf5adc964b98062c904c8f71ba5daacecc4a2cb0d';

function genuineBody() {
  return {
    model: 'claude-sonnet-5',
    max_tokens: 64,
    system: [
      {
        type: 'text',
        text: 'x-anthropic-billing-header: cc_version=2.1.278.452; cc_entrypoint=cli;',
      },
      { type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." },
      { type: 'text', text: 'My custom output style instructions.' },
    ],
    metadata: {
      user_id: JSON.stringify({ device_id: DEVICE_ID, account_uuid: '', session_id: SESSION_ID }),
    },
    messages: [{ role: 'user', content: 'hello' }],
  };
}

function genuineRequest(): UnifiedChatRequest {
  return {
    model: 'test-model',
    messages: [{ role: 'user', content: 'hello' }],
    incomingApiType: 'messages',
    originalBody: genuineBody(),
    anthropicBeta: 'claude-code-20250219,interleaved-thinking-2025-05-14',
    userAgent: CLIENT_UA,
    claudeCodeSessionId: SESSION_ID,
    metadata: { plexus_metadata: { clientHeaders: { 'x-app': 'cli' } } },
  } as any;
}

describe('isGenuineClaudeCodeRequest', () => {
  test('accepts a genuine Claude Code request', () => {
    expect(isGenuineClaudeCodeRequest(genuineRequest())).toBe(true);
  });

  test('accepts when the session-id header was stripped (body IDs still valid)', () => {
    const request = genuineRequest();
    delete (request as any).claudeCodeSessionId;
    expect(isGenuineClaudeCodeRequest(request)).toBe(true);
  });

  test('rejects a missing user-agent', () => {
    const request = genuineRequest();
    delete (request as any).userAgent;
    expect(isGenuineClaudeCodeRequest(request)).toBe(false);
  });

  test('rejects a non-Claude user-agent', () => {
    const request = genuineRequest();
    request.userAgent = 'Mozilla/5.0';
    expect(isGenuineClaudeCodeRequest(request)).toBe(false);
  });

  test('rejects a missing x-app header', () => {
    const request = genuineRequest();
    request.metadata = { plexus_metadata: { clientHeaders: {} } };
    expect(isGenuineClaudeCodeRequest(request)).toBe(false);
  });

  test('rejects betas without the Claude Code flag', () => {
    const request = genuineRequest();
    request.anthropicBeta = 'interleaved-thinking-2025-05-14';
    expect(isGenuineClaudeCodeRequest(request)).toBe(false);
  });

  test('rejects spoofed headers on a non-Claude body', () => {
    const request = genuineRequest();
    request.originalBody = {
      model: 'x',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'hi' }],
    };
    expect(isGenuineClaudeCodeRequest(request)).toBe(false);
  });

  test('rejects an already-masked body (cch= present)', () => {
    const request = genuineRequest();
    (request.originalBody as any).system[0].text =
      'x-anthropic-billing-header: cc_version=2.1.258.b3d; cc_entrypoint=cli; cch=24bb3;';
    expect(isGenuineClaudeCodeRequest(request)).toBe(false);
  });

  test('rejects a wrong identity line', () => {
    const request = genuineRequest();
    (request.originalBody as any).system[1].text = 'You are a helpful assistant.';
    expect(isGenuineClaudeCodeRequest(request)).toBe(false);
  });

  test('rejects unparseable metadata.user_id', () => {
    const request = genuineRequest();
    (request.originalBody as any).metadata.user_id = 'not-json';
    expect(isGenuineClaudeCodeRequest(request)).toBe(false);
  });

  test('rejects a session-id mismatch between header and body', () => {
    const request = genuineRequest();
    request.claudeCodeSessionId = 'some-other-session';
    expect(isGenuineClaudeCodeRequest(request)).toBe(false);
  });
});

describe('prepareOAuthNativeRequest — claude passthrough', () => {
  const AUTH = { mode: 'apiKey', apiKey: 'sk-ant-test-key' } as const;

  beforeEach(() => {
    ClaudeCodeVersionService.resetForTesting();
  });

  test('forwards the body verbatim and preserves caller identity headers', () => {
    const body = genuineBody();
    const prepared = prepareOAuthNativeRequest('anthropic', 'claude-sonnet-5', AUTH, body, false, {
      callerBetas: 'claude-code-20250219,advisor-tool-2026-03-01',
      claudePassthrough: true,
      callerUserAgent: CLIENT_UA,
      callerSessionId: SESSION_ID,
    });

    expect(prepared.url).toBe('https://api.anthropic.com/v1/messages');
    // Verbatim: same reference, client version intact, no CCH hash injected.
    expect(prepared.body).toBe(body);
    expect(prepared.body.system[0].text).toContain('cc_version=2.1.278.452');
    expect(prepared.body.system[0].text).not.toContain('cch=');
    expect(prepared.body.system[2].text).toBe('My custom output style instructions.');
    // Caller identity preserved, not the gateway's generated one.
    expect(prepared.headers['user-agent']).toBe(CLIENT_UA);
    expect(prepared.headers['x-claude-code-session-id']).toBe(SESSION_ID);
    // Caller betas survive the merge.
    expect(prepared.headers['anthropic-beta']).toContain('advisor-tool-2026-03-01');
    // Auth is still the key swap.
    expect(prepared.headers['x-api-key']).toBe('sk-ant-test-key');
    // Response reverser is identity — nothing was renamed.
    expect(prepared.reverseResponseFrame('{"name":"Bash"}')).toBe('{"name":"Bash"}');
  });

  test('falls back to the body session id when the header was stripped', () => {
    const prepared = prepareOAuthNativeRequest(
      'anthropic',
      'claude-sonnet-5',
      AUTH,
      genuineBody(),
      false,
      {
        callerBetas: 'claude-code-20250219',
        claudePassthrough: true,
        callerUserAgent: CLIENT_UA,
      }
    );

    expect(prepared.headers['x-claude-code-session-id']).toBe(SESSION_ID);
  });

  test('drops the session header when no client session exists anywhere', () => {
    const body = genuineBody();
    delete (body as any).metadata;
    const prepared = prepareOAuthNativeRequest('anthropic', 'claude-sonnet-5', AUTH, body, false, {
      claudePassthrough: true,
      callerUserAgent: CLIENT_UA,
    });

    // Never send the gateway's shared per-process session for a client body.
    expect(prepared.headers).not.toHaveProperty('x-claude-code-session-id');
    expect(prepared.body).toBe(body);
  });

  test('masks when the passthrough flag is absent', () => {
    const prepared = prepareOAuthNativeRequest(
      'anthropic',
      'claude-sonnet-5',
      AUTH,
      genuineBody(),
      false,
      { callerBetas: 'claude-code-20250219' }
    );

    // Masking ran: stale gateway version + CCH hash, client system prompt gone.
    expect(prepared.body.system[0].text).toContain('cch=');
    expect(prepared.body.system[0].text).not.toContain('cc_version=2.1.278.452');
    expect(prepared.body).not.toBe(genuineBody());
  });
});
