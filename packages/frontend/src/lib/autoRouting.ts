import {
  AUTO_CAPABILITY_TIERS,
  AUTO_TASK_KINDS,
  AutoRoutingConfigSchema,
  DEFAULT_AUTO_ROUTING_CONFIG,
} from '@plexus/shared';
import type { AutoRoutingConfig, AutoTargetProfile } from '@plexus/shared';
import type { Alias, AliasTargetGroup } from '../types/aliases';

/**
 * Pure helpers for the alias-scoped `auto` routing policy. These live outside
 * the React components so validation and defaults can be unit tested and shared
 * between the alias editor and the routing preview.
 */

export const AUTO_CAPABILITY_LABELS: Record<string, string> = {
  economy: 'Economy',
  standard: 'Standard',
  high: 'High',
  premium: 'Premium',
};

export const AUTO_REASONING_LABELS: Record<string, string> = {
  normal: 'Normal',
  preferred: 'Preferred',
};

export const AUTO_TASK_LABELS: Record<string, string> = {
  plan: 'Plan',
  implement: 'Implement',
  debug: 'Debug',
  refactor: 'Refactor',
  review: 'Review',
  research: 'Research',
  explain: 'Explain',
  operate: 'Operate',
  write: 'Write',
  chat: 'Chat',
};

const CAPABILITY_TIER_SET = new Set<string>(AUTO_CAPABILITY_TIERS);
const TASK_KIND_SET = new Set<string>(AUTO_TASK_KINDS);

/** Deep clone a JSON-compatible value so defaults are never mutated in place. */
export function cloneAutoRoutingConfig<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** A fully-defaulted off-mode policy. Always a fresh object. */
export function createDefaultAutoRoutingConfig(): AutoRoutingConfig {
  return cloneAutoRoutingConfig(DEFAULT_AUTO_ROUTING_CONFIG);
}

export function getAutoGroups(groups: AliasTargetGroup[] | undefined): AliasTargetGroup[] {
  return (groups ?? []).filter((group) => group.selector === 'auto');
}

export function hasAutoGroup(alias: Pick<Alias, 'target_groups'>): boolean {
  return getAutoGroups(alias.target_groups).length > 0;
}

export function getAutoTargetLabel(target: {
  alias?: string;
  provider?: string;
  model?: string;
}): string {
  if (target.alias) return `alias:${target.alias}`;
  return `${target.provider ?? '?'}/${target.model ?? '?'}`;
}

export function isAutoProfileComplete(profile: AutoTargetProfile | undefined): boolean {
  return !!profile?.capability && CAPABILITY_TIER_SET.has(profile.capability);
}

/** Enabled logical targets in auto groups that still need a capability. */
export function getIncompleteAutoProfileTargets(alias: Pick<Alias, 'target_groups'>): string[] {
  const labels: string[] = [];
  for (const group of getAutoGroups(alias.target_groups)) {
    for (const target of group.targets) {
      if (target.enabled === false) continue;
      if (!isAutoProfileComplete(target.auto_profile)) labels.push(getAutoTargetLabel(target));
    }
  }
  return labels;
}

export interface AutoRoutingValidationResult {
  /** Blocking in every mode: malformed fields or out-of-range numbers. */
  valid: boolean;
  /** Field-keyed messages for inline display. */
  fieldErrors: Record<string, string>;
  /** Flat list of all field errors, for a summary. */
  issues: string[];
  /** Extra blockers that only apply when mode is active. */
  activationBlockers: string[];
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function checkUnitRange(
  fieldErrors: Record<string, string>,
  key: string,
  value: unknown,
  label: string,
  min: number,
  max: number
) {
  if (!isFiniteNumber(value) || value < min || value > max) {
    const range = Number.isFinite(max) ? `between ${min} and ${max}` : `at least ${min}`;
    fieldErrors[key] = `${label} must be a number ${range}.`;
  }
}

/**
 * Validate an alias's auto routing draft.
 *
 * The shared Zod schema is the source of truth for shape. Manual checks below
 * produce friendlier, field-keyed messages; any remaining Zod issue is folded
 * into the flat issue list so a malformed value can never be saved silently.
 */
export function validateAutoRoutingDraft(
  alias: Pick<Alias, 'target_groups' | 'auto_routing' | 'type'>,
  options?: { decisionsAliases?: string[] }
): AutoRoutingValidationResult {
  const config = alias.auto_routing;
  const fieldErrors: Record<string, string> = {};

  if (hasAutoGroup(alias) && alias.type !== undefined && alias.type !== 'text') {
    fieldErrors['type'] = 'Auto routing only supports text aliases.';
  }

  if (!config) {
    return {
      valid: Object.keys(fieldErrors).length === 0,
      fieldErrors,
      issues: Object.values(fieldErrors),
      activationBlockers: [],
    };
  }

  if (config.mode !== 'off' && config.mode !== 'active') {
    fieldErrors['mode'] = "Mode must be 'off' or 'active'.";
  }
  if (!Number.isInteger(config.classifier_deadline_ms) || config.classifier_deadline_ms <= 0) {
    fieldErrors['classifier_deadline_ms'] = 'Deadline must be a positive whole number of ms.';
  }
  if (config.baseline_policy !== 'in_order' && config.baseline_policy !== 'cost') {
    fieldErrors['baseline_policy'] = "Baseline policy must be 'in_order' or 'cost'.";
  }
  if (config.rubric_version !== 1) {
    fieldErrors['rubric_version'] = 'Unsupported rubric version.';
  }

  const scoring = config.scoring;
  checkUnitRange(
    fieldErrors,
    'scoring.complexity_weight',
    scoring.complexity_weight,
    'Complexity weight',
    0,
    1
  );
  checkUnitRange(
    fieldErrors,
    'scoring.capability_weight',
    scoring.capability_weight,
    'Capability weight',
    0,
    1
  );
  if (
    isFiniteNumber(scoring.complexity_weight) &&
    isFiniteNumber(scoring.capability_weight) &&
    Math.abs(scoring.complexity_weight + scoring.capability_weight - 1) >= 1e-9
  ) {
    fieldErrors['scoring.complexity_weight'] = 'Complexity and capability weights must sum to 1.0.';
  }
  checkUnitRange(
    fieldErrors,
    'scoring.reasoning_threshold',
    scoring.reasoning_threshold,
    'Reasoning threshold',
    0,
    1
  );
  checkUnitRange(
    fieldErrors,
    'scoring.reasoning_boost',
    scoring.reasoning_boost,
    'Reasoning boost',
    0,
    3
  );
  checkUnitRange(
    fieldErrors,
    'scoring.confidence_threshold',
    scoring.confidence_threshold,
    'Confidence threshold',
    0,
    1
  );

  const boundaries = scoring.tier_boundaries;
  checkUnitRange(
    fieldErrors,
    'scoring.tier_boundaries.standard',
    boundaries.standard,
    'Standard boundary',
    0,
    3
  );
  checkUnitRange(
    fieldErrors,
    'scoring.tier_boundaries.high',
    boundaries.high,
    'High boundary',
    0,
    3
  );
  checkUnitRange(
    fieldErrors,
    'scoring.tier_boundaries.premium',
    boundaries.premium,
    'Premium boundary',
    0,
    3
  );
  if (
    fieldErrors['scoring.tier_boundaries.standard'] === undefined &&
    fieldErrors['scoring.tier_boundaries.high'] === undefined &&
    fieldErrors['scoring.tier_boundaries.premium'] === undefined &&
    !(boundaries.standard < boundaries.high && boundaries.high < boundaries.premium)
  ) {
    fieldErrors['scoring.tier_boundaries.standard'] =
      'Tier boundaries must be strictly increasing (standard < high < premium).';
  }

  for (const [task, tier] of Object.entries(scoring.task_minimum_tiers ?? {})) {
    if (!TASK_KIND_SET.has(task) || !CAPABILITY_TIER_SET.has(tier as string)) {
      fieldErrors[`scoring.task_minimum_tiers.${task}`] = 'Unknown task or capability tier.';
    }
  }

  checkUnitRange(
    fieldErrors,
    'preferences.specialty_bonus',
    config.preferences.specialty_bonus,
    'Specialty bonus',
    0,
    1
  );
  checkUnitRange(
    fieldErrors,
    'preferences.reasoning_bonus',
    config.preferences.reasoning_bonus,
    'Reasoning bonus',
    0,
    1
  );

  checkUnitRange(
    fieldErrors,
    'switching.score_deadband',
    config.switching.score_deadband,
    'Score deadband',
    0,
    Number.POSITIVE_INFINITY
  );
  checkUnitRange(
    fieldErrors,
    'switching.minimum_savings_usd',
    config.switching.minimum_savings_usd,
    'Minimum savings (USD)',
    0,
    Number.POSITIVE_INFINITY
  );
  checkUnitRange(
    fieldErrors,
    'switching.minimum_savings_fraction',
    config.switching.minimum_savings_fraction,
    'Minimum savings fraction',
    0,
    1
  );
  checkUnitRange(
    fieldErrors,
    'switching.preference_margin',
    config.switching.preference_margin,
    'Preference margin',
    0,
    Number.POSITIVE_INFINITY
  );

  // Validate target specialties against the shared vocabulary.
  for (const group of getAutoGroups(alias.target_groups)) {
    for (const target of group.targets) {
      const specialties = target.auto_profile?.specialties ?? [];
      for (const specialty of specialties) {
        if (!TASK_KIND_SET.has(specialty)) {
          fieldErrors[`targets.${getAutoTargetLabel(target)}.specialties`] =
            `Unknown specialty '${specialty}'.`;
        }
      }
    }
  }

  // Fold in anything the shared schema rejects that manual checks missed.
  const parsed = AutoRoutingConfigSchema.safeParse(config);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      else if (!key) fieldErrors['auto_routing'] = issue.message;
    }
  }

  const issues = Object.values(fieldErrors);
  const valid = Object.keys(fieldErrors).length === 0;

  const activationBlockers: string[] = [];
  if (config.mode === 'active') {
    if (config.classifier_alias.trim().length === 0) {
      activationBlockers.push('Active mode requires a classifier alias.');
    } else if (
      options?.decisionsAliases &&
      !options.decisionsAliases.includes(config.classifier_alias.trim())
    ) {
      activationBlockers.push(
        `Classifier '${config.classifier_alias}' is not an available Decisions model alias.`
      );
    }
    for (const label of getIncompleteAutoProfileTargets(alias)) {
      activationBlockers.push(`Target '${label}' needs a capability profile for active mode.`);
    }
  }

  return { valid, fieldErrors, issues, activationBlockers };
}

/** True when the alias can safely be saved with these auto settings. */
export function canSaveAutoRouting(alias: Pick<Alias, 'target_groups' | 'auto_routing'>): boolean {
  return validateAutoRoutingDraft(alias).valid;
}

/**
 * Classifier/rubric/context inputs whose change invalidates a retained preview
 * judgment. Scoring-only changes are intentionally excluded so weights and
 * switching margins can be recomputed against the same judgment.
 */
export function getAutoJudgmentContextKey(input: {
  prompt: string;
  classifierAlias: string;
  rubricVersion: number;
}): string {
  return JSON.stringify([input.prompt, input.classifierAlias, input.rubricVersion]);
}
