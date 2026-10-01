import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUTO_ROUTING_PREFERENCES,
  DEFAULT_AUTO_ROUTING_SCORING,
  DEFAULT_AUTO_ROUTING_SWITCHING,
} from '@plexus/shared';
import type { AutoRoutingConfig, AutoTaskKind } from '@plexus/shared';
import {
  autoTierForDemand,
  composeAutoDemand,
  estimateAutoCandidateCost,
  rankAutoCandidates,
  resolveAutoPricing,
  validateAutoJudgment,
} from '../auto-policy';
import type {
  AutoJudgment,
  AutoNormalizedRates,
  AutoPolicyCandidate,
  AutoReasoningSuitability,
} from '../auto-policy';

const NOW = 1_000_000;

function policy(overrides: Partial<AutoRoutingConfig> = {}): AutoRoutingConfig {
  return {
    mode: 'active',
    classifier_alias: 'judge',
    classifier_deadline_ms: 500,
    rubric_version: 1,
    baseline_policy: 'in_order',
    uncertainty_minimum_tier: 'high',
    scoring: {
      ...DEFAULT_AUTO_ROUTING_SCORING,
      task_minimum_tiers: {},
    },
    preferences: { ...DEFAULT_AUTO_ROUTING_PREFERENCES },
    switching: { ...DEFAULT_AUTO_ROUTING_SWITCHING },
    ...overrides,
  };
}

function candidate(
  id: string,
  capability: AutoPolicyCandidate['profile']['capability'],
  opts: {
    specialties?: AutoTaskKind[];
    reasoning?: AutoReasoningSuitability;
    pricing?: AutoPolicyCandidate['pricing'];
  } = {}
): AutoPolicyCandidate {
  return {
    id,
    provider: `provider-${id}`,
    model: `model-${id}`,
    profile: {
      capability,
      specialties: opts.specialties ?? [],
      reasoning: opts.reasoning ?? 'normal',
    },
    pricing: opts.pricing,
  };
}

function judgment(overrides: Partial<AutoJudgment> = {}): AutoJudgment {
  return {
    task_kind: 'chat',
    complexity: 1,
    capability_required: 1,
    deep_reasoning: 0,
    ...overrides,
  };
}

const HIGH_JUDGMENT = judgment({ complexity: 2, capability_required: 2 });
const CHEAP: AutoNormalizedRates = { inputPerMillion: 10, outputPerMillion: 30 };
const EXPENSIVE: AutoNormalizedRates = { inputPerMillion: 100, outputPerMillion: 30 };

describe('auto policy: demand and tiers', () => {
  it('composes the weighted demand and clamps to 0..3', () => {
    const scoring = { ...DEFAULT_AUTO_ROUTING_SCORING, task_minimum_tiers: {} };
    expect(
      composeAutoDemand(
        judgment({ complexity: 0, capability_required: 0, deep_reasoning: 0 }),
        scoring
      )
    ).toBe(0);
    expect(
      composeAutoDemand(
        judgment({ complexity: 2, capability_required: 2, deep_reasoning: 0 }),
        scoring
      )
    ).toBeCloseTo(2);
    expect(
      composeAutoDemand(
        judgment({ complexity: 3, capability_required: 3, deep_reasoning: 1 }),
        scoring
      )
    ).toBe(3);
  });

  it('adds the reasoning boost only at or above the threshold', () => {
    const scoring = { ...DEFAULT_AUTO_ROUTING_SCORING, task_minimum_tiers: {} };
    const base = composeAutoDemand(
      judgment({ complexity: 2, capability_required: 1, deep_reasoning: 0.64 }),
      scoring
    );
    const boosted = composeAutoDemand(
      judgment({ complexity: 2, capability_required: 1, deep_reasoning: 0.65 }),
      scoring
    );
    expect(boosted - base).toBeCloseTo(scoring.reasoning_boost);
  });

  it('advances to the higher tier at an exact boundary', () => {
    const boundaries = { standard: 0.75, high: 1.75, premium: 2.5 };
    expect(autoTierForDemand(0.74, boundaries)).toBe('economy');
    expect(autoTierForDemand(0.75, boundaries)).toBe('standard');
    expect(autoTierForDemand(1.75, boundaries)).toBe('high');
    expect(autoTierForDemand(2.5, boundaries)).toBe('premium');
  });

  it('rejects malformed judgments instead of substituting a valid one', () => {
    expect(validateAutoJudgment(undefined)).toBeNull();
    expect(validateAutoJudgment(judgment({ complexity: 4 }))).toBeNull();
    expect(validateAutoJudgment(judgment({ capability_required: -1 }))).toBeNull();
    expect(validateAutoJudgment(judgment({ deep_reasoning: 2 }))).toBeNull();
    expect(validateAutoJudgment(judgment({ confidence: 1.5 }))).toBeNull();
    expect(validateAutoJudgment({ ...judgment(), task_kind: 'bogus' as AutoTaskKind })).toBeNull();
  });
});

describe('auto policy: suitability', () => {
  it('applies per-task minimum tier floors', () => {
    const config = policy({
      scoring: {
        ...DEFAULT_AUTO_ROUTING_SCORING,
        task_minimum_tiers: { plan: 'high' },
      },
    });
    const result = rankAutoCandidates(
      [candidate('economy', 'economy'), candidate('high', 'high')],
      config,
      {
        judgment: judgment({ task_kind: 'plan', complexity: 0, capability_required: 0 }),
        inputTokens: 1000,
        expectedOutputTokens: 100,
      }
    );
    expect(result.requiredTier).toBe(2);
    expect(result.orderedIds).toEqual(['high']);
    expect(result.rankings.find((r) => r.id === 'economy')?.exclusion).toBe(
      'capability_below_required'
    );
  });

  it('replaces default task floors when an empty map is supplied', () => {
    const result = rankAutoCandidates(
      [candidate('economy', 'economy'), candidate('high', 'high')],
      policy({
        scoring: { ...DEFAULT_AUTO_ROUTING_SCORING, task_minimum_tiers: {} },
      }),
      {
        judgment: judgment({ task_kind: 'plan', complexity: 0, capability_required: 0 }),
        inputTokens: 1000,
        expectedOutputTokens: 100,
      }
    );
    // The default plan:high floor is replaced, not merged.
    expect(result.requiredTier).toBe(0);
    expect(result.orderedIds).toContain('economy');
  });

  it('excludes targets below the required tier in the confident path', () => {
    const result = rankAutoCandidates(
      [candidate('high', 'high'), candidate('standard', 'standard')],
      policy(),
      {
        judgment: judgment({ complexity: 2, capability_required: 2 }),
        inputTokens: 1000,
        expectedOutputTokens: 100,
      }
    );
    expect(result.orderedIds).toEqual(['high']);
  });

  it('selects the first eligible option when nothing is suitable', () => {
    const result = rankAutoCandidates(
      [candidate('economy', 'economy'), candidate('standard', 'standard')],
      policy(),
      {
        judgment: judgment({ complexity: 3, capability_required: 3 }),
        inputTokens: 1000,
        expectedOutputTokens: 100,
      }
    );
    expect(result.decision.reason).toBe('no_suitable_target_first_option');
    expect(result.decision.fallback).toBe(true);
    expect(result.orderedIds).toEqual(['economy', 'standard']);
  });
});

describe('auto policy: cost evidence', () => {
  it('keeps input categories disjoint and prices a warm read', () => {
    const estimate = estimateAutoCandidateCost(
      candidate('a', 'high', {
        pricing: {
          inputPerMillion: 10,
          outputPerMillion: 30,
          cacheReadPerMillion: 1,
          cacheWritePerMillion: 5,
        },
      }),
      {
        inputTokens: 1000,
        expectedOutputTokens: 100,
        prefixFingerprint: 'p',
        now: NOW,
        observations: {
          a: {
            cachedInputTokens: 800,
            cacheWriteTokens: 0,
            prefixFingerprint: 'p',
            expiresAt: NOW + 1000,
          },
        },
      }
    );
    expect(estimate.warmth).toBe('warm');
    expect(estimate.uncachedInputTokens).toBe(200);
    expect(estimate.cacheReadInputTokens).toBe(800);
    // 200*10 + 800*1 + 100*30 = 5800 per 1e6 tokens.
    expect(estimate.expectedUsd).toBeCloseTo(0.0058, 10);
    expect(estimate.known).toBe(true);
  });

  it('treats prior cache writes as reads rather than repeated writes', () => {
    const estimate = estimateAutoCandidateCost(
      candidate('a', 'high', {
        pricing: {
          inputPerMillion: 10,
          outputPerMillion: 30,
          cacheReadPerMillion: 1,
          cacheWritePerMillion: 5,
        },
      }),
      {
        inputTokens: 1000,
        expectedOutputTokens: 100,
        prefixFingerprint: 'p',
        now: NOW,
        observations: {
          a: {
            cachedInputTokens: 500,
            cacheWriteTokens: 300,
            prefixFingerprint: 'p',
            expiresAt: NOW + 1000,
          },
        },
      }
    );
    expect(estimate.warmth).toBe('warm');
    expect(estimate.cacheReadInputTokens).toBe(800);
    expect(estimate.cacheWriteInputTokens).toBe(0);
    expect(estimate.uncachedInputTokens).toBe(200);
    // 200*10 + 800*1 + 100*30 = 5800 per 1e6 tokens.
    expect(estimate.expectedUsd).toBeCloseTo(0.0058, 10);
  });

  it('caps warm reads at the input size', () => {
    const estimate = estimateAutoCandidateCost(candidate('a', 'high', { pricing: CHEAP }), {
      inputTokens: 1000,
      expectedOutputTokens: 0,
      prefixFingerprint: 'p',
      now: NOW,
      observations: {
        a: {
          cachedInputTokens: 800,
          cacheWriteTokens: 400,
          prefixFingerprint: 'p',
          expiresAt: NOW + 1000,
        },
      },
    });
    expect(estimate.cacheReadInputTokens).toBe(1000);
    expect(estimate.cacheWriteInputTokens).toBe(0);
    expect(estimate.uncachedInputTokens).toBe(0);
  });

  it('bounds cost with an explicit output token range', () => {
    const estimate = estimateAutoCandidateCost(candidate('a', 'high', { pricing: CHEAP }), {
      inputTokens: 1000,
      outputTokenRange: { lower: 100, upper: 300 },
    });
    // No point estimate: cost is not "known", but the bounds are reported.
    expect(estimate.known).toBe(false);
    expect(estimate.expectedUsd).toBeNull();
    expect(estimate.lowerUsd).toBeCloseTo(0.013, 10);
    expect(estimate.upperUsd).toBeCloseTo(0.019, 10);
  });

  it('keeps the point estimate between the output range bounds', () => {
    const estimate = estimateAutoCandidateCost(candidate('a', 'high', { pricing: CHEAP }), {
      inputTokens: 1000,
      expectedOutputTokens: 200,
      outputTokenRange: { lower: 100, upper: 300 },
    });
    expect(estimate.known).toBe(true);
    expect(estimate.lowerUsd).toBeCloseTo(0.013, 10);
    expect(estimate.expectedUsd).toBeCloseTo(0.016, 10);
    expect(estimate.upperUsd).toBeCloseTo(0.019, 10);
  });

  it('includes the request fee in the lower bound', () => {
    const estimate = estimateAutoCandidateCost(
      candidate('a', 'high', { pricing: { source: 'per_request', amount: 0.05 } }),
      { inputTokens: 1000, expectedOutputTokens: 100 }
    );
    expect(estimate.known).toBe(true);
    expect(estimate.lowerUsd).toBeCloseTo(0.05, 10);
    expect(estimate.expectedUsd).toBeCloseTo(0.05, 10);
    expect(estimate.upperUsd).toBeCloseTo(0.05, 10);
  });

  it('treats an unknown cache rate as a range, never as free', () => {
    const estimate = estimateAutoCandidateCost(
      candidate('a', 'high', { pricing: { inputPerMillion: 10, outputPerMillion: 30 } }),
      {
        inputTokens: 1000,
        expectedOutputTokens: 100,
        prefixFingerprint: 'p',
        now: NOW,
        observations: {
          a: {
            cachedInputTokens: 800,
            cacheWriteTokens: 0,
            prefixFingerprint: 'p',
            expiresAt: NOW + 1000,
          },
        },
      }
    );
    expect(estimate.known).toBe(false);
    // Unknown cache-read is bounded by the full input rate (upper) and 0 (lower).
    expect(estimate.lowerUsd).toBeCloseTo(0.005, 10);
    expect(estimate.upperUsd).toBeCloseTo(0.013, 10);
    expect(estimate.expectedUsd).toBeCloseTo(0.013, 10);
  });

  it('marks cost unknown when output tokens cannot be estimated', () => {
    const estimate = estimateAutoCandidateCost(candidate('a', 'high', { pricing: CHEAP }), {
      inputTokens: 1000,
    });
    expect(estimate.known).toBe(false);
    expect(estimate.expectedUsd).toBeNull();
  });

  it('does not credit warmth when the prefix fingerprint changed', () => {
    const estimate = estimateAutoCandidateCost(candidate('a', 'high', { pricing: CHEAP }), {
      inputTokens: 1000,
      expectedOutputTokens: 100,
      prefixFingerprint: 'new',
      now: NOW,
      observations: {
        a: {
          cachedInputTokens: 800,
          cacheWriteTokens: 0,
          prefixFingerprint: 'old',
          expiresAt: NOW + 1000,
        },
      },
    });
    expect(estimate.warmth).toBe('cold');
    expect(estimate.cacheReadInputTokens).toBe(0);
  });

  it('treats an unresolved OpenRouter slug as unknown, not zero', () => {
    const result = rankAutoCandidates(
      [
        candidate('openrouter', 'high', { pricing: { source: 'openrouter', slug: 'x' } }),
        candidate('known', 'high', { pricing: CHEAP }),
      ],
      policy(),
      {
        judgment: HIGH_JUDGMENT,
        inputTokens: 1000,
        expectedOutputTokens: 100,
      }
    );
    expect(result.costEvidence.openrouter?.known).toBe(false);
    expect(result.costEvidence.openrouter?.expectedUsd).toBeNull();
    // Unknown price falls back to declaration order rather than assuming free.
    expect(result.orderedIds[0]).toBe('openrouter');
  });

  it('resolves defined context ranges and applies discounts', () => {
    const ranged = resolveAutoPricing(
      {
        source: 'defined',
        range: [
          { lower_bound: 0, upper_bound: 1000, input_per_m: 1, output_per_m: 2 },
          { lower_bound: 1001, upper_bound: null, input_per_m: 3, output_per_m: 4 },
        ],
      },
      1500
    );
    expect(ranged.rates?.inputPerMillion).toBe(3);
    expect(ranged.rates?.outputPerMillion).toBe(4);

    const discounted = resolveAutoPricing(
      { source: 'simple', input: 10, output: 20, discount: 0.2 },
      1000
    );
    expect(discounted.rates?.inputPerMillion).toBe(8);
    expect(discounted.rates?.outputPerMillion).toBe(16);
  });

  it('applies the provider discount when pricing omits its own', () => {
    const resolved = resolveAutoPricing({ source: 'simple', input: 10, output: 20 }, 1000, 0.25);
    expect(resolved.rates?.inputPerMillion).toBeCloseTo(7.5, 10);
    expect(resolved.rates?.outputPerMillion).toBeCloseTo(15, 10);
  });

  it('lets a per-pricing discount override the provider discount', () => {
    const resolved = resolveAutoPricing(
      { source: 'simple', input: 10, output: 20, discount: 0.5 },
      1000,
      0.25
    );
    expect(resolved.rates?.inputPerMillion).toBe(5);
    expect(resolved.rates?.outputPerMillion).toBe(10);
  });

  it('applies discounts to defined ranges with the 1 - discount convention', () => {
    const resolved = resolveAutoPricing(
      {
        source: 'defined',
        range: [{ lower_bound: 0, upper_bound: null, input_per_m: 10, output_per_m: 20 }],
        discount: 0.2,
      },
      1000
    );
    expect(resolved.rates?.inputPerMillion).toBeCloseTo(8, 10);
    expect(resolved.rates?.outputPerMillion).toBeCloseTo(16, 10);
  });

  it('uses the candidate provider discount when estimating cost', () => {
    const estimate = estimateAutoCandidateCost(
      {
        ...candidate('a', 'high', { pricing: { source: 'simple', input: 10, output: 20 } }),
        providerDiscount: 0.5,
      },
      { inputTokens: 1000, expectedOutputTokens: 100 }
    );
    // 1000*5 + 100*10 = 6000 per 1e6 tokens.
    expect(estimate.expectedUsd).toBeCloseTo(0.006, 10);
  });

  it('matches defined context ranges against normalized uncached input', () => {
    const estimate = estimateAutoCandidateCost(
      candidate('a', 'high', {
        pricing: {
          source: 'defined',
          range: [
            {
              lower_bound: 0,
              upper_bound: 500,
              input_per_m: 1,
              output_per_m: 1,
              cached_per_m: 0,
            },
            {
              lower_bound: 501,
              upper_bound: null,
              input_per_m: 100,
              output_per_m: 100,
              cached_per_m: 0,
            },
          ],
        },
      }),
      {
        inputTokens: 1000,
        expectedOutputTokens: 100,
        prefixFingerprint: 'p',
        now: NOW,
        observations: {
          a: {
            cachedInputTokens: 600,
            cacheWriteTokens: 0,
            prefixFingerprint: 'p',
            expiresAt: NOW + 1000,
          },
        },
      }
    );
    expect(estimate.uncachedInputTokens).toBe(400);
    expect(estimate.pricingSource).toBe('defined');
    // Matches the 0-500 band (uncached 400), not the 501+ band (total 1000).
    expect(estimate.expectedUsd).toBeCloseTo(0.0005, 10);
  });
});

describe('auto policy: selection', () => {
  it('picks the cheapest reliably known target on a cold start', () => {
    const result = rankAutoCandidates(
      [
        candidate('expensive', 'high', { pricing: EXPENSIVE }),
        candidate('cheap', 'high', { pricing: CHEAP }),
      ],
      policy(),
      { judgment: HIGH_JUDGMENT, inputTokens: 1000, expectedOutputTokens: 100 }
    );
    expect(result.decision.reason).toBe('cold_start');
    expect(result.decision.chosenId).toBe('cheap');
    expect(result.orderedIds).toEqual(['cheap', 'expensive']);
  });

  it('falls back to declaration order when a comparable price is missing', () => {
    const result = rankAutoCandidates(
      [candidate('unknown', 'high'), candidate('known', 'high', { pricing: CHEAP })],
      policy(),
      { judgment: HIGH_JUDGMENT, inputTokens: 1000, expectedOutputTokens: 100 }
    );
    expect(result.decision.chosenId).toBe('unknown');
  });

  it('switches on a clear cache-economic win', () => {
    const result = rankAutoCandidates(
      [
        candidate('expensive', 'high', { pricing: EXPENSIVE }),
        candidate('cheap', 'high', { pricing: CHEAP }),
      ],
      policy(),
      {
        judgment: HIGH_JUDGMENT,
        inputTokens: 1000,
        expectedOutputTokens: 100,
        incumbentId: 'expensive',
        prefixFingerprint: 'p',
        now: NOW,
        observations: {
          expensive: {
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            prefixFingerprint: 'p',
            expiresAt: NOW + 1000,
          },
        },
      }
    );
    expect(result.decision.reason).toBe('economic_switch');
    expect(result.orderedIds[0]).toBe('cheap');
  });

  it('holds the incumbent when savings are below the configured margins', () => {
    const almost = { inputPerMillion: 99, outputPerMillion: 30 };
    const result = rankAutoCandidates(
      [
        candidate('expensive', 'high', { pricing: EXPENSIVE }),
        candidate('almost', 'high', { pricing: almost }),
      ],
      policy(),
      {
        judgment: HIGH_JUDGMENT,
        inputTokens: 1000,
        expectedOutputTokens: 100,
        incumbentId: 'expensive',
        prefixFingerprint: 'p',
        now: NOW,
        observations: {
          expensive: {
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            prefixFingerprint: 'p',
            expiresAt: NOW + 1000,
          },
        },
      }
    );
    expect(result.decision.reason).toBe('cache_hold');
    expect(result.orderedIds[0]).toBe('expensive');
  });

  it('does not switch on unknown candidate price', () => {
    const result = rankAutoCandidates(
      [
        candidate('expensive', 'high', { pricing: EXPENSIVE }),
        candidate('unknown', 'high', { pricing: { source: 'openrouter', slug: 'x' } }),
      ],
      policy(),
      {
        judgment: HIGH_JUDGMENT,
        inputTokens: 1000,
        expectedOutputTokens: 100,
        incumbentId: 'expensive',
        prefixFingerprint: 'p',
        now: NOW,
        observations: {
          expensive: {
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            prefixFingerprint: 'p',
            expiresAt: NOW + 1000,
          },
        },
      }
    );
    expect(result.decision.reason).toBe('cache_hold');
  });

  it('upgrades an unsuitable incumbent regardless of price', () => {
    const result = rankAutoCandidates(
      [
        candidate('economy', 'economy', { pricing: CHEAP }),
        candidate('high', 'high', { pricing: EXPENSIVE }),
      ],
      policy(),
      {
        judgment: HIGH_JUDGMENT,
        inputTokens: 1000,
        expectedOutputTokens: 100,
        incumbentId: 'economy',
      }
    );
    expect(result.decision.reason).toBe('quality_upgrade');
    expect(result.orderedIds[0]).toBe('high');
  });

  it('derives the comparable band from suitable targets only', () => {
    const result = rankAutoCandidates(
      [
        candidate('economy', 'economy', { pricing: CHEAP }),
        candidate('general', 'premium', { pricing: EXPENSIVE }),
        candidate('specialist', 'premium', { specialties: ['chat'], pricing: EXPENSIVE }),
      ],
      policy(),
      {
        judgment: judgment({ task_kind: 'chat', complexity: 2, capability_required: 2 }),
        inputTokens: 1000,
        expectedOutputTokens: 100,
      }
    );
    const comparable = result.rankings.filter((r) => r.comparable).map((r) => r.id);
    // The unsuitable economy target clamps to preference 1 and must not widen
    // the band; the best suitable preference defines it.
    expect(comparable).toEqual(['specialist']);
    expect(result.rankings.find((r) => r.id === 'economy')?.comparable).toBe(false);
    expect(result.decision.chosenId).toBe('specialist');
    expect(result.orderedIds[0]).toBe('specialist');
  });

  it('reports incumbent_unavailable when the incumbent was filtered out', () => {
    const result = rankAutoCandidates(
      [
        candidate('high', 'high', { pricing: CHEAP }),
        candidate('standard', 'standard', { pricing: CHEAP }),
      ],
      policy(),
      {
        judgment: HIGH_JUDGMENT,
        inputTokens: 1000,
        expectedOutputTokens: 100,
        incumbentId: 'removed',
      }
    );
    expect(result.decision.reason).toBe('incumbent_unavailable');
    expect(result.decision.chosenId).toBe('high');
  });

  it('does not apply an economic override when output size is unknown', () => {
    const result = rankAutoCandidates(
      [
        candidate('expensive', 'high', { pricing: EXPENSIVE }),
        candidate('cheap', 'high', { pricing: CHEAP }),
      ],
      policy(),
      {
        judgment: HIGH_JUDGMENT,
        inputTokens: 1000,
        incumbentId: 'expensive',
        prefixFingerprint: 'p',
        now: NOW,
        observations: {
          expensive: {
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            prefixFingerprint: 'p',
            expiresAt: NOW + 1000,
          },
        },
      }
    );
    expect(result.decision.reason).toBe('cache_hold');
  });

  it('switches to a specialty match within the comparable band', () => {
    const result = rankAutoCandidates(
      [
        candidate('general', 'premium', { pricing: EXPENSIVE }),
        candidate('specialist', 'premium', { specialties: ['chat'], pricing: CHEAP }),
      ],
      policy(),
      {
        judgment: judgment({ task_kind: 'chat', complexity: 2, capability_required: 2 }),
        inputTokens: 1000,
        expectedOutputTokens: 100,
      }
    );
    expect(result.orderedIds[0]).toBe('specialist');
  });

  it('prefers a better-fitting target without requiring savings', () => {
    const result = rankAutoCandidates(
      [candidate('premium', 'premium'), candidate('high', 'high')],
      policy(),
      {
        judgment: HIGH_JUDGMENT,
        inputTokens: 1000,
        expectedOutputTokens: 100,
        incumbentId: 'premium',
        previousRequiredTier: 'high',
        previousDemand: 2,
      }
    );
    expect(result.decision.reason).toBe('preference_switch');
    expect(result.orderedIds[0]).toBe('high');
  });

  it('chooses a same-tier debug specialist over a cheaper generalist', () => {
    const result = rankAutoCandidates(
      [
        candidate('general', 'high', { pricing: CHEAP }),
        candidate('specialist', 'high', { specialties: ['debug'], pricing: EXPENSIVE }),
      ],
      policy(),
      {
        judgment: judgment({ task_kind: 'debug', complexity: 2, capability_required: 2 }),
        inputTokens: 1000,
        expectedOutputTokens: 100,
      }
    );
    expect(result.decision.chosenId).toBe('specialist');
    expect(result.orderedIds[0]).toBe('specialist');
  });

  it('keeps the same-tier specialty gain above the default preference margin', () => {
    const result = rankAutoCandidates(
      [candidate('general', 'high'), candidate('specialist', 'high', { specialties: ['debug'] })],
      policy(),
      {
        judgment: judgment({ task_kind: 'debug', complexity: 2, capability_required: 2 }),
        inputTokens: 1000,
        expectedOutputTokens: 100,
      }
    );
    const general = result.rankings.find((r) => r.id === 'general')!;
    const specialist = result.rankings.find((r) => r.id === 'specialist')!;
    // Normalized bonus keeps the generalist below 1 so the difference survives.
    expect(general.preference).toBeCloseTo(1 / 1.2, 6);
    expect(specialist.preference).toBeCloseTo(1.1 / 1.2, 6);
    expect((specialist.preference ?? 0) - (general.preference ?? 0)).toBeGreaterThan(
      DEFAULT_AUTO_ROUTING_SWITCHING.preference_margin
    );
  });

  it('switches to a reasoning-preferred target within the default margin', () => {
    const result = rankAutoCandidates(
      [
        candidate('general', 'high', { pricing: CHEAP }),
        candidate('reasoner', 'high', { reasoning: 'preferred', pricing: EXPENSIVE }),
      ],
      policy(),
      {
        judgment: judgment({
          task_kind: 'chat',
          complexity: 2,
          capability_required: 1,
          deep_reasoning: 0.8,
        }),
        inputTokens: 1000,
        expectedOutputTokens: 100,
        incumbentId: 'general',
        prefixFingerprint: 'p',
        now: NOW,
        observations: {
          general: {
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            prefixFingerprint: 'p',
            expiresAt: NOW + 1000,
          },
        },
      }
    );
    expect(result.decision.reason).toBe('preference_switch');
    expect(result.decision.chosenId).toBe('reasoner');
  });

  it('switches to a same-tier debug specialist with specialist_switch', () => {
    const result = rankAutoCandidates(
      [
        candidate('general', 'high', { pricing: CHEAP }),
        candidate('specialist', 'high', { specialties: ['debug'], pricing: EXPENSIVE }),
      ],
      policy(),
      {
        judgment: judgment({ task_kind: 'debug', complexity: 2, capability_required: 2 }),
        inputTokens: 1000,
        expectedOutputTokens: 100,
        incumbentId: 'general',
        prefixFingerprint: 'p',
        now: NOW,
        observations: {
          general: {
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            prefixFingerprint: 'p',
            expiresAt: NOW + 1000,
          },
        },
      }
    );
    expect(result.decision.reason).toBe('specialist_switch');
    expect(result.decision.chosenId).toBe('specialist');
  });

  it('never chooses a cheaper band target that fails the incumbent margin', () => {
    const result = rankAutoCandidates(
      [
        candidate('best', 'high', {
          specialties: ['debug'],
          reasoning: 'preferred',
          pricing: EXPENSIVE,
        }),
        candidate('marginal', 'high', { specialties: ['debug'], pricing: CHEAP }),
        candidate('incumbent', 'high', { pricing: CHEAP }),
      ],
      policy({
        switching: { ...DEFAULT_AUTO_ROUTING_SWITCHING, preference_margin: 0.1 },
      }),
      {
        judgment: judgment({
          task_kind: 'debug',
          complexity: 2,
          capability_required: 1,
          deep_reasoning: 0.8,
        }),
        inputTokens: 1000,
        expectedOutputTokens: 100,
        incumbentId: 'incumbent',
        prefixFingerprint: 'p',
        now: NOW,
        observations: {
          incumbent: {
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            prefixFingerprint: 'p',
            expiresAt: NOW + 1000,
          },
        },
      }
    );
    expect(result.decision.chosenId).toBe('best');
    expect(result.orderedIds[0]).toBe('best');
    expect(result.orderedIds[0]).not.toBe('marginal');
  });
});

describe('auto policy: continuation and uncertainty', () => {
  it('keeps the locked incumbent first even when cheaper options exist', () => {
    const result = rankAutoCandidates(
      [
        candidate('cheap', 'high', { pricing: CHEAP }),
        candidate('locked', 'high', { pricing: EXPENSIVE }),
      ],
      policy(),
      {
        judgment: HIGH_JUDGMENT,
        inputTokens: 1000,
        expectedOutputTokens: 100,
        incumbentId: 'locked',
        continuationLocked: true,
      }
    );
    expect(result.decision.reason).toBe('continuation_locked');
    expect(result.orderedIds).toEqual(['locked']);
  });

  it('conservatively orders the first eligible target when a lock has no known incumbent', () => {
    const result = rankAutoCandidates(
      [candidate('first', 'high'), candidate('second', 'high')],
      policy(),
      {
        judgment: HIGH_JUDGMENT,
        inputTokens: 1000,
        expectedOutputTokens: 100,
        continuationLocked: true,
      }
    );
    expect(result.decision.reason).toBe('continuation_locked');
    expect(result.decision.continuationTargetUnavailable).toBe(false);
    expect(result.decision.fallback).toBe(true);
    expect(result.orderedIds).toEqual(['first']);
  });

  it('reports a continuation target that is no longer eligible', () => {
    const result = rankAutoCandidates([candidate('other', 'high')], policy(), {
      judgment: HIGH_JUDGMENT,
      inputTokens: 1000,
      expectedOutputTokens: 100,
      incumbentId: 'missing',
      continuationLocked: true,
    });
    expect(result.decision.reason).toBe('continuation_target_unavailable');
    expect(result.decision.continuationTargetUnavailable).toBe(true);
    expect(result.orderedIds).toEqual([]);
  });

  it('uses the uncertainty floor and baseline order when no judgment exists', () => {
    const result = rankAutoCandidates(
      [
        candidate('standard', 'standard'),
        candidate('high', 'high'),
        candidate('premium', 'premium'),
      ],
      policy(),
      { inputTokens: 1000, expectedOutputTokens: 100 }
    );
    expect(result.decision.reason).toBe('uncertain_baseline');
    expect(result.decision.uncertainty).toBe(true);
    expect(result.orderedIds).toEqual(['high', 'premium']);
  });

  it('retains a qualifying incumbent under uncertainty', () => {
    const result = rankAutoCandidates(
      [candidate('high', 'high'), candidate('premium', 'premium')],
      policy(),
      {
        inputTokens: 1000,
        expectedOutputTokens: 100,
        incumbentId: 'premium',
      }
    );
    expect(result.decision.reason).toBe('uncertain_incumbent_hold');
    expect(result.orderedIds).toEqual(['premium', 'high']);
  });

  it('treats low confidence and unknown task kinds as uncertainty', () => {
    const lowConfidence = rankAutoCandidates([candidate('high', 'high')], policy(), {
      judgment: judgment({ confidence: 0.5 }),
      inputTokens: 1000,
      expectedOutputTokens: 100,
    });
    expect(lowConfidence.decision.uncertainty).toBe(true);

    const unknownTask = rankAutoCandidates([candidate('high', 'high')], policy(), {
      judgment: judgment({ task_kind: 'unknown' }),
      inputTokens: 1000,
      expectedOutputTokens: 100,
    });
    expect(unknownTask.decision.uncertainty).toBe(true);
  });

  it('requires the uncertainty floor when uncertainty leaves no qualifying target', () => {
    const result = rankAutoCandidates([candidate('economy', 'economy')], policy(), {
      inputTokens: 1000,
      expectedOutputTokens: 100,
    });
    expect(result.decision.reason).toBe('no_suitable_target_first_option');
    expect(result.orderedIds).toEqual(['economy']);
  });
});

describe('auto policy: downgrade hysteresis', () => {
  it('holds the previous required tier until the deadband is cleared', () => {
    const result = rankAutoCandidates(
      [candidate('standard', 'standard'), candidate('high', 'high')],
      policy(),
      {
        judgment: judgment({ complexity: 1.6, capability_required: 1.6 }),
        inputTokens: 1000,
        expectedOutputTokens: 100,
        incumbentId: 'high',
        previousRequiredTier: 'high',
        previousDemand: 2,
      }
    );
    expect(result.requiredTier).toBe(2);
    expect(result.decision.scoreDeadbandCleared).toBe(false);
    expect(result.decision.downgrade).toBe(false);
    expect(result.orderedIds).toEqual(['high']);
  });

  it('does not hold the previous tier when the incumbent is no longer eligible', () => {
    const result = rankAutoCandidates(
      [candidate('standard', 'standard'), candidate('high', 'high')],
      policy(),
      {
        judgment: judgment({ complexity: 1.6, capability_required: 1.6 }),
        inputTokens: 1000,
        expectedOutputTokens: 100,
        incumbentId: 'removed',
        previousRequiredTier: 'high',
        previousDemand: 2,
      }
    );
    // Fresh demand lands in the standard tier; a departed incumbent must not
    // keep the previous high tier alive.
    expect(result.requiredTier).toBe(1);
    expect(result.decision.scoreDeadbandCleared).toBe(true);
  });

  it('clears the deadband and downgrades when demand drops below the margin', () => {
    const result = rankAutoCandidates(
      [candidate('standard', 'standard'), candidate('high', 'high')],
      policy(),
      {
        judgment: judgment({ complexity: 1, capability_required: 1 }),
        inputTokens: 1000,
        expectedOutputTokens: 100,
        incumbentId: 'high',
        previousRequiredTier: 'high',
        previousDemand: 2,
      }
    );
    expect(result.requiredTier).toBe(1);
    expect(result.decision.scoreDeadbandCleared).toBe(true);
    expect(result.decision.downgrade).toBe(true);
  });
});
