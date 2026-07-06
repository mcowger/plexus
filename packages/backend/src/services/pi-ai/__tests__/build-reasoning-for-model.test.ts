import { describe, it, expect, vi } from 'vitest';
import type { ReasoningIntent } from '../reasoning';

// buildReasoningOptionsForModel calls into pi-ai's clampThinkingLevel /
// getSupportedThinkingLevels. The global mock in test/vitest.setup.ts does NOT
// provide those, so mock them locally with faithful re-implementations that
// honour thinkingLevelMap (mirroring pi-ai's real models.ts).
vi.mock('@earendil-works/pi-ai', () => {
  const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
  const getSupportedThinkingLevels = (model: any) => {
    if (!model.reasoning) return ['off'];
    return LEVELS.filter((level) => {
      const mapped = model.thinkingLevelMap?.[level];
      if (mapped === null) return false;
      if (level === 'xhigh') return mapped !== undefined;
      return true;
    });
  };
  const clampThinkingLevel = (model: any, level: string) => {
    const avail = getSupportedThinkingLevels(model);
    if (avail.includes(level)) return level;
    const idx = LEVELS.indexOf(level as any);
    if (idx === -1) return avail[0] ?? 'off';
    for (let i = idx; i < LEVELS.length; i++) {
      const c = LEVELS[i];
      if (c && avail.includes(c)) return c;
    }
    for (let i = idx - 1; i >= 0; i--) {
      const c = LEVELS[i];
      if (c && avail.includes(c)) return c;
    }
    return avail[0] ?? 'off';
  };
  return {
    getModel: (provider: string, modelId: string) => ({ id: modelId, provider }),
    getSupportedThinkingLevels,
    clampThinkingLevel,
  };
});

import { buildReasoningOptionsForModel, buildGenerationOptions } from '../registry';
import type { GenerationIntent } from '../generation';

const intent = (o: Partial<ReasoningIntent>): ReasoningIntent => ({ source: 'client', ...o });

describe('buildReasoningOptionsForModel', () => {
  describe('non-reasoning model', () => {
    const model = { api: 'openai-completions', reasoning: false } as any;
    it('never emits thinking params even when requested', () => {
      expect(
        buildReasoningOptionsForModel(model, intent({ effort: 'high', enabled: true }))
      ).toEqual({});
    });
  });

  describe('Layer 3: client said nothing → model default', () => {
    it('emits nothing for a reasoning model when intent is empty', () => {
      const model = { api: 'anthropic-messages', reasoning: true } as any;
      expect(buildReasoningOptionsForModel(model, intent({}))).toEqual({});
    });

    it('emits nothing when intent is undefined', () => {
      const model = { api: 'openai-responses', reasoning: true } as any;
      expect(buildReasoningOptionsForModel(model, undefined)).toEqual({});
    });
  });

  describe('OpenAI responses family', () => {
    const model = { api: 'openai-responses', reasoning: true } as any;
    it('maps effort to reasoningEffort', () => {
      const opts = buildReasoningOptionsForModel(
        model,
        intent({ effort: 'medium', enabled: true })
      );
      expect(opts.reasoningEffort).toBe('medium');
      expect(opts.reasoning).toBe('medium');
    });
    it('passes reasoningSummary when visibility requests a summary', () => {
      const opts = buildReasoningOptionsForModel(
        model,
        intent({ effort: 'high', enabled: true, visibility: 'summary', summaryDetail: 'detailed' })
      );
      expect(opts.reasoningSummary).toBe('detailed');
    });
  });

  describe('Anthropic adaptive vs budget', () => {
    it('adaptive model uses effort and maps xhigh via thinkingLevelMap', () => {
      const model = {
        api: 'anthropic-messages',
        reasoning: true,
        compat: { forceAdaptiveThinking: true },
        thinkingLevelMap: { xhigh: 'max' },
      } as any;
      const opts = buildReasoningOptionsForModel(model, intent({ effort: 'xhigh', enabled: true }));
      expect(opts.thinkingEnabled).toBe(true);
      expect(opts.effort).toBe('xhigh');
      expect(opts.thinkingBudgetTokens).toBeUndefined();
    });

    it('adaptive model + adaptive intent passes through with NO effort (model decides)', () => {
      const model = {
        api: 'anthropic-messages',
        reasoning: true,
        compat: { forceAdaptiveThinking: true },
        thinkingLevelMap: { high: 'high', xhigh: 'max' },
      } as any;
      const opts = buildReasoningOptionsForModel(
        model,
        intent({ adaptive: true, enabled: true, visibility: 'summary' })
      );
      // True adaptive: thinking on, no effort pinned, model chooses magnitude.
      expect(opts.thinkingEnabled).toBe(true);
      expect(opts.effort).toBeUndefined();
      expect(opts.thinkingBudgetTokens).toBeUndefined();
      expect(opts.thinkingDisplay).toBe('summarized');
      // No leftover streamSimple-compat reasoning level.
      expect(opts.reasoning).toBeUndefined();
    });

    it('adaptive model + explicit effort still pins that effort (client committed)', () => {
      const model = {
        api: 'anthropic-messages',
        reasoning: true,
        compat: { forceAdaptiveThinking: true },
        thinkingLevelMap: { high: 'high', xhigh: 'max' },
      } as any;
      const opts = buildReasoningOptionsForModel(
        model,
        intent({ adaptive: true, effort: 'xhigh', enabled: true })
      );
      expect(opts.thinkingEnabled).toBe(true);
      expect(opts.effort).toBe('xhigh');
    });

    it('legacy (budget) model flattens an adaptive intent to the default-effort budget', () => {
      const model = { api: 'anthropic-messages', reasoning: true } as any;
      const opts = buildReasoningOptionsForModel(model, intent({ adaptive: true, enabled: true }));
      // Non-adaptive model can't express "model decides" — flatten to the
      // documented default effort (high → 16384 budget).
      expect(opts.thinkingEnabled).toBe(true);
      expect(opts.thinkingBudgetTokens).toBe(16384);
    });

    it('completions egress flattens an adaptive intent to the default effort (not none)', () => {
      const model = { api: 'openai-completions', reasoning: true } as any;
      const opts = buildReasoningOptionsForModel(model, intent({ adaptive: true, enabled: true }));
      expect(opts.reasoningEffort).toBe('high');
      expect(opts.reasoning).toBe('high');
    });

    it('legacy model uses budget tokens, round-tripping client budget', () => {
      const model = { api: 'anthropic-messages', reasoning: true } as any;
      const opts = buildReasoningOptionsForModel(
        model,
        intent({ effort: 'medium', budgetTokens: 12345, enabled: true })
      );
      expect(opts.thinkingEnabled).toBe(true);
      expect(opts.thinkingBudgetTokens).toBe(12345);
    });

    it('legacy model derives budget from effort when none supplied', () => {
      const model = { api: 'anthropic-messages', reasoning: true } as any;
      const opts = buildReasoningOptionsForModel(model, intent({ effort: 'high', enabled: true }));
      expect(opts.thinkingBudgetTokens).toBe(16384);
    });
  });

  describe('Gemini level-based vs budget-based', () => {
    it('level-based (Gemini 3) maps effort to provider level via thinkingLevelMap', () => {
      const model = {
        api: 'google-generative-ai',
        reasoning: true,
        thinkingLevelMap: { off: null, low: 'LOW', high: 'HIGH' },
      } as any;
      const opts = buildReasoningOptionsForModel(model, intent({ effort: 'high', enabled: true }));
      expect(opts.thinking).toEqual({ enabled: true, includeThoughts: true, level: 'HIGH' });
    });

    it('budget-based (Gemini 2.x) sends budgetTokens', () => {
      const model = { api: 'google-generative-ai', reasoning: true } as any;
      const opts = buildReasoningOptionsForModel(
        model,
        intent({ effort: 'medium', budgetTokens: 4096, enabled: true })
      );
      expect(opts.thinking).toEqual({ enabled: true, includeThoughts: true, budgetTokens: 4096 });
    });
  });

  describe('explicit disable', () => {
    it('disables when the model supports off', () => {
      const model = { api: 'anthropic-messages', reasoning: true } as any;
      const opts = buildReasoningOptionsForModel(model, intent({ enabled: false }));
      expect(opts.thinkingEnabled).toBe(false);
    });

    it('cannot-disable model clamps to lowest supported level instead', () => {
      // gpt-5 style: off is null (unsupported), minimal supported
      const model = {
        api: 'openai-responses',
        reasoning: true,
        thinkingLevelMap: { off: null },
      } as any;
      const opts = buildReasoningOptionsForModel(model, intent({ enabled: false }));
      // off is unsupported → clamp to lowest non-off supported level (minimal)
      expect(opts.reasoningEffort).toBe('minimal');
    });
  });

  describe('clamping unsupported levels', () => {
    it('clamps a requested level the model does not support', () => {
      // Gemini 3 pro: only low + high supported (medium null)
      const model = {
        api: 'google-generative-ai',
        reasoning: true,
        thinkingLevelMap: { off: null, minimal: null, low: 'LOW', medium: null, high: 'HIGH' },
      } as any;
      const opts = buildReasoningOptionsForModel(
        model,
        intent({ effort: 'medium', enabled: true })
      );
      // medium unsupported → clamp up to high
      expect(opts.thinking).toEqual({ enabled: true, includeThoughts: true, level: 'HIGH' });
    });
  });
});

const gen = (o: Partial<GenerationIntent>): GenerationIntent => ({
  reasoning: { source: 'client' },
  ...o,
});

describe('buildGenerationOptions', () => {
  describe('maxTokens clamping', () => {
    it('clamps a request above the model ceiling', () => {
      const model = { api: 'openai-completions', reasoning: false, maxTokens: 4096 } as any;
      const opts = buildGenerationOptions(model, gen({ maxTokens: 100000 }));
      expect(opts.maxTokens).toBe(4096);
    });

    it('passes a request below the ceiling untouched', () => {
      const model = { api: 'openai-completions', reasoning: false, maxTokens: 4096 } as any;
      const opts = buildGenerationOptions(model, gen({ maxTokens: 1000 }));
      expect(opts.maxTokens).toBe(1000);
    });

    it('passes the request through when the model has no ceiling', () => {
      const model = { api: 'openai-completions', reasoning: false } as any;
      const opts = buildGenerationOptions(model, gen({ maxTokens: 9999 }));
      expect(opts.maxTokens).toBe(9999);
    });
  });

  describe('temperature guards', () => {
    it('forwards temperature for a normal model', () => {
      const model = { api: 'openai-completions', reasoning: false } as any;
      const opts = buildGenerationOptions(model, gen({ temperature: 0.5 }));
      expect(opts.temperature).toBe(0.5);
    });

    it('drops temperature when thinking is enabled on Anthropic', () => {
      const model = { api: 'anthropic-messages', reasoning: true } as any;
      const opts = buildGenerationOptions(
        model,
        gen({
          temperature: 0.5,
          reasoning: { effort: 'high', enabled: true, source: 'client' },
        })
      );
      expect(opts.thinkingEnabled).toBe(true);
      expect(opts.temperature).toBeUndefined();
    });

    it('drops temperature when the model rejects it (supportsTemperature=false)', () => {
      const model = {
        api: 'anthropic-messages',
        reasoning: false,
        compat: { supportsTemperature: false },
      } as any;
      const opts = buildGenerationOptions(model, gen({ temperature: 0.5 }));
      expect(opts.temperature).toBeUndefined();
    });
  });

  describe('verbosity and serviceTier', () => {
    it('forwards verbosity + serviceTier for OpenAI-family models', () => {
      const model = { api: 'openai-responses', reasoning: false } as any;
      const opts = buildGenerationOptions(model, gen({ verbosity: 'high', serviceTier: 'flex' }));
      expect(opts.textVerbosity).toBe('high');
      expect(opts.serviceTier).toBe('flex');
    });

    it('drops verbosity + serviceTier for non-OpenAI models', () => {
      const model = { api: 'anthropic-messages', reasoning: false } as any;
      const opts = buildGenerationOptions(model, gen({ verbosity: 'high', serviceTier: 'flex' }));
      expect(opts.textVerbosity).toBeUndefined();
      expect(opts.serviceTier).toBeUndefined();
    });
  });
});
