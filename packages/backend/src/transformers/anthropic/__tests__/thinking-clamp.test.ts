import { describe, expect, it } from 'vitest';
import { anthropicModelSupportsDisable, clampAnthropicEffortAndThinking } from '../thinking-clamp';

describe('anthropicModelSupportsDisable', () => {
  it('identifies models that cannot disable thinking', () => {
    expect(anthropicModelSupportsDisable('claude-opus-5')).toBe(false);
    expect(anthropicModelSupportsDisable('claude-opus-5-20260301')).toBe(false);
    expect(anthropicModelSupportsDisable('anthropic/claude-opus-5')).toBe(false);
    expect(anthropicModelSupportsDisable('claude-opus-5:off')).toBe(false);
    expect(anthropicModelSupportsDisable('claude-fable-5')).toBe(false);
    expect(anthropicModelSupportsDisable('claude-fable-5-1')).toBe(false);
    expect(anthropicModelSupportsDisable('custom-opus-5')).toBe(false);
  });

  it('identifies models that can disable thinking or do not restrict off', () => {
    expect(anthropicModelSupportsDisable('claude-sonnet-4-6')).toBe(true);
    expect(anthropicModelSupportsDisable('claude-3-7-sonnet')).toBe(true);
    expect(anthropicModelSupportsDisable('claude-haiku-4-5')).toBe(true);
    expect(anthropicModelSupportsDisable('claude-opus-4-6')).toBe(true);
    expect(anthropicModelSupportsDisable(undefined)).toBe(true);
  });
});

describe('clampAnthropicEffortAndThinking', () => {
  describe('models that cannot disable thinking (e.g. claude-opus-5)', () => {
    it('clamps thinking: disabled to adaptive with effort: low', () => {
      const payload = {
        model: 'claude-opus-5',
        thinking: { type: 'disabled' },
      };
      const result = clampAnthropicEffortAndThinking(payload);
      expect(result.thinking).toEqual({ type: 'adaptive' });
      expect(result.output_config).toEqual({ effort: 'low' });
    });

    it('clamps output_config.effort: off to adaptive with effort: low', () => {
      const payload = {
        model: 'claude-opus-5',
        output_config: { effort: 'off' },
      };
      const result = clampAnthropicEffortAndThinking(payload);
      expect(result.thinking).toEqual({ type: 'adaptive' });
      expect(result.output_config).toEqual({ effort: 'low' });
    });

    it('clamps effort: minimal to low', () => {
      const payload = {
        model: 'claude-opus-5',
        thinking: { type: 'adaptive' },
        output_config: { effort: 'minimal' },
      };
      const result = clampAnthropicEffortAndThinking(payload);
      expect(result.thinking).toEqual({ type: 'adaptive' });
      expect(result.output_config).toEqual({ effort: 'low' });
    });

    it('preserves valid effort levels (low, medium, high, max)', () => {
      for (const effort of ['low', 'medium', 'high', 'max'] as const) {
        const payload = {
          model: 'claude-opus-5',
          thinking: { type: 'adaptive' },
          output_config: { effort },
        };
        const result = clampAnthropicEffortAndThinking(payload);
        expect(result.output_config).toEqual({ effort });
      }
    });

    it('preserves thinking display option when mapping from disabled', () => {
      const payload = {
        model: 'claude-opus-5',
        thinking: { type: 'disabled', display: 'raw' },
      };
      const result = clampAnthropicEffortAndThinking(payload);
      expect(result.thinking).toEqual({ type: 'adaptive', display: 'raw' });
      expect(result.output_config).toEqual({ effort: 'low' });
    });
  });

  describe('models that can disable thinking (e.g. claude-sonnet-4-6)', () => {
    it('clamps effort: minimal to low', () => {
      const payload = {
        model: 'claude-sonnet-4-6',
        output_config: { effort: 'minimal' },
      };
      const result = clampAnthropicEffortAndThinking(payload);
      expect(result.output_config).toEqual({ effort: 'low' });
    });

    it('maps effort: off to thinking: disabled and removes output_config.effort', () => {
      const payload = {
        model: 'claude-sonnet-4-6',
        output_config: { effort: 'off' },
      };
      const result = clampAnthropicEffortAndThinking(payload);
      expect(result.thinking).toEqual({ type: 'disabled' });
      expect(result.output_config).toBeUndefined();
    });

    it('removes output_config.effort if thinking is explicitly disabled', () => {
      const payload = {
        model: 'claude-sonnet-4-6',
        thinking: { type: 'disabled' },
        output_config: { effort: 'high' },
      };
      const result = clampAnthropicEffortAndThinking(payload);
      expect(result.thinking).toEqual({ type: 'disabled' });
      expect(result.output_config).toBeUndefined();
    });

    it('preserves thinking: disabled when output_config is absent', () => {
      const payload = {
        model: 'claude-sonnet-4-6',
        thinking: { type: 'disabled' },
      };
      const result = clampAnthropicEffortAndThinking(payload);
      expect(result.thinking).toEqual({ type: 'disabled' });
      expect(result.output_config).toBeUndefined();
    });

    it('preserves valid effort levels', () => {
      const payload = {
        model: 'claude-sonnet-4-6',
        output_config: { effort: 'high' },
      };
      const result = clampAnthropicEffortAndThinking(payload);
      expect(result.output_config).toEqual({ effort: 'high' });
    });

    it('handles case-insensitive effort values', () => {
      const payload = {
        model: 'claude-sonnet-4-6',
        output_config: { effort: 'MINIMAL' },
      };
      const result = clampAnthropicEffortAndThinking(payload);
      expect(result.output_config).toEqual({ effort: 'low' });
    });
  });

  describe('passthrough and defensive guards', () => {
    it('returns falsy or non-object payloads untouched', () => {
      expect(
        clampAnthropicEffortAndThinking(null as unknown as Record<string, unknown>)
      ).toBeNull();
      expect(
        clampAnthropicEffortAndThinking(undefined as unknown as Record<string, unknown>)
      ).toBeUndefined();
      expect(clampAnthropicEffortAndThinking('string' as unknown as Record<string, unknown>)).toBe(
        'string'
      );
    });

    it('clamps unrecognized effort strings to low', () => {
      const payload = {
        model: 'claude-opus-5',
        output_config: { effort: 'turbo' },
      };
      const result = clampAnthropicEffortAndThinking(payload);
      expect(result.output_config).toEqual({ effort: 'low' });
    });
  });
});
