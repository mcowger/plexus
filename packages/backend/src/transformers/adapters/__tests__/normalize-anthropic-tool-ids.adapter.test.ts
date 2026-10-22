import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../../../utils/logger';
import {
  normalizeAnthropicToolIds,
  normalizeAnthropicToolIdsAdapter,
  sanitizeAnthropicToolId,
} from '../normalize-anthropic-tool-ids.adapter';

const VALID_ANTHROPIC_TOOL_ID = /^[a-zA-Z0-9_-]{1,64}$/;

function makePayload(messages: any[]): Record<string, any> {
  return { model: 'claude-sonnet-4', max_tokens: 1024, messages };
}

// ── sanitizeAnthropicToolId ────────────────────────────────────────────────

describe('sanitizeAnthropicToolId', () => {
  it('rewrites a Kimi/Moonshot id and is deterministic', () => {
    const sanitized = sanitizeAnthropicToolId('functions.WebSearch:3');

    expect(sanitized).toMatch(/^functions_WebSearch_3_[0-9a-f]{8}$/);
    expect(sanitizeAnthropicToolId('functions.WebSearch:3')).toBe(sanitized);
  });

  it('rewrites a pi-ai composite id', () => {
    expect(sanitizeAnthropicToolId('call_x|fc_y')).toMatch(/^call_x_fc_y_[0-9a-f]{8}$/);
  });

  it('rewrites a dotted MCP/Gemini tool name used as an id', () => {
    expect(sanitizeAnthropicToolId('mcp.search.web')).toMatch(/^mcp_search_web_[0-9a-f]{8}$/);
  });

  it('returns charset-valid ids untouched regardless of length', () => {
    expect(sanitizeAnthropicToolId('toolu_01AbC123')).toBe('toolu_01AbC123');
    expect(sanitizeAnthropicToolId('srvtoolu_XYZ')).toBe('srvtoolu_XYZ');

    const long = 'a'.repeat(200);
    expect(sanitizeAnthropicToolId(long)).toBe(long);
  });

  it('maps the empty string onto the sha256("") prefix', () => {
    expect(sanitizeAnthropicToolId('')).toBe('tool_e3b0c442');
  });

  it('maps non-string inputs onto a hashed tool_ id', () => {
    for (const input of [undefined, null, 42, {}]) {
      const sanitized = sanitizeAnthropicToolId(input);
      expect(sanitized).toMatch(/^tool_[0-9a-f]{8}$/);
      expect(sanitizeAnthropicToolId(input)).toBe(sanitized);
    }
  });

  // `String(value)` runs value-controlled coercion, and the value arrives from
  // a client JSON body: `{"id":{"toString":null}}` parses fine and then throws
  // a TypeError on coercion. A throw here would become an internal error
  // mid-dispatch instead of a sanitized id.
  it('never throws on a value whose coercion is hostile', () => {
    const hostile: unknown[] = [
      JSON.parse('{"toString": null}'),
      {
        toString() {
          throw new Error('boom');
        },
      },
      { valueOf: null, toString: null },
      Object.create(null),
      Symbol('nope'),
    ];

    for (const input of hostile) {
      const sanitized = sanitizeAnthropicToolId(input);
      expect(sanitized).toMatch(/^tool_[0-9a-f]{8}$/);
      // Deterministic despite the fallback marker.
      expect(sanitizeAnthropicToolId(input)).toBe(sanitized);
      expect(sanitizeAnthropicToolId(sanitized)).toBe(sanitized);
    }
  });

  // Arrays coerce fine — they must keep taking the normal `String()` path
  // rather than being swept into the uncoercible fallback.
  it('hashes a coercible non-string over its coerced text', () => {
    const fromArray = sanitizeAnthropicToolId([1, 2]);

    expect(fromArray).toMatch(/^tool_[0-9a-f]{8}$/);
    // Same hash material as the string "1,2" — proof of the `String()` path.
    expect(fromArray.slice('tool_'.length)).toBe(sanitizeAnthropicToolId('1,2').slice(-8));
    expect(fromArray).not.toBe(sanitizeAnthropicToolId(JSON.parse('{"toString": null}')));
  });

  // A JSON string may carry lone surrogates. UTF-8 encoding (what
  // `createHash().update(<string>)` does) maps every one of them onto U+FFFD,
  // which would collapse these three distinct inputs onto one id.
  it('keeps lone surrogates distinct from each other and from U+FFFD', () => {
    const highSurrogate = sanitizeAnthropicToolId('\ud800');
    const otherHighSurrogate = sanitizeAnthropicToolId('\ud801');
    const replacementChar = sanitizeAnthropicToolId('�');

    expect(new Set([highSurrogate, otherHighSurrogate, replacementChar]).size).toBe(3);

    for (const sanitized of [highSurrogate, otherHighSurrogate, replacementChar]) {
      expect(sanitized).toMatch(VALID_ANTHROPIC_TOOL_ID);
      expect(sanitizeAnthropicToolId(sanitized)).toBe(sanitized);
    }
  });

  it('truncates the prefix but never the hash suffix', () => {
    const monster = 'x.'.repeat(100);
    expect(monster.length).toBe(200);

    const sanitized = sanitizeAnthropicToolId(monster);

    expect(sanitized.length).toBe(64);
    expect(sanitized).toMatch(/_[0-9a-f]{8}$/);
    expect(sanitized.slice(0, 55)).toBe(monster.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 55));
  });

  it('is idempotent for every input shape', () => {
    const inputs: unknown[] = [
      'functions.WebSearch:3',
      'call_x|fc_y',
      'mcp.search.web',
      'toolu_01AbC123',
      'srvtoolu_XYZ',
      'a'.repeat(200),
      '',
      undefined,
      null,
      42,
      {},
      'x.'.repeat(100),
    ];

    for (const input of inputs) {
      const once = sanitizeAnthropicToolId(input);
      expect(sanitizeAnthropicToolId(once)).toBe(once);
    }
  });

  // The suffix hashes the ORIGINAL id, so ids that collapse to the same
  // replaced form stay distinguishable.
  it('keeps ids distinct when character replacement collapses them', () => {
    expect(sanitizeAnthropicToolId('a.b')).not.toBe(sanitizeAnthropicToolId('a:b'));
  });

  it('always emits a charset-valid id for invalid inputs', () => {
    const inputs: unknown[] = [
      'functions.WebSearch:3',
      'call_x|fc_y',
      'mcp.search.web',
      '',
      undefined,
      null,
      42,
      {},
      'x.'.repeat(100),
      '한글 도구 이름',
    ];

    for (const input of inputs) {
      expect(sanitizeAnthropicToolId(input)).toMatch(VALID_ANTHROPIC_TOOL_ID);
    }
  });
});

// ── preDispatch / walker ───────────────────────────────────────────────────

describe('normalizeAnthropicToolIdsAdapter.preDispatch', () => {
  beforeEach(() => {
    vi.mocked(logger.warn).mockClear();
  });

  it('rewrites a tool_use/tool_result pair to the same sanitized id and warns once', () => {
    const payload = makePayload([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'searching' },
          {
            type: 'tool_use',
            id: 'functions.WebSearch:3',
            name: 'WebSearch',
            input: {},
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'functions.WebSearch:3',
            content: 'results',
          },
        ],
      },
    ]);

    normalizeAnthropicToolIdsAdapter.preDispatch(payload);

    const toolUseId = payload.messages[0].content[1].id;
    expect(toolUseId).toMatch(/^functions_WebSearch_3_[0-9a-f]{8}$/);
    expect(payload.messages[1].content[0].tool_use_id).toBe(toolUseId);
    expect(payload.messages[0].content[0]).toEqual({
      type: 'text',
      text: 'searching',
    });

    expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('rewrote 2 tool id(s)')
    );
  });

  it('rewrites an orphan tool_result whose id has no matching tool_use', () => {
    const payload = makePayload([
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'functions.X:1', content: 'ok' }],
      },
    ]);

    normalizeAnthropicToolIdsAdapter.preDispatch(payload);

    expect(payload.messages[0].content[0].tool_use_id).toMatch(/^functions_X_1_[0-9a-f]{8}$/);
  });

  // End-to-end version of the hostile-coercion case: the object reaches the
  // walker exactly as it would off a client body, so a throw inside the
  // sanitizer would escape preDispatch and abort the dispatch.
  it('rewrites an id whose coercion throws instead of blowing up the walker', () => {
    const payload = JSON.parse(
      JSON.stringify({
        model: 'claude-sonnet-4',
        max_tokens: 1024,
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: { toString: null }, name: 'X', input: {} }],
          },
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'functions.X:1', content: 'ok' }],
          },
        ],
      })
    );

    expect(() => normalizeAnthropicToolIdsAdapter.preDispatch(payload)).not.toThrow();

    const rewrittenId = payload.messages[0].content[0].id;
    expect(rewrittenId).toMatch(/^tool_[0-9a-f]{8}$/);
    expect(rewrittenId).toMatch(VALID_ANTHROPIC_TOOL_ID);
    expect(payload.messages[1].content[0].tool_use_id).toMatch(/^functions_X_1_[0-9a-f]{8}$/);

    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('rewrote 2 tool id(s)')
    );
  });

  it('leaves system, tools, tool_choice, text blocks and valid ids untouched', () => {
    const payload = makePayload([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'calling has.dots' },
          {
            type: 'tool_use',
            id: 'toolu_01AbC123',
            name: 'has.dots',
            input: {},
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_01AbC123',
            content: 'done',
          },
        ],
      },
    ]);
    payload.system = 'You may call has.dots';
    payload.tools = [
      {
        name: 'has.dots',
        description: 'dotted name',
        input_schema: { type: 'object' },
      },
    ];
    payload.tool_choice = { type: 'tool', name: 'has.dots' };

    const before = structuredClone(payload);

    expect(normalizeAnthropicToolIds(payload)).toBe(0);
    expect(normalizeAnthropicToolIdsAdapter.preDispatch(payload)).toEqual(before);
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  // Chat-format tool ids live at message level and the OpenAI wire has no
  // charset rule, so the walker must not reach them.
  it('leaves a chat-shaped body completely untouched', () => {
    const payload = makePayload([
      { role: 'user', content: 'find something' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'functions.X:1',
            type: 'function',
            function: { name: 'X', arguments: '{}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'functions.X:1', content: 'result' },
    ]);

    const before = structuredClone(payload);

    expect(normalizeAnthropicToolIds(payload)).toBe(0);
    expect(payload).toEqual(before);
  });

  it('ignores bodies without a messages array', () => {
    const responsesBody: Record<string, any> = {
      model: 'gpt-5.5',
      input: [
        {
          type: 'function_call',
          call_id: 'call_x|fc_y',
          name: 'X',
          arguments: '{}',
        },
      ],
    };
    const noMessages: Record<string, any> = { model: 'claude-sonnet-4' };
    const badMessages: Record<string, any> = {
      model: 'claude-sonnet-4',
      messages: 'nope',
    };

    for (const body of [responsesBody, noMessages, badMessages]) {
      const before = structuredClone(body);
      expect(normalizeAnthropicToolIds(body)).toBe(0);
      expect(normalizeAnthropicToolIdsAdapter.preDispatch(body)).toEqual(before);
    }

    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  it('handles server/mcp block variants and malformed blocks', () => {
    const payload = makePayload([
      {
        role: 'assistant',
        content: [
          null,
          { type: 'thinking', thinking: 'hmm' },
          { type: 'tool_use', name: 'no-id-here', input: {} },
          { id: 'no.type.here' },
          {
            type: 'server_tool_use',
            id: 'server.search:1',
            name: 'web_search',
            input: {},
          },
          {
            type: 'mcp_tool_use',
            id: 'mcp.search.web',
            name: 'search',
            server_name: 'mcp',
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'mcp_tool_result',
            tool_use_id: 'mcp.search.web',
            content: [],
          },
          {
            type: 'web_search_tool_result',
            tool_use_id: 'srvtoolu_01Valid',
            content: [],
          },
        ],
      },
    ]);

    const count = normalizeAnthropicToolIds(payload);

    const blocks = payload.messages[0].content;
    expect(blocks[0]).toBeNull();
    expect(blocks[1]).toEqual({ type: 'thinking', thinking: 'hmm' });
    expect(blocks[2].id).toBeUndefined();
    expect(blocks[3].id).toBe('no.type.here');
    expect(blocks[4].id).toMatch(/^server_search_1_[0-9a-f]{8}$/);
    expect(blocks[5].id).toMatch(/^mcp_search_web_[0-9a-f]{8}$/);

    expect(payload.messages[1].content[0].tool_use_id).toBe(blocks[5].id);
    expect(payload.messages[1].content[1].tool_use_id).toBe('srvtoolu_01Valid');

    expect(count).toBe(3);
  });
});

// ── postDispatch ───────────────────────────────────────────────────────────

describe('normalizeAnthropicToolIdsAdapter.postDispatch', () => {
  it('returns the response unchanged', () => {
    const response = {
      id: 'msg_1',
      content: [{ type: 'tool_use', id: 'functions.X:1' }],
    };

    expect(normalizeAnthropicToolIdsAdapter.postDispatch(response)).toBe(response);
  });
});
