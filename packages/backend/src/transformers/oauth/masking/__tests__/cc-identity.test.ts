/**
 * Regression tests for `injectClaudeCodeIdentity` — flagged by automated PR
 * review on #650 (importance 7): the internal `prependToFirstUserMessage`
 * helper mutated the original message object in place (`msg.content = ...`)
 * despite the module's docstring claiming the function does not mutate its
 * input. Verified this never caused a live production bug (pi-ai-executor.ts
 * always calls this pipeline against a freshly `JSON.parse`d body, never a
 * shared object reference), but it was fragile/misleading for any other
 * caller — including these tests, and any future refactor — that might hold
 * a reference to the pre-call body and expect it untouched.
 */

import { describe, expect, it } from 'vitest';
import { injectClaudeCodeIdentity } from '../cc-identity';

describe('injectClaudeCodeIdentity — non-mutation', () => {
  it('does not mutate the original message object when content is an array', () => {
    const originalMessage = { role: 'user', content: [{ type: 'text', text: 'hello' }] };
    const body = {
      system: [{ type: 'text', text: 'some caller system prompt' }],
      messages: [originalMessage],
    };
    const originalContentRef = originalMessage.content;

    injectClaudeCodeIdentity(body);

    expect(originalMessage.content).toBe(originalContentRef);
    expect(originalMessage.content).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('does not mutate the original message object when content is a string', () => {
    const originalMessage = { role: 'user', content: 'hello' };
    const body = {
      system: [{ type: 'text', text: 'some caller system prompt' }],
      messages: [originalMessage],
    };

    injectClaudeCodeIdentity(body);

    expect(originalMessage.content).toBe('hello');
  });

  it('does not mutate the original messages array', () => {
    const originalMessage = { role: 'user', content: 'hello' };
    const originalMessages = [originalMessage];
    const body = {
      system: [{ type: 'text', text: 'some caller system prompt' }],
      messages: originalMessages,
    };

    const result = injectClaudeCodeIdentity(body);

    expect(originalMessages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(result.messages).not.toBe(originalMessages);
  });

  it('still correctly relocates the caller system prompt into a new first user message', () => {
    const body = {
      system: [{ type: 'text', text: 'caller system prompt' }],
      messages: [{ role: 'user', content: 'hello' }],
    };

    const result = injectClaudeCodeIdentity(body);
    const firstUser = result.messages.find((m: any) => m.role === 'user');
    const content = Array.isArray(firstUser.content)
      ? firstUser.content[0].text
      : firstUser.content;

    expect(content).toContain('<system-reminder>');
    expect(content).toContain('hello');
  });
});
