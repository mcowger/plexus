import { describe, expect, it } from 'vitest';
import { modelOverrideAdapter, resolveDottedPath } from '../model-override.adapter';

// ── resolveDottedPath ────────────────────────────────────────────────────

describe('resolveDottedPath', () => {
  it('resolves a top-level field', () => {
    expect(resolveDottedPath({ model: 'x' }, 'model')).toBe('x');
  });

  it('resolves a nested field', () => {
    expect(resolveDottedPath({ reasoning: { enabled: false } }, 'reasoning.enabled')).toBe(false);
  });

  it('resolves deeply nested field', () => {
    expect(resolveDottedPath({ a: { b: { c: 42 } } }, 'a.b.c')).toBe(42);
  });

  it('returns undefined for missing path', () => {
    expect(resolveDottedPath({ foo: 1 }, 'bar')).toBeUndefined();
  });

  it('returns undefined for partially missing path', () => {
    expect(resolveDottedPath({ a: {} }, 'a.b.c')).toBeUndefined();
  });

  it('returns undefined when traversing through null', () => {
    expect(resolveDottedPath({ a: null }, 'a.b')).toBeUndefined();
  });

  it('returns undefined when traversing through primitive', () => {
    expect(resolveDottedPath({ a: 5 }, 'a.b')).toBeUndefined();
  });
});

// ── preDispatch ──────────────────────────────────────────────────────────

describe('model_override adapter', () => {
  describe('preDispatch', () => {
    it('returns payload unchanged when no options provided', () => {
      const payload = { model: 'deepseek-r1', messages: [] };
      expect(modelOverrideAdapter.preDispatch(payload)).toBe(payload);
    });

    it('returns payload unchanged when options has no rules', () => {
      const payload = { model: 'deepseek-r1', messages: [] };
      expect(modelOverrideAdapter.preDispatch(payload, {})).toBe(payload);
    });

    it('returns payload unchanged when rules is empty array', () => {
      const payload = { model: 'deepseek-r1', messages: [] };
      expect(modelOverrideAdapter.preDispatch(payload, { rules: [] })).toBe(payload);
    });

    it('returns payload unchanged when no rule matches the model', () => {
      const payload = { model: 'other-model', messages: [] };
      const options = {
        rules: [
          {
            model: 'deepseek-r1',
            rewriteTo: 'deepseek-r1-fast',
            conditions: [{ field: 'reasoning.enabled', value: false }],
          },
        ],
      };
      const result = modelOverrideAdapter.preDispatch(payload, options);
      expect(result.model).toBe('other-model');
    });

    it('rewrites model when condition with value matches', () => {
      const payload = { model: 'deepseek-r1', reasoning: { enabled: false }, messages: [] };
      const options = {
        rules: [
          {
            model: 'deepseek-r1',
            rewriteTo: 'deepseek-r1-fast',
            conditions: [{ field: 'reasoning.enabled', value: false }],
          },
        ],
      };
      const result = modelOverrideAdapter.preDispatch(payload, options);
      expect(result.model).toBe('deepseek-r1-fast');
    });

    it('rewrites model when condition with presence check matches (field exists)', () => {
      const payload = { model: 'deepseek-r1', reasoning: {}, messages: [] };
      const options = {
        rules: [
          {
            model: 'deepseek-r1',
            rewriteTo: 'deepseek-r1-fast',
            conditions: [{ field: 'reasoning' }], // no value = presence check
          },
        ],
      };
      const result = modelOverrideAdapter.preDispatch(payload, options);
      expect(result.model).toBe('deepseek-r1-fast');
    });

    it('does not rewrite when presence check fails (field absent)', () => {
      const payload = { model: 'deepseek-r1', messages: [] };
      const options = {
        rules: [
          {
            model: 'deepseek-r1',
            rewriteTo: 'deepseek-r1-fast',
            conditions: [{ field: 'reasoning' }], // no value = presence check
          },
        ],
      };
      const result = modelOverrideAdapter.preDispatch(payload, options);
      expect(result.model).toBe('deepseek-r1');
    });

    it('does not rewrite when value check fails', () => {
      const payload = { model: 'deepseek-r1', reasoning: { enabled: true }, messages: [] };
      const options = {
        rules: [
          {
            model: 'deepseek-r1',
            rewriteTo: 'deepseek-r1-fast',
            conditions: [{ field: 'reasoning.enabled', value: false }],
          },
        ],
      };
      const result = modelOverrideAdapter.preDispatch(payload, options);
      expect(result.model).toBe('deepseek-r1');
    });

    it('rewrites when ANY condition matches (OR semantics)', () => {
      const payload = {
        model: 'deepseek-r1',
        reasoning: { enabled: true, effort: 'none' },
        messages: [],
      };
      const options = {
        rules: [
          {
            model: 'deepseek-r1',
            rewriteTo: 'deepseek-r1-fast',
            conditions: [
              { field: 'reasoning.enabled', value: false }, // doesn't match
              { field: 'reasoning.effort', value: 'none' }, // matches
            ],
          },
        ],
      };
      const result = modelOverrideAdapter.preDispatch(payload, options);
      expect(result.model).toBe('deepseek-r1-fast');
    });

    it('does not rewrite when NO condition matches (OR semantics, all fail)', () => {
      const payload = {
        model: 'deepseek-r1',
        reasoning: { enabled: true, effort: 'high' },
        messages: [],
      };
      const options = {
        rules: [
          {
            model: 'deepseek-r1',
            rewriteTo: 'deepseek-r1-fast',
            conditions: [
              { field: 'reasoning.enabled', value: false }, // doesn't match
              { field: 'reasoning.effort', value: 'none' }, // doesn't match
            ],
          },
        ],
      };
      const result = modelOverrideAdapter.preDispatch(payload, options);
      expect(result.model).toBe('deepseek-r1');
    });

    it('supports multiple rules — only the first matching rule applies', () => {
      const payload = {
        model: 'deepseek-r1',
        reasoning: { enabled: false },
        messages: [],
      };
      const options = {
        rules: [
          {
            model: 'deepseek-r1',
            rewriteTo: 'deepseek-r1-fast',
            conditions: [{ field: 'reasoning.enabled', value: false }],
          },
          {
            model: 'deepseek-r1',
            rewriteTo: 'deepseek-r1-mini',
            conditions: [{ field: 'reasoning.enabled', value: false }],
          },
        ],
      };
      const result = modelOverrideAdapter.preDispatch(payload, options);
      expect(result.model).toBe('deepseek-r1-fast');
    });

    it('supports reverse rule (fast → full when reasoning enabled)', () => {
      const payload = {
        model: 'deepseek-r1-fast',
        reasoning: { enabled: true },
        messages: [],
      };
      const options = {
        rules: [
          {
            model: 'deepseek-r1-fast',
            rewriteTo: 'deepseek-r1',
            conditions: [{ field: 'reasoning.enabled', value: true }],
          },
        ],
      };
      const result = modelOverrideAdapter.preDispatch(payload, options);
      expect(result.model).toBe('deepseek-r1');
    });

    it('preserves all other payload fields', () => {
      const payload = {
        model: 'deepseek-r1',
        reasoning: { enabled: false },
        messages: [{ role: 'user', content: 'hello' }],
        temperature: 0.7,
        stream: true,
      };
      const options = {
        rules: [
          {
            model: 'deepseek-r1',
            rewriteTo: 'deepseek-r1-fast',
            conditions: [{ field: 'reasoning.enabled', value: false }],
          },
        ],
      };
      const result = modelOverrideAdapter.preDispatch(payload, options);
      expect(result.model).toBe('deepseek-r1-fast');
      expect(result.messages).toEqual([{ role: 'user', content: 'hello' }]);
      expect(result.temperature).toBe(0.7);
      expect(result.stream).toBe(true);
    });

    it('matches value using strict equality', () => {
      // String "false" should not match boolean false
      const payload = {
        model: 'deepseek-r1',
        reasoning: { enabled: 'false' },
        messages: [],
      };
      const options = {
        rules: [
          {
            model: 'deepseek-r1',
            rewriteTo: 'deepseek-r1-fast',
            conditions: [{ field: 'reasoning.enabled', value: false }],
          },
        ],
      };
      const result = modelOverrideAdapter.preDispatch(payload, options);
      expect(result.model).toBe('deepseek-r1'); // no rewrite — strict equality
    });
  });

  describe('postDispatch', () => {
    it('returns response unchanged', () => {
      const response = { id: 'resp-1', model: 'deepseek-r1-fast' };
      expect(modelOverrideAdapter.postDispatch(response)).toBe(response);
    });

    it('returns response unchanged even with options', () => {
      const response = { id: 'resp-1', model: 'deepseek-r1-fast' };
      expect(modelOverrideAdapter.postDispatch(response, { rules: [] })).toBe(response);
    });
  });
});
