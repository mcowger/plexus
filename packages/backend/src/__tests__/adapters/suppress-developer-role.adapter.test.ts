import { describe, expect, it } from 'vitest';
import { suppressDeveloperRoleAdapter } from '../../transformers/adapters/suppress-developer-role.adapter';

describe('suppressDeveloperRoleAdapter', () => {
  it('has the correct name', () => {
    expect(suppressDeveloperRoleAdapter.name).toBe('suppress_developer_role');
  });

  // ── preDispatch ──────────────────────────────────────────────────────────

  describe('preDispatch', () => {
    it('rewrites developer role to system', () => {
      const payload = {
        messages: [
          { role: 'developer', content: 'You are helpful.' },
          { role: 'user', content: 'hi' },
        ],
      };
      const result = suppressDeveloperRoleAdapter.preDispatch(payload);
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[1].role).toBe('user');
    });

    it('rewrites multiple developer messages', () => {
      const payload = {
        messages: [
          { role: 'developer', content: 'First.' },
          { role: 'developer', content: 'Second.' },
        ],
      };
      const result = suppressDeveloperRoleAdapter.preDispatch(payload);
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[1].role).toBe('system');
    });

    it('preserves other message fields when rewriting role', () => {
      const payload = {
        messages: [{ role: 'developer', content: 'text', extra: 'value' }],
      };
      const result = suppressDeveloperRoleAdapter.preDispatch(payload);
      expect(result.messages[0]).toEqual({ role: 'system', content: 'text', extra: 'value' });
    });

    it('does not modify non-developer roles', () => {
      const payload = {
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'user' },
          { role: 'assistant', content: 'asst' },
        ],
      };
      const result = suppressDeveloperRoleAdapter.preDispatch(payload);
      expect(result.messages.map((m: any) => m.role)).toEqual(['system', 'user', 'assistant']);
    });

    it('returns payload unchanged when messages is missing', () => {
      const payload = { model: 'foo' };
      expect(suppressDeveloperRoleAdapter.preDispatch(payload)).toEqual({ model: 'foo' });
    });
  });

  // ── postDispatch ─────────────────────────────────────────────────────────

  describe('postDispatch', () => {
    it('is a no-op and returns the response unchanged', () => {
      const response = { choices: [{ message: { role: 'developer', content: 'hi' } }] };
      expect(suppressDeveloperRoleAdapter.postDispatch(response)).toEqual(response);
    });
  });

  // ── preDispatchStreamChunk ───────────────────────────────────────────────

  describe('preDispatchStreamChunk', () => {
    it('rewrites "role":"developer" to "role":"system" in data lines', () => {
      const line = 'data: {"delta":{"role":"developer","content":""}}';
      const result = suppressDeveloperRoleAdapter.preDispatchStreamChunk!(line);
      expect(result).toBe('data: {"delta":{"role":"system","content":""}}');
    });

    it('does not modify non-data lines', () => {
      const line = 'event: message_start';
      expect(suppressDeveloperRoleAdapter.preDispatchStreamChunk!(line)).toBe(line);
    });

    it('does not modify other role values', () => {
      const line = 'data: {"delta":{"role":"assistant"}}';
      expect(suppressDeveloperRoleAdapter.preDispatchStreamChunk!(line)).toBe(line);
    });
  });
});
