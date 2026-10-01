import { describe, expect, it } from 'vitest';
import {
  AUTO_CAPABILITY_TIERS,
  AUTO_TASK_KINDS,
  AutoRoutingConfigSchema,
  AutoTargetProfileSchema,
  DEFAULT_AUTO_ROUTING_CONFIG,
} from '@plexus/shared';
import { assertAutoRoutingConfigValid, ModelConfigSchema } from '../config';

const validScoring = {
  complexity_weight: 0.55,
  capability_weight: 0.45,
  reasoning_threshold: 0.65,
  reasoning_boost: 0.5,
  confidence_threshold: 0.6,
  tier_boundaries: { standard: 0.75, high: 1.75, premium: 2.5 },
  task_minimum_tiers: { plan: 'high', review: 'high' },
};

describe('shared auto routing contract', () => {
  it.each(['embeddings', 'image', 'speech', 'transcriptions', 'decisions'])(
    'rejects auto routing on %s aliases',
    (type) => {
      expect(
        ModelConfigSchema.safeParse({
          type,
          auto_routing: { mode: 'off' },
          target_groups: [{ name: 'main', selector: 'auto', targets: [] }],
        }).success
      ).toBe(false);
    }
  );
  it('exports the agreed task and capability vocabularies', () => {
    expect(AUTO_TASK_KINDS).toEqual([
      'plan',
      'implement',
      'debug',
      'refactor',
      'review',
      'research',
      'explain',
      'operate',
      'write',
      'chat',
    ]);
    expect(AUTO_CAPABILITY_TIERS).toEqual(['economy', 'standard', 'high', 'premium']);
  });

  it('defaults to off with an empty classifier and baseline in_order', () => {
    expect(DEFAULT_AUTO_ROUTING_CONFIG).toMatchObject({
      mode: 'off',
      classifier_alias: '',
      classifier_deadline_ms: 500,
      rubric_version: 1,
      baseline_policy: 'in_order',
      uncertainty_minimum_tier: 'high',
    });
    expect(DEFAULT_AUTO_ROUTING_CONFIG.scoring.complexity_weight).toBe(0.55);
    expect(DEFAULT_AUTO_ROUTING_CONFIG.scoring.capability_weight).toBe(0.45);
    expect(DEFAULT_AUTO_ROUTING_CONFIG.scoring.tier_boundaries).toEqual({
      standard: 0.75,
      high: 1.75,
      premium: 2.5,
    });
    expect(DEFAULT_AUTO_ROUTING_CONFIG.preferences).toEqual({
      specialty_bonus: 0.1,
      reasoning_bonus: 0.1,
    });
    expect(DEFAULT_AUTO_ROUTING_CONFIG.switching).toEqual({
      score_deadband: 0.2,
      minimum_savings_usd: 0.01,
      minimum_savings_fraction: 0.1,
      preference_margin: 0.05,
    });
  });

  it('applies nested scoring defaults when parsing a partial policy', () => {
    const parsed = AutoRoutingConfigSchema.parse({ mode: 'off' });
    expect(parsed.scoring.task_minimum_tiers).toEqual({ plan: 'high', review: 'high' });
    expect(parsed.preferences.specialty_bonus).toBe(0.1);
    expect(parsed.switching.preference_margin).toBe(0.05);
  });

  it('accepts an explicit uncertainty_minimum_tier and rejects unknown tiers', () => {
    expect(
      AutoRoutingConfigSchema.safeParse({ uncertainty_minimum_tier: 'standard' }).success
    ).toBe(true);
    expect(
      AutoRoutingConfigSchema.safeParse({ uncertainty_minimum_tier: 'impossible' }).success
    ).toBe(false);
  });

  it('returns fresh default objects so parsed configs do not share references', () => {
    const first = AutoRoutingConfigSchema.parse({});
    const second = AutoRoutingConfigSchema.parse({});
    expect(first.scoring).not.toBe(second.scoring);
    expect(first.scoring.tier_boundaries).not.toBe(second.scoring.tier_boundaries);
    expect(first.switching).not.toBe(second.switching);
  });

  it('rejects weights that do not sum to one', () => {
    const result = AutoRoutingConfigSchema.safeParse({
      scoring: { ...validScoring, complexity_weight: 0.7, capability_weight: 0.7 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects unordered tier boundaries', () => {
    const result = AutoRoutingConfigSchema.safeParse({
      scoring: {
        ...validScoring,
        tier_boundaries: { standard: 1.5, high: 0.5, premium: 2.5 },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown task minimum tier keys', () => {
    const result = AutoRoutingConfigSchema.safeParse({
      scoring: { ...validScoring, task_minimum_tiers: { not_a_task: 'high' } },
    });
    expect(result.success).toBe(false);
  });

  it('accepts the full example policy from the plan', () => {
    const result = AutoRoutingConfigSchema.safeParse({
      mode: 'active',
      classifier_alias: 'routing-judge',
      classifier_deadline_ms: 500,
      rubric_version: 1,
      baseline_policy: 'cost',
      uncertainty_minimum_tier: 'high',
      scoring: validScoring,
      preferences: { specialty_bonus: 0.1, reasoning_bonus: 0.1 },
      switching: {
        score_deadband: 0.2,
        minimum_savings_usd: 0.01,
        minimum_savings_fraction: 0.1,
        preference_margin: 0.05,
      },
    });
    expect(result.success).toBe(true);
  });
});

describe('AutoTargetProfileSchema', () => {
  it('accepts a complete profile and defaults specialties to empty', () => {
    const parsed = AutoTargetProfileSchema.parse({ capability: 'high', reasoning: 'preferred' });
    expect(parsed).toEqual({ capability: 'high', specialties: [], reasoning: 'preferred' });
  });

  it('allows incomplete profiles so off-mode drafts can be saved', () => {
    expect(AutoTargetProfileSchema.safeParse({}).success).toBe(true);
    expect(AutoTargetProfileSchema.safeParse({ specialties: ['plan'] }).success).toBe(true);
  });

  it('rejects unknown specialties', () => {
    const result = AutoTargetProfileSchema.safeParse({ specialties: ['teleport'] });
    expect(result.success).toBe(false);
  });
});

describe('ModelConfigSchema auto routing validation', () => {
  const completeTarget = {
    provider: 'provider-a',
    model: 'fast-model',
    auto_profile: { capability: 'standard', specialties: ['chat'], reasoning: 'normal' },
  };

  it('saves off-mode drafts with incomplete auto target profiles', () => {
    const result = ModelConfigSchema.safeParse({
      target_groups: [
        {
          name: 'Main',
          selector: 'auto',
          targets: [{ provider: 'provider-a', model: 'fast-model' }],
        },
      ],
      auto_routing: { mode: 'off' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects active mode without a classifier alias', () => {
    const result = ModelConfigSchema.safeParse({
      target_groups: [{ name: 'Main', selector: 'auto', targets: [completeTarget] }],
      auto_routing: { mode: 'active' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects active mode when an enabled auto target lacks capability', () => {
    const result = ModelConfigSchema.safeParse({
      target_groups: [
        {
          name: 'Main',
          selector: 'auto',
          targets: [
            { provider: 'provider-a', model: 'fast-model', auto_profile: { specialties: [] } },
          ],
        },
      ],
      auto_routing: { mode: 'active', classifier_alias: 'routing-judge' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts a complete active auto alias', () => {
    const result = ModelConfigSchema.safeParse({
      target_groups: [{ name: 'Main', selector: 'auto', targets: [completeTarget] }],
      auto_routing: { mode: 'active', classifier_alias: 'routing-judge' },
    });
    expect(result.success).toBe(true);
  });

  it('keeps ordinary selectors working without any auto fields', () => {
    const result = ModelConfigSchema.safeParse({
      target_groups: [
        { name: 'default', selector: 'in_order', targets: [{ provider: 'p', model: 'm' }] },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe('assertAutoRoutingConfigValid', () => {
  const autoGroup = [
    {
      name: 'Main',
      selector: 'auto' as const,
      targets: [
        {
          provider: 'provider-a',
          model: 'fast-model',
          auto_profile: {
            capability: 'standard' as const,
            specialties: [],
            reasoning: 'normal' as const,
          },
        },
      ],
    },
  ];

  it('accepts an active auto alias whose classifier is a Decisions alias', () => {
    expect(() =>
      assertAutoRoutingConfigValid({
        judge: { type: 'decisions', target_groups: [] } as never,
        magic: {
          target_groups: autoGroup,
          auto_routing: { mode: 'active', classifier_alias: 'judge' },
        } as never,
      })
    ).not.toThrow();
  });

  it('rejects a missing classifier alias', () => {
    expect(() =>
      assertAutoRoutingConfigValid({
        magic: {
          target_groups: autoGroup,
          auto_routing: { mode: 'active', classifier_alias: 'missing' },
        } as never,
      })
    ).toThrow(/unknown classifier alias 'missing'/);
  });

  it('rejects a classifier alias that is not a Decisions alias', () => {
    expect(() =>
      assertAutoRoutingConfigValid({
        judge: { type: 'text', target_groups: [] } as never,
        magic: {
          target_groups: autoGroup,
          auto_routing: { mode: 'active', classifier_alias: 'judge' },
        } as never,
      })
    ).toThrow(/requires a Decisions classifier alias/);
  });

  it('rejects a classifier alias that itself reaches an auto group', () => {
    expect(() =>
      assertAutoRoutingConfigValid({
        judge: {
          type: 'decisions',
          target_groups: [{ name: 'Main', selector: 'auto', targets: [] }],
        } as never,
        magic: {
          target_groups: autoGroup,
          auto_routing: { mode: 'active', classifier_alias: 'judge' },
        } as never,
      })
    ).toThrow(/only supports text aliases|must not use auto routing/);
  });

  it('rejects nested auto alias references', () => {
    expect(() =>
      assertAutoRoutingConfigValid({
        judge: { type: 'decisions', target_groups: [] } as never,
        child: {
          target_groups: [{ name: 'Inner', selector: 'auto', targets: [] }],
        } as never,
        magic: {
          target_groups: [
            {
              name: 'Main',
              selector: 'auto',
              targets: [
                {
                  alias: 'child',
                  auto_profile: { capability: 'premium', specialties: [], reasoning: 'preferred' },
                },
              ],
            },
          ],
          auto_routing: { mode: 'active', classifier_alias: 'judge' },
        } as never,
      })
    ).toThrow(/nested auto aliases are not supported/);
  });

  it('preserves old configs with no auto routing', () => {
    expect(() =>
      assertAutoRoutingConfigValid({
        legacy: {
          target_groups: [
            { name: 'default', selector: 'in_order', targets: [{ provider: 'p', model: 'm' }] },
          ],
        } as never,
      })
    ).not.toThrow();
  });
});
