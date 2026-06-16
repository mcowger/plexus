import { describe, expect, it } from 'vitest';
import {
  webSearchCoercionAdapter,
  isWebSearchTool,
  buildTargetTool,
} from '../web-search-coercion.adapter';

// ── isWebSearchTool ────────────────────────────────────────────────────────

describe('isWebSearchTool', () => {
  it('recognises the Anthropic web search type', () => {
    expect(isWebSearchTool({ type: 'web_search_20250305', name: 'web_search' })).toBe(true);
  });

  it('recognises the OpenAI web search type', () => {
    expect(isWebSearchTool({ type: 'web_search' })).toBe(true);
  });

  it('recognises the OpenRouter web search type', () => {
    expect(isWebSearchTool({ type: 'openrouter:web_search' })).toBe(true);
  });

  it('returns false for regular function tools', () => {
    expect(
      isWebSearchTool({ type: 'function', function: { name: 'get_weather', parameters: {} } })
    ).toBe(false);
  });

  it('returns false for null', () => {
    expect(isWebSearchTool(null)).toBe(false);
  });

  it('returns false for non-object values', () => {
    expect(isWebSearchTool('web_search')).toBe(false);
    expect(isWebSearchTool(42)).toBe(false);
  });

  it('returns false when type is missing', () => {
    expect(isWebSearchTool({ name: 'web_search' })).toBe(false);
  });
});

// ── buildTargetTool ────────────────────────────────────────────────────────

describe('buildTargetTool', () => {
  it('builds the Anthropic tool without max_uses', () => {
    expect(buildTargetTool('anthropic')).toEqual({
      type: 'web_search_20250305',
      name: 'web_search',
    });
  });

  it('builds the Anthropic tool with max_uses', () => {
    expect(buildTargetTool('anthropic', 5)).toEqual({
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: 5,
    });
  });

  it('builds the OpenAI tool', () => {
    expect(buildTargetTool('openai')).toEqual({ type: 'web_search' });
  });

  it('builds the OpenRouter tool', () => {
    expect(buildTargetTool('openrouter')).toEqual({ type: 'openrouter:web_search' });
  });
});

// ── webSearchCoercionAdapter.preDispatch ──────────────────────────────────

describe('webSearchCoercionAdapter.preDispatch', () => {
  // ── no-op cases ──────────────────────────────────────────────────────────

  it('returns payload unchanged when options are missing', () => {
    const payload = { model: 'gpt-4', tools: [{ type: 'web_search' }] };
    expect(webSearchCoercionAdapter.preDispatch(payload)).toBe(payload);
  });

  it('returns payload unchanged when target is missing from options', () => {
    const payload = { model: 'gpt-4', tools: [{ type: 'web_search' }] };
    expect(webSearchCoercionAdapter.preDispatch(payload, { max_uses: 5 })).toBe(payload);
  });

  it('returns payload unchanged when tools array is empty', () => {
    const payload = { model: 'gpt-4', tools: [] };
    const result = webSearchCoercionAdapter.preDispatch(payload, { target: 'anthropic' });
    expect(result).toBe(payload);
  });

  it('returns payload unchanged when tools is not an array', () => {
    const payload = { model: 'gpt-4' };
    const result = webSearchCoercionAdapter.preDispatch(payload, { target: 'anthropic' });
    expect(result).toBe(payload);
  });

  it('returns payload unchanged when no web search tools are present', () => {
    const payload = {
      model: 'gpt-4',
      tools: [{ type: 'function', function: { name: 'calculator', parameters: {} } }],
    };
    const result = webSearchCoercionAdapter.preDispatch(payload, { target: 'anthropic' });
    expect(result).toBe(payload);
  });

  // ── coercion to anthropic ─────────────────────────────────────────────────

  it('coerces OpenAI web_search → Anthropic format', () => {
    const payload = {
      model: 'claude-3-5-sonnet',
      tools: [{ type: 'web_search' }],
    };
    const result = webSearchCoercionAdapter.preDispatch(payload, { target: 'anthropic' });
    expect(result.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search' }]);
  });

  it('coerces OpenRouter web_search → Anthropic format with max_uses', () => {
    const payload = {
      model: 'claude-3-5-sonnet',
      tools: [{ type: 'openrouter:web_search' }],
    };
    const result = webSearchCoercionAdapter.preDispatch(payload, {
      target: 'anthropic',
      max_uses: 3,
    });
    expect(result.tools).toEqual([
      { type: 'web_search_20250305', name: 'web_search', max_uses: 3 },
    ]);
  });

  it('keeps Anthropic format as-is when target is anthropic', () => {
    const payload = {
      model: 'claude-3-5-sonnet',
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    };
    const result = webSearchCoercionAdapter.preDispatch(payload, { target: 'anthropic' });
    // It rewrites (since it matched), but output should be canonical Anthropic form
    expect(result.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search' }]);
  });

  // ── coercion to openai ────────────────────────────────────────────────────

  it('coerces Anthropic web_search → OpenAI format', () => {
    const payload = {
      model: 'gpt-4o',
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    };
    const result = webSearchCoercionAdapter.preDispatch(payload, { target: 'openai' });
    expect(result.tools).toEqual([{ type: 'web_search' }]);
  });

  it('coerces OpenRouter web_search → OpenAI format', () => {
    const payload = {
      model: 'gpt-4o',
      tools: [{ type: 'openrouter:web_search' }],
    };
    const result = webSearchCoercionAdapter.preDispatch(payload, { target: 'openai' });
    expect(result.tools).toEqual([{ type: 'web_search' }]);
  });

  // ── coercion to openrouter ────────────────────────────────────────────────

  it('coerces Anthropic web_search → OpenRouter format', () => {
    const payload = {
      model: 'gpt-4o',
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    };
    const result = webSearchCoercionAdapter.preDispatch(payload, { target: 'openrouter' });
    expect(result.tools).toEqual([{ type: 'openrouter:web_search' }]);
  });

  it('coerces OpenAI web_search → OpenRouter format', () => {
    const payload = {
      model: 'gpt-4o',
      tools: [{ type: 'web_search' }],
    };
    const result = webSearchCoercionAdapter.preDispatch(payload, { target: 'openrouter' });
    expect(result.tools).toEqual([{ type: 'openrouter:web_search' }]);
  });

  // ── mixed tools ───────────────────────────────────────────────────────────

  it('only rewrites web-search tools, leaving other tools intact', () => {
    const calculator = {
      type: 'function',
      function: { name: 'calculator', parameters: {} },
    };
    const payload = {
      model: 'gpt-4o',
      tools: [{ type: 'web_search' }, calculator],
    };
    const result = webSearchCoercionAdapter.preDispatch(payload, { target: 'openrouter' });
    expect(result.tools).toEqual([{ type: 'openrouter:web_search' }, calculator]);
  });

  it('rewrites multiple web search tools in one pass', () => {
    const payload = {
      model: 'gpt-4o',
      // Unlikely in practice but the adapter should handle it
      tools: [{ type: 'web_search' }, { type: 'openrouter:web_search' }],
    };
    const result = webSearchCoercionAdapter.preDispatch(payload, { target: 'anthropic' });
    expect(result.tools).toHaveLength(2);
    result.tools.forEach((t: any) => {
      expect(t.type).toBe('web_search_20250305');
    });
  });

  // ── payload immutability ──────────────────────────────────────────────────

  it('does not mutate the original payload', () => {
    const original = { model: 'gpt-4o', tools: [{ type: 'web_search' }] };
    const copy = JSON.parse(JSON.stringify(original));
    webSearchCoercionAdapter.preDispatch(original, { target: 'anthropic' });
    expect(original).toEqual(copy);
  });
});

// ── postDispatch / stream hooks ───────────────────────────────────────────

describe('webSearchCoercionAdapter.postDispatch', () => {
  it('returns the response unchanged', () => {
    const response = { id: 'resp_123', choices: [] };
    expect(webSearchCoercionAdapter.postDispatch(response)).toBe(response);
  });
});
