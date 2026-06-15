import { describe, expect, it } from 'vitest';
import {
  reasoningRewriteAdapter,
  setDottedPath,
  removeDottedPath,
} from '../reasoning-rewrite.adapter';

// ── setDottedPath ──────────────────────────────────────────────────────

describe('setDottedPath', () => {
  it('sets a top-level field', () => {
    const obj: Record<string, any> = {};
    setDottedPath(obj, 'enable_thinking', true);
    expect(obj.enable_thinking).toBe(true);
  });

  it('sets a nested field, creating intermediate objects', () => {
    const obj: Record<string, any> = {};
    setDottedPath(obj, 'chat_template_kwargs.enable_thinking', false);
    expect(obj.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it('sets a deeply nested field', () => {
    const obj: Record<string, any> = {};
    setDottedPath(obj, 'a.b.c', 42);
    expect(obj.a.b.c).toBe(42);
  });

  it('overwrites an existing value', () => {
    const obj: Record<string, any> = { enable_thinking: false };
    setDottedPath(obj, 'enable_thinking', true);
    expect(obj.enable_thinking).toBe(true);
  });

  it('preserves sibling keys when setting a nested field', () => {
    const obj: Record<string, any> = { thinking: { type: 'enabled' } };
    setDottedPath(obj, 'thinking.budget', 1024);
    expect(obj.thinking).toEqual({ type: 'enabled', budget: 1024 });
  });

  it('replaces a primitive with an object when needed', () => {
    const obj: Record<string, any> = { thinking: 'old' };
    setDottedPath(obj, 'thinking.type', 'enabled');
    expect(obj.thinking).toEqual({ type: 'enabled' });
  });

  it('skips the write when value is undefined', () => {
    const obj: Record<string, any> = { existing: true };
    setDottedPath(obj, 'existing', undefined);
    expect(obj.existing).toBe(true); // unchanged
    setDottedPath(obj, 'new_field', undefined);
    expect(obj.new_field).toBeUndefined();
  });

  it('sets null values', () => {
    const obj: Record<string, any> = {};
    setDottedPath(obj, 'reasoning', null);
    expect(obj.reasoning).toBeNull();
  });
});

// ── removeDottedPath ──────────────────────────────────────────────────

describe('removeDottedPath', () => {
  it('removes a top-level field', () => {
    const obj: Record<string, any> = { reasoning: { effort: 'high' }, model: 'x' };
    removeDottedPath(obj, 'reasoning');
    expect(obj).toEqual({ model: 'x' });
  });

  it('removes a nested field', () => {
    const obj: Record<string, any> = { reasoning: { effort: 'high', enabled: true } };
    removeDottedPath(obj, 'reasoning.effort');
    expect(obj.reasoning).toEqual({ enabled: true });
  });

  it('is a no-op when path does not exist', () => {
    const obj: Record<string, any> = { model: 'x' };
    removeDottedPath(obj, 'reasoning');
    expect(obj).toEqual({ model: 'x' });
  });

  it('is a no-op when partial path does not exist', () => {
    const obj: Record<string, any> = { model: 'x' };
    removeDottedPath(obj, 'reasoning.effort');
    expect(obj).toEqual({ model: 'x' });
  });

  it('is a no-op when traversing through null', () => {
    const obj: Record<string, any> = { reasoning: null };
    removeDottedPath(obj, 'reasoning.effort');
    expect(obj).toEqual({ reasoning: null });
  });

  it('is a no-op when traversing through primitive', () => {
    const obj: Record<string, any> = { reasoning: 'string' };
    removeDottedPath(obj, 'reasoning.effort');
    expect(obj).toEqual({ reasoning: 'string' });
  });
});

// ── preDispatch ──────────────────────────────────────────────────────

describe('reasoning_rewrite adapter', () => {
  describe('preDispatch', () => {
    // ── No-op cases ────────────────────────────────────────────────

    it('returns payload unchanged when no options provided', () => {
      const payload = { model: 'x', messages: [] };
      expect(reasoningRewriteAdapter.preDispatch(payload)).toBe(payload);
    });

    it('returns payload unchanged when options has no rules', () => {
      const payload = { model: 'x', messages: [] };
      expect(reasoningRewriteAdapter.preDispatch(payload, {})).toBe(payload);
    });

    it('returns payload unchanged when rules is empty array', () => {
      const payload = { model: 'x', messages: [] };
      expect(reasoningRewriteAdapter.preDispatch(payload, { rules: [] })).toBe(payload);
    });

    // ── Literal value ──────────────────────────────────────────────

    it('writes a literal value when source field is present (no when clause)', () => {
      const payload = { model: 'x', reasoning: { effort: 'none' }, messages: [] };
      const options = {
        rules: [
          {
            source: 'reasoning.effort',
            rewrites: [{ target: 'budget_tokens', value: 0 }],
          },
        ],
      };
      const result = reasoningRewriteAdapter.preDispatch(payload, options);
      expect(result.budget_tokens).toBe(0);
    });

    it('does not fire when source field is absent (no when clause)', () => {
      const payload = { model: 'x', messages: [] };
      const options = {
        rules: [
          {
            source: 'reasoning.enabled',
            rewrites: [{ target: 'enable_thinking', value: false }],
          },
        ],
      };
      const result = reasoningRewriteAdapter.preDispatch(payload, options);
      expect(result.enable_thinking).toBeUndefined();
    });

    // ── Value transforms: from: "source" ──────────────────────────

    it('passes source value through with { from: "source" }', () => {
      const payload = { model: 'x', reasoning: { enabled: true }, messages: [] };
      const options = {
        rules: [
          {
            source: 'reasoning.enabled',
            rewrites: [{ target: 'enable_thinking', value: { from: 'source' } }],
          },
        ],
      };
      const result = reasoningRewriteAdapter.preDispatch(payload, options);
      expect(result.enable_thinking).toBe(true);
    });

    it('passes numeric source value through with { from: "source" }', () => {
      const payload = { model: 'x', reasoning: { max_tokens: 8192 }, messages: [] };
      const options = {
        rules: [
          {
            source: 'reasoning.max_tokens',
            rewrites: [{ target: 'thinking_budget', value: { from: 'source' } }],
          },
        ],
      };
      const result = reasoningRewriteAdapter.preDispatch(payload, options);
      expect(result.thinking_budget).toBe(8192);
    });

    // ── Value transforms: from: "boolean" ────────────────────────

    it('maps boolean true via { from: "boolean" }', () => {
      const payload = { model: 'x', reasoning: { enabled: true }, messages: [] };
      const options = {
        rules: [
          {
            source: 'reasoning.enabled',
            rewrites: [
              {
                target: 'thinking.type',
                value: { from: 'boolean', truthy: 'enabled', falsy: 'disabled' },
              },
            ],
          },
        ],
      };
      const result = reasoningRewriteAdapter.preDispatch(payload, options);
      expect(result.thinking).toEqual({ type: 'enabled' });
    });

    it('maps boolean false via { from: "boolean" }', () => {
      const payload = { model: 'x', reasoning: { enabled: false }, messages: [] };
      const options = {
        rules: [
          {
            source: 'reasoning.enabled',
            rewrites: [
              {
                target: 'thinking.type',
                value: { from: 'boolean', truthy: 'enabled', falsy: 'disabled' },
              },
            ],
          },
        ],
      };
      const result = reasoningRewriteAdapter.preDispatch(payload, options);
      expect(result.thinking).toEqual({ type: 'disabled' });
    });

    it('maps truthy/falsy non-boolean values via { from: "boolean" }', () => {
      const payload = { model: 'x', reasoning: { enabled: 1 }, messages: [] };
      const options = {
        rules: [
          {
            source: 'reasoning.enabled',
            rewrites: [
              {
                target: 'thinking.type',
                value: { from: 'boolean', truthy: 'enabled', falsy: 'disabled' },
              },
            ],
          },
        ],
      };
      const result = reasoningRewriteAdapter.preDispatch(payload, options);
      expect(result.thinking).toEqual({ type: 'enabled' }); // 1 is truthy
    });

    // ── Value transforms: from: "map" ────────────────────────────

    it('maps source value via { from: "map" }', () => {
      const payload = { model: 'x', reasoning: { effort: 'high' }, messages: [] };
      const options = {
        rules: [
          {
            source: 'reasoning.effort',
            rewrites: [
              {
                target: 'budget_tokens',
                value: {
                  from: 'map',
                  values: { none: 0, low: 1024, medium: 8192, high: 32768 },
                },
              },
            ],
          },
        ],
      };
      const result = reasoningRewriteAdapter.preDispatch(payload, options);
      expect(result.budget_tokens).toBe(32768);
    });

    it('skips write when map key is not found', () => {
      const payload = { model: 'x', reasoning: { effort: 'xhigh' }, messages: [] };
      const options = {
        rules: [
          {
            source: 'reasoning.effort',
            rewrites: [
              {
                target: 'budget_tokens',
                value: {
                  from: 'map',
                  values: { none: 0, low: 1024, medium: 8192, high: 32768 },
                },
              },
            ],
          },
        ],
      };
      const result = reasoningRewriteAdapter.preDispatch(payload, options);
      expect(result.budget_tokens).toBeUndefined();
    });

    // ── When conditions ──────────────────────────────────────────

    describe('when conditions', () => {
      it('eq: fires when value matches', () => {
        const payload = { model: 'x', reasoning: { effort: 'none' }, messages: [] };
        const options = {
          rules: [
            {
              source: 'reasoning.effort',
              when: { op: 'eq', value: 'none' },
              rewrites: [{ target: 'budget_tokens', value: 0 }],
            },
          ],
        };
        const result = reasoningRewriteAdapter.preDispatch(payload, options);
        expect(result.budget_tokens).toBe(0);
      });

      it('eq: does not fire when value does not match', () => {
        const payload = { model: 'x', reasoning: { effort: 'high' }, messages: [] };
        const options = {
          rules: [
            {
              source: 'reasoning.effort',
              when: { op: 'eq', value: 'none' },
              rewrites: [{ target: 'budget_tokens', value: 0 }],
            },
          ],
        };
        const result = reasoningRewriteAdapter.preDispatch(payload, options);
        expect(result.budget_tokens).toBeUndefined();
      });

      it('neq: fires when value differs', () => {
        const payload = { model: 'x', reasoning: { effort: 'high' }, messages: [] };
        const options = {
          rules: [
            {
              source: 'reasoning.effort',
              when: { op: 'neq', value: 'none' },
              rewrites: [{ target: 'budget_tokens', value: 8192 }],
            },
          ],
        };
        const result = reasoningRewriteAdapter.preDispatch(payload, options);
        expect(result.budget_tokens).toBe(8192);
      });

      it('gt: fires when source is greater', () => {
        const payload = { model: 'x', budget_tokens: 100, messages: [] };
        const options = {
          rules: [
            {
              source: 'budget_tokens',
              when: { op: 'gt', value: 0 },
              rewrites: [{ target: 'enable_thinking', value: true }],
            },
          ],
        };
        const result = reasoningRewriteAdapter.preDispatch(payload, options);
        expect(result.enable_thinking).toBe(true);
      });

      it('gte: fires when source is equal', () => {
        const payload = { model: 'x', budget_tokens: 0, messages: [] };
        const options = {
          rules: [
            {
              source: 'budget_tokens',
              when: { op: 'gte', value: 0 },
              rewrites: [{ target: 'enable_thinking', value: true }],
            },
          ],
        };
        const result = reasoningRewriteAdapter.preDispatch(payload, options);
        expect(result.enable_thinking).toBe(true);
      });

      it('lt: fires when source is less than', () => {
        const payload = { model: 'x', budget_tokens: 5, messages: [] };
        const options = {
          rules: [
            {
              source: 'budget_tokens',
              when: { op: 'lt', value: 10 },
              rewrites: [{ target: 'enable_thinking', value: false }],
            },
          ],
        };
        const result = reasoningRewriteAdapter.preDispatch(payload, options);
        expect(result.enable_thinking).toBe(false);
      });

      it('lte: fires when source is equal', () => {
        const payload = { model: 'x', budget_tokens: 10, messages: [] };
        const options = {
          rules: [
            {
              source: 'budget_tokens',
              when: { op: 'lte', value: 10 },
              rewrites: [{ target: 'enable_thinking', value: false }],
            },
          ],
        };
        const result = reasoningRewriteAdapter.preDispatch(payload, options);
        expect(result.enable_thinking).toBe(false);
      });

      it('in: fires when source is in the values list', () => {
        const payload = { model: 'x', reasoning: { effort: 'medium' }, messages: [] };
        const options = {
          rules: [
            {
              source: 'reasoning.effort',
              when: { op: 'in', values: ['low', 'medium', 'high'] },
              rewrites: [{ target: 'budget_tokens', value: 8192 }],
            },
          ],
        };
        const result = reasoningRewriteAdapter.preDispatch(payload, options);
        expect(result.budget_tokens).toBe(8192);
      });

      it('in: does not fire when source is not in the values list', () => {
        const payload = { model: 'x', reasoning: { effort: 'none' }, messages: [] };
        const options = {
          rules: [
            {
              source: 'reasoning.effort',
              when: { op: 'in', values: ['low', 'medium', 'high'] },
              rewrites: [{ target: 'budget_tokens', value: 8192 }],
            },
          ],
        };
        const result = reasoningRewriteAdapter.preDispatch(payload, options);
        expect(result.budget_tokens).toBeUndefined();
      });

      it('present: fires when field exists regardless of value', () => {
        const payload = { model: 'x', reasoning: { effort: null }, messages: [] };
        const options = {
          rules: [
            {
              source: 'reasoning.effort',
              when: { op: 'present' },
              rewrites: [{ target: 'enable_thinking', value: true }],
            },
          ],
        };
        const result = reasoningRewriteAdapter.preDispatch(payload, options);
        expect(result.enable_thinking).toBe(true);
      });

      it('present: does not fire when field is absent', () => {
        const payload = { model: 'x', messages: [] };
        const options = {
          rules: [
            {
              source: 'reasoning.effort',
              when: { op: 'present' },
              rewrites: [{ target: 'enable_thinking', value: true }],
            },
          ],
        };
        const result = reasoningRewriteAdapter.preDispatch(payload, options);
        expect(result.enable_thinking).toBeUndefined();
      });

      it('absent: fires when field is absent', () => {
        const payload = { model: 'x', messages: [] };
        const options = {
          rules: [
            {
              source: 'reasoning.effort',
              when: { op: 'absent' },
              rewrites: [{ target: 'enable_thinking', value: false }],
            },
          ],
        };
        const result = reasoningRewriteAdapter.preDispatch(payload, options);
        expect(result.enable_thinking).toBe(false);
      });

      it('absent: does not fire when field is present', () => {
        const payload = { model: 'x', reasoning: { effort: 'low' }, messages: [] };
        const options = {
          rules: [
            {
              source: 'reasoning.effort',
              when: { op: 'absent' },
              rewrites: [{ target: 'enable_thinking', value: false }],
            },
          ],
        };
        const result = reasoningRewriteAdapter.preDispatch(payload, options);
        expect(result.enable_thinking).toBeUndefined();
      });
    });

    // ── Multiple rewrites per rule ────────────────────────────────

    it('applies all rewrites in a single rule', () => {
      const payload = { model: 'x', reasoning: { enabled: true }, messages: [] };
      const options = {
        rules: [
          {
            source: 'reasoning.enabled',
            rewrites: [
              { target: 'enable_thinking', value: { from: 'source' } },
              {
                target: 'thinking.type',
                value: { from: 'boolean', truthy: 'enabled', falsy: 'disabled' },
              },
            ],
          },
        ],
      };
      const result = reasoningRewriteAdapter.preDispatch(payload, options);
      expect(result.enable_thinking).toBe(true);
      expect(result.thinking).toEqual({ type: 'enabled' });
    });

    // ── Multiple rules ────────────────────────────────────────────

    it('applies multiple rules in order', () => {
      const payload = {
        model: 'x',
        reasoning: { enabled: true, effort: 'high' },
        messages: [],
      };
      const options = {
        rules: [
          {
            source: 'reasoning.enabled',
            rewrites: [{ target: 'enable_thinking', value: { from: 'source' } }],
          },
          {
            source: 'reasoning.effort',
            when: { op: 'eq', value: 'none' },
            rewrites: [{ target: 'budget_tokens', value: 0 }],
          },
          {
            source: 'reasoning.effort',
            when: { op: 'in', values: ['low', 'medium', 'high'] },
            rewrites: [
              {
                target: 'budget_tokens',
                value: { from: 'map', values: { low: 1024, medium: 8192, high: 32768 } },
              },
            ],
          },
        ],
      };
      const result = reasoningRewriteAdapter.preDispatch(payload, options);
      expect(result.enable_thinking).toBe(true);
      expect(result.budget_tokens).toBe(32768);
    });

    // ── Strip ─────────────────────────────────────────────────────

    it('strips specified paths after rewriting', () => {
      const payload = {
        model: 'x',
        reasoning: { enabled: true },
        messages: [],
      };
      const options = {
        rules: [
          {
            source: 'reasoning.enabled',
            rewrites: [{ target: 'enable_thinking', value: { from: 'source' } }],
            strip: ['reasoning'],
          },
        ],
      };
      const result = reasoningRewriteAdapter.preDispatch(payload, options);
      expect(result.enable_thinking).toBe(true);
      expect(result.reasoning).toBeUndefined();
    });

    it('strips nested paths', () => {
      const payload = {
        model: 'x',
        reasoning: { enabled: true, effort: 'high' },
        messages: [],
      };
      const options = {
        rules: [
          {
            source: 'reasoning.enabled',
            rewrites: [{ target: 'enable_thinking', value: { from: 'source' } }],
            strip: ['reasoning.enabled'],
          },
        ],
      };
      const result = reasoningRewriteAdapter.preDispatch(payload, options);
      expect(result.enable_thinking).toBe(true);
      expect(result.reasoning).toEqual({ effort: 'high' });
    });

    it('does not strip when rule does not fire', () => {
      const payload = {
        model: 'x',
        reasoning: { effort: 'high' },
        messages: [],
      };
      const options = {
        rules: [
          {
            source: 'reasoning.enabled',
            rewrites: [{ target: 'enable_thinking', value: true }],
            strip: ['reasoning'],
          },
        ],
      };
      const result = reasoningRewriteAdapter.preDispatch(payload, options);
      // Source is absent, rule doesn't fire → no strip
      expect(result.reasoning).toEqual({ effort: 'high' });
      expect(result.enable_thinking).toBeUndefined();
    });

    // ── Same-API-type case (originalBody fields present) ──────────

    it('overwrites originalBody passthrough fields when adapter maps them', () => {
      // Simulates chat→chat where originalBody was spread, so enable_thinking
      // is already in the payload from the client, but the adapter's mapping
      // should be authoritative.
      const payload = {
        model: 'x',
        enable_thinking: false, // from originalBody — client sent this
        reasoning: { enabled: true }, // from transformer overlay
        messages: [],
      };
      const options = {
        rules: [
          {
            source: 'reasoning.enabled',
            rewrites: [{ target: 'enable_thinking', value: { from: 'source' } }],
          },
        ],
      };
      const result = reasoningRewriteAdapter.preDispatch(payload, options);
      // Adapter's value (from reasoning.enabled=true) wins
      expect(result.enable_thinking).toBe(true);
    });

    it('preserves originalBody passthrough fields when adapter has no matching rule', () => {
      const payload = {
        model: 'x',
        enable_thinking: true, // from originalBody — no rule touches this
        messages: [],
      };
      const options = {
        rules: [
          {
            source: 'reasoning.enabled',
            rewrites: [{ target: 'budget_tokens', value: 8192 }],
          },
        ],
      };
      const result = reasoningRewriteAdapter.preDispatch(payload, options);
      // No reasoning.enabled in payload → rule doesn't fire → enable_thinking preserved
      expect(result.enable_thinking).toBe(true);
      expect(result.budget_tokens).toBeUndefined();
    });

    // ── Deep nested paths ─────────────────────────────────────────

    it('writes to deep nested target paths', () => {
      const payload = { model: 'x', reasoning: { enabled: false }, messages: [] };
      const options = {
        rules: [
          {
            source: 'reasoning.enabled',
            rewrites: [
              { target: 'chat_template_kwargs.enable_thinking', value: { from: 'source' } },
            ],
          },
        ],
      };
      const result = reasoningRewriteAdapter.preDispatch(payload, options);
      expect(result.chat_template_kwargs).toEqual({ enable_thinking: false });
    });

    // ── Complex real-world scenario ───────────────────────────────

    it('DeepSeek-style full mapping: reasoning → enable_thinking + thinking.type + budget_tokens', () => {
      const payload = {
        model: 'deepseek-r1',
        reasoning: { enabled: true, effort: 'high' },
        messages: [{ role: 'user', content: 'hello' }],
        temperature: 0.7,
        stream: true,
      };
      const options = {
        rules: [
          {
            source: 'reasoning.enabled',
            rewrites: [
              { target: 'enable_thinking', value: { from: 'source' } },
              {
                target: 'thinking.type',
                value: { from: 'boolean', truthy: 'enabled', falsy: 'disabled' },
              },
            ],
            strip: ['reasoning'],
          },
          {
            source: 'reasoning.effort',
            // This rule won't fire because we stripped reasoning above,
            // BUT reasoning.effort is read BEFORE strip in the same rule.
            // Actually, the strip happens after rewrites of rule 1, so by
            // the time rule 2 runs, reasoning.effort is gone.
            // This is a real behavior — rules are sequential.
            when: { op: 'in', values: ['low', 'medium', 'high'] },
            rewrites: [
              {
                target: 'budget_tokens',
                value: { from: 'map', values: { low: 1024, medium: 8192, high: 32768 } },
              },
            ],
          },
        ],
      };
      const result = reasoningRewriteAdapter.preDispatch(payload, options);
      expect(result.enable_thinking).toBe(true);
      expect(result.thinking).toEqual({ type: 'enabled' });
      expect(result.reasoning).toBeUndefined();
      // Rule 2 won't fire because reasoning.effort was stripped by rule 1's strip
      expect(result.budget_tokens).toBeUndefined();
    });

    it('DeepSeek-style with effort rule FIRST (correct ordering)', () => {
      const payload = {
        model: 'deepseek-r1',
        reasoning: { enabled: true, effort: 'high' },
        messages: [],
      };
      const options = {
        rules: [
          // Map effort first, before reasoning is stripped
          {
            source: 'reasoning.effort',
            when: { op: 'in', values: ['low', 'medium', 'high'] },
            rewrites: [
              {
                target: 'budget_tokens',
                value: { from: 'map', values: { low: 1024, medium: 8192, high: 32768 } },
              },
            ],
          },
          // Then map enabled → enable_thinking + thinking.type, strip reasoning
          {
            source: 'reasoning.enabled',
            rewrites: [
              { target: 'enable_thinking', value: { from: 'source' } },
              {
                target: 'thinking.type',
                value: { from: 'boolean', truthy: 'enabled', falsy: 'disabled' },
              },
            ],
            strip: ['reasoning'],
          },
        ],
      };
      const result = reasoningRewriteAdapter.preDispatch(payload, options);
      expect(result.budget_tokens).toBe(32768);
      expect(result.enable_thinking).toBe(true);
      expect(result.thinking).toEqual({ type: 'enabled' });
      expect(result.reasoning).toBeUndefined();
    });

    // ── Preserves other payload fields ─────────────────────────────

    it('preserves all other payload fields', () => {
      const payload = {
        model: 'x',
        reasoning: { enabled: true },
        messages: [{ role: 'user', content: 'hello' }],
        temperature: 0.7,
        stream: true,
        max_tokens: 4096,
      };
      const options = {
        rules: [
          {
            source: 'reasoning.enabled',
            rewrites: [{ target: 'enable_thinking', value: { from: 'source' } }],
            strip: ['reasoning'],
          },
        ],
      };
      const result = reasoningRewriteAdapter.preDispatch(payload, options);
      expect(result.model).toBe('x');
      expect(result.messages).toEqual([{ role: 'user', content: 'hello' }]);
      expect(result.temperature).toBe(0.7);
      expect(result.stream).toBe(true);
      expect(result.max_tokens).toBe(4096);
      expect(result.enable_thinking).toBe(true);
      expect(result.reasoning).toBeUndefined();
    });
  });

  // ── postDispatch ───────────────────────────────────────────────

  describe('postDispatch', () => {
    it('returns response unchanged', () => {
      const response = { id: 'resp-1', model: 'deepseek-r1' };
      expect(reasoningRewriteAdapter.postDispatch(response)).toBe(response);
    });

    it('returns response unchanged even with options', () => {
      const response = { id: 'resp-1', model: 'deepseek-r1' };
      expect(reasoningRewriteAdapter.postDispatch(response, { rules: [] })).toBe(response);
    });
  });
});
