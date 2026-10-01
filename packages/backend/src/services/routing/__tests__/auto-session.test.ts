import { describe, expect, it } from 'vitest';
import type { UnifiedChatRequest } from '../../../types/unified';
import { deriveAutoSessionBranch } from '../auto-session';

function req(overrides: Partial<UnifiedChatRequest> = {}): UnifiedChatRequest {
  return {
    model: 'auto-alias',
    messages: [{ role: 'user', content: 'Implement the parser change' }],
    ...overrides,
  };
}

describe('deriveAutoSessionBranch', () => {
  it('prefers stable inbound session headers in precedence order', () => {
    const request = req({
      cacheRoutingHeaders: {
        session_id: 'session-id',
        'x-session-affinity': 'affinity',
        'x-client-request-id': 'request-id',
      },
    });
    expect(deriveAutoSessionBranch(request)).toBe('session-id');
  });

  it('falls through the stable headers and prompt cache key', () => {
    expect(
      deriveAutoSessionBranch(
        req({
          prompt_cache_key: 'body-key',
          cacheRoutingHeaders: { 'x-client-request-id': 'request-id' },
        })
      )
    ).toBe('body-key');
    expect(
      deriveAutoSessionBranch(
        req({ cacheRoutingHeaders: { 'x-multi-turn-session-id': 'multi-turn' } })
      )
    ).toBe('multi-turn');
    expect(
      deriveAutoSessionBranch(req({ cacheRoutingHeaders: { 'x-opencode-session': 'opencode' } }))
    ).toBe('opencode');
  });

  it('never keys off x-client-request-id', () => {
    const request = req({
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
      ],
      cacheRoutingHeaders: { 'x-client-request-id': 'per-request-id' },
    });
    const branch = deriveAutoSessionBranch(request);
    expect(branch).toBeDefined();
    expect(branch).not.toContain('per-request-id');
  });

  it('uses a stable first-two-message anchor for unrelated turns', () => {
    const first = req({
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
      ],
    });
    const later = req({
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'more' },
      ],
    });
    expect(deriveAutoSessionBranch(first)).toBe(deriveAutoSessionBranch(later));
    expect(deriveAutoSessionBranch(first)).toMatch(/^m:/);
  });

  it('returns undefined when there is no usable identity', () => {
    expect(deriveAutoSessionBranch(req({ messages: [] }))).toBeUndefined();
    expect(
      deriveAutoSessionBranch(req({ messages: [{ role: 'user', content: 'only' }] }))
    ).toBeUndefined();
  });

  it('combines a Claude Code session hint with the task anchor', () => {
    const first = req({ claudeCodeSessionId: 'cc-session' });
    const continuation = req({
      claudeCodeSessionId: 'cc-session',
      messages: [
        { role: 'user', content: 'Implement the parser change' },
        { role: 'assistant', content: 'Done.' },
        { role: 'user', content: 'thanks' },
      ],
    });
    const branch = deriveAutoSessionBranch(first)!;
    expect(branch).toMatch(/^cc:cc-session:/);
    expect(deriveAutoSessionBranch(continuation)).toBe(branch);
  });

  it('separates subagents that share one Claude Code session id', () => {
    const parent = req({
      claudeCodeSessionId: 'shared-session',
      messages: [{ role: 'user', content: 'Plan the refactor' }],
    });
    const subagent = req({
      claudeCodeSessionId: 'shared-session',
      messages: [{ role: 'user', content: 'Debug the failing test' }],
    });
    expect(deriveAutoSessionBranch(parent)).not.toBe(deriveAutoSessionBranch(subagent));
  });

  it('falls back to the raw Claude hint when no transcript anchor exists', () => {
    expect(deriveAutoSessionBranch(req({ claudeCodeSessionId: 'cc-session', messages: [] }))).toBe(
      'cc:cc-session'
    );
  });
});
