import { describe, expect, it } from 'vitest';
import {
  stripUnsupportedToolSearchAdapter,
  isToolSearchShorthand,
} from '../strip-unsupported-tool-search.adapter';

// ── isToolSearchShorthand ──────────────────────────────────────────────────

describe('isToolSearchShorthand', () => {
  it('recognises tool_search_tool_bm25_20251119', () => {
    expect(
      isToolSearchShorthand({
        type: 'tool_search_tool_bm25_20251119',
        name: 'tool_search_tool_bm25',
      })
    ).toBe(true);
  });

  it('recognises tool_search_tool_regex_20251119', () => {
    expect(
      isToolSearchShorthand({
        type: 'tool_search_tool_regex_20251119',
        name: 'tool_search_tool_regex',
      })
    ).toBe(true);
  });

  it('is case-insensitive on the type prefix', () => {
    expect(
      isToolSearchShorthand({
        type: 'Tool_Search_Tool_BM25_20251119',
        name: 'tool_search_tool_bm25',
      })
    ).toBe(true);
  });

  it('returns false for the Anthropic web_search shorthand', () => {
    expect(isToolSearchShorthand({ type: 'web_search_20250305' })).toBe(false);
  });

  it('returns false for ordinary function tools', () => {
    expect(
      isToolSearchShorthand({
        type: 'function',
        function: { name: 'get_weather' },
      })
    ).toBe(false);
  });

  it('returns false for null', () => {
    expect(isToolSearchShorthand(null)).toBe(false);
  });

  it('returns false for non-object values', () => {
    expect(isToolSearchShorthand('tool_search_tool_bm25_20251119')).toBe(false);
    expect(isToolSearchShorthand(42)).toBe(false);
  });

  it('returns false when type is missing', () => {
    expect(isToolSearchShorthand({ name: 'tool_search_tool_bm25' })).toBe(false);
  });

  it('returns false when type is not a string', () => {
    expect(isToolSearchShorthand({ type: 123 })).toBe(false);
  });

  it('does not match substrings inside other tool types', () => {
    expect(isToolSearchShorthand({ type: 'tool_search' })).toBe(false);
    expect(isToolSearchShorthand({ type: 'something_tool_search_tool_' })).toBe(false);
  });
});

// ── stripUnsupportedToolSearchAdapter.preDispatch ──────────────────────────

describe('stripUnsupportedToolSearchAdapter.preDispatch', () => {
  it('returns payload unchanged when tools is missing', () => {
    const payload = { model: 'anthropic/claude-sonnet-5' };
    expect(stripUnsupportedToolSearchAdapter.preDispatch(payload)).toBe(payload);
  });

  it('returns payload unchanged when tools is empty', () => {
    const payload = { model: 'anthropic/claude-sonnet-5', tools: [] };
    expect(stripUnsupportedToolSearchAdapter.preDispatch(payload)).toBe(payload);
  });

  it('returns payload unchanged when no tool_search_tool_* entries are present', () => {
    const calculator = {
      type: 'function',
      function: { name: 'calculator', parameters: {} },
    };
    const payload = {
      model: 'anthropic/claude-sonnet-5',
      tools: [calculator, { type: 'web_search_20250305', name: 'web_search' }],
    };
    expect(stripUnsupportedToolSearchAdapter.preDispatch(payload)).toBe(payload);
  });

  it('strips a single tool_search_tool_bm25_20251119 entry', () => {
    const searchTool = {
      type: 'tool_search_tool_bm25_20251119',
      name: 'tool_search_tool_bm25',
    };
    const listFiles = {
      name: 'list_files',
      description: 'list files',
      input_schema: { type: 'object', properties: {} },
    };
    const payload = {
      model: 'anthropic/claude-sonnet-5',
      tools: [searchTool, listFiles],
    };
    const result = stripUnsupportedToolSearchAdapter.preDispatch(payload);
    expect(result.tools).toEqual([listFiles]);
    expect(result.model).toBe(payload.model);
  });

  it('strips a single tool_search_tool_regex_20251119 entry', () => {
    const searchTool = {
      type: 'tool_search_tool_regex_20251119',
      name: 'tool_search_tool_regex',
    };
    const payload = {
      model: 'anthropic/claude-sonnet-5',
      tools: [searchTool, { name: 'read_file' }],
    };
    const result = stripUnsupportedToolSearchAdapter.preDispatch(payload);
    expect(result.tools).toEqual([{ name: 'read_file' }]);
  });

  it('strips both bm25 and regex variants in one pass', () => {
    const payload = {
      model: 'anthropic/claude-sonnet-5',
      tools: [
        { type: 'tool_search_tool_bm25_20251119', name: 'tool_search_tool_bm25' },
        { name: 'list_files' },
        { type: 'tool_search_tool_regex_20251119', name: 'tool_search_tool_regex' },
      ],
    };
    const result = stripUnsupportedToolSearchAdapter.preDispatch(payload);
    expect(result.tools).toEqual([{ name: 'list_files' }]);
  });

  it('returns an empty tools array when every entry is a tool_search_tool_*', () => {
    const payload = {
      model: 'anthropic/claude-sonnet-5',
      tools: [
        { type: 'tool_search_tool_bm25_20251119', name: 'tool_search_tool_bm25' },
        { type: 'tool_search_tool_regex_20251119', name: 'tool_search_tool_regex' },
      ],
    };
    const result = stripUnsupportedToolSearchAdapter.preDispatch(payload);
    expect(result.tools).toEqual([]);
  });

  it('preserves web_search_20250305 and other server-tool shorthands', () => {
    const payload = {
      model: 'anthropic/claude-sonnet-5',
      tools: [
        { type: 'web_search_20250305', name: 'web_search' },
        { type: 'tool_search_tool_bm25_20251119', name: 'tool_search_tool_bm25' },
      ],
    };
    const result = stripUnsupportedToolSearchAdapter.preDispatch(payload);
    expect(result.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search' }]);
  });

  it('does not mutate the original payload', () => {
    const searchTool = {
      type: 'tool_search_tool_bm25_20251119',
      name: 'tool_search_tool_bm25',
    };
    const original = {
      model: 'anthropic/claude-sonnet-5',
      tools: [searchTool, { name: 'list_files' }],
    };
    const copy = JSON.parse(JSON.stringify(original));
    stripUnsupportedToolSearchAdapter.preDispatch(original);
    expect(original).toEqual(copy);
  });
});

// ── postDispatch ───────────────────────────────────────────────────────────

describe('stripUnsupportedToolSearchAdapter.postDispatch', () => {
  it('returns the response unchanged', () => {
    const response = { id: 'msg_1', content: [] };
    expect(stripUnsupportedToolSearchAdapter.postDispatch(response)).toBe(response);
  });
});
