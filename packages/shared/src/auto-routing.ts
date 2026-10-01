import { z } from 'zod';

/**
 * Shared contract for the `auto` alias routing policy.
 *
 * Alias-level scoring/switching policy lives on `ModelConfig['auto_routing']`
 * (`auto_routing` JSON on `model_aliases`). Per-logical-target qualifications
 * live on each target's `auto_profile` (`auto_profile` JSON on
 * `model_alias_targets`). Both are nullable: existing aliases without an auto
 * group keep behaving exactly as before.
 */

/** Task vocabulary used by specialties and per-task minimum tier overrides. */
export const AUTO_TASK_KINDS = [
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
] as const;
export type AutoTaskKind = (typeof AUTO_TASK_KINDS)[number];

/** Administrator qualification tiers, ordered lowest to highest (ordinal 0–3). */
export const AUTO_CAPABILITY_TIERS = ['economy', 'standard', 'high', 'premium'] as const;
export type AutoCapabilityTier = (typeof AUTO_CAPABILITY_TIERS)[number];

/** Whether extended reasoning materially helps a target qualify. */
export const AUTO_REASONING_SUITABILITY = ['normal', 'preferred'] as const;
export type AutoReasoningSuitability = (typeof AUTO_REASONING_SUITABILITY)[number];

export const AutoTaskKindSchema = z.enum(AUTO_TASK_KINDS);
export const AutoCapabilityTierSchema = z.enum(AUTO_CAPABILITY_TIERS);
export const AutoReasoningSuitabilitySchema = z.enum(AUTO_REASONING_SUITABILITY);

/** Numeric defaults are provisional starting values from the implementation plan. */
export const DEFAULT_AUTO_ROUTING_SCORING = {
  complexity_weight: 0.55,
  capability_weight: 0.45,
  reasoning_threshold: 0.65,
  reasoning_boost: 0.5,
  confidence_threshold: 0.6,
  tier_boundaries: { standard: 0.75, high: 1.75, premium: 2.5 },
  task_minimum_tiers: { plan: 'high', review: 'high' },
} as const;

export const DEFAULT_AUTO_ROUTING_PREFERENCES = {
  specialty_bonus: 0.1,
  reasoning_bonus: 0.1,
} as const;

export const DEFAULT_AUTO_ROUTING_SWITCHING = {
  score_deadband: 0.2,
  minimum_savings_usd: 0.01,
  minimum_savings_fraction: 0.1,
  preference_margin: 0.05,
} as const;

/** The scoring/preferences/switching shapes, used both standalone and nested. */
export const AutoRoutingScoringSchema = z
  .object({
    complexity_weight: z.number().min(0).max(1),
    capability_weight: z.number().min(0).max(1),
    reasoning_threshold: z.number().min(0).max(1),
    reasoning_boost: z.number().min(0).max(3),
    confidence_threshold: z.number().min(0).max(1),
    // Tier boundaries are strictly ordered inside 0–3; equality advances to the
    // higher tier at selection time.
    tier_boundaries: z
      .object({
        standard: z.number().min(0).max(3),
        high: z.number().min(0).max(3),
        premium: z.number().min(0).max(3),
      })
      .refine(
        (value) => value.standard < value.high && value.high < value.premium,
        'tier_boundaries must be strictly increasing (standard < high < premium)'
      ),
    task_minimum_tiers: z
      .partialRecord(AutoTaskKindSchema, AutoCapabilityTierSchema)
      .default(() => ({ ...DEFAULT_AUTO_ROUTING_SCORING.task_minimum_tiers })),
  })
  .refine(
    (value) => Math.abs(value.complexity_weight + value.capability_weight - 1) < 1e-9,
    'complexity_weight and capability_weight must sum to 1'
  );

export const AutoRoutingPreferencesSchema = z.object({
  specialty_bonus: z.number().min(0).max(1),
  reasoning_bonus: z.number().min(0).max(1),
});

export const AutoRoutingSwitchingSchema = z.object({
  score_deadband: z.number().min(0),
  minimum_savings_usd: z.number().min(0),
  minimum_savings_fraction: z.number().min(0).max(1),
  preference_margin: z.number().min(0),
});

export const AutoRoutingConfigSchema = z.object({
  mode: z.enum(['off', 'active']).default('off'),
  // Administrator-authorized Decisions model alias. The empty string is the
  // default for an off-mode draft that has not named a classifier yet.
  classifier_alias: z.string().default(''),
  classifier_deadline_ms: z.number().int().positive().default(500),
  rubric_version: z.literal(1).default(1),
  baseline_policy: z.enum(['in_order', 'cost']).default('in_order'),
  uncertainty_minimum_tier: AutoCapabilityTierSchema.default('high'),
  scoring: AutoRoutingScoringSchema.default(() => ({
    ...DEFAULT_AUTO_ROUTING_SCORING,
    tier_boundaries: { ...DEFAULT_AUTO_ROUTING_SCORING.tier_boundaries },
    task_minimum_tiers: { ...DEFAULT_AUTO_ROUTING_SCORING.task_minimum_tiers },
  })),
  preferences: AutoRoutingPreferencesSchema.default(() => ({
    ...DEFAULT_AUTO_ROUTING_PREFERENCES,
  })),
  switching: AutoRoutingSwitchingSchema.default(() => ({ ...DEFAULT_AUTO_ROUTING_SWITCHING })),
});

/**
 * Local qualification for one logical target (concrete provider/model or an
 * alias reference). All fields are optional so structurally valid incomplete
 * profiles can be saved in off mode; activation requires capability.
 */
export const AutoTargetProfileSchema = z.object({
  capability: AutoCapabilityTierSchema.optional(),
  // Absent/empty means general-purpose, not unsupported for every task.
  specialties: z.array(AutoTaskKindSchema).default([]),
  reasoning: AutoReasoningSuitabilitySchema.optional(),
});

export type AutoRoutingScoring = z.infer<typeof AutoRoutingScoringSchema>;
export type AutoRoutingPreferences = z.infer<typeof AutoRoutingPreferencesSchema>;
export type AutoRoutingSwitching = z.infer<typeof AutoRoutingSwitchingSchema>;
export type AutoRoutingConfig = z.infer<typeof AutoRoutingConfigSchema>;
export type AutoTargetProfile = z.infer<typeof AutoTargetProfileSchema>;

/** Fully-defaulted starting policy: off, no classifier, baseline in_order. */
export const DEFAULT_AUTO_ROUTING_CONFIG: AutoRoutingConfig = AutoRoutingConfigSchema.parse({});
