import { AUTO_CAPABILITY_TIERS } from '@plexus/shared';
import type { AutoCapabilityTier, AutoRoutingConfig } from '@plexus/shared';
import type {
  AutoJudgment,
  AutoRoutingPreviewGroup,
  AutoRoutingPreviewLeaf,
  AutoRoutingPreviewResponse,
  AutoRoutingPreviewTarget,
} from '../types/aliases';
import { getAutoTargetLabel } from './autoRouting';

/**
 * Pure explanation layer for the auto routing preview. The backend already
 * reports the per-group policy reason, per-target decision, required tier, and
 * demand; this module turns those codes into plain language and derives the
 * single concrete "would select" answer without touching the API contract.
 */

/** Server decision reason emitted when no target meets the required tier. */
export const NO_SUITABLE_TARGET_DECISION = 'no_suitable_target_first_option';
/** Server decision for groups that are not auto-routed. */
export const ORDINARY_GROUP_DECISION = 'unqualified_group_fallback';

export interface PreviewReason {
  text: string;
  /** Raw server code, kept for secondary display. */
  code: string;
}

/** First leaf a target would actually dispatch to, skipping ineligible leaves. */
export function firstEligibleLeaf(
  target: AutoRoutingPreviewTarget
): AutoRoutingPreviewLeaf | undefined {
  return (target.leaves ?? []).find(
    (leaf) => leaf.eligible !== false && Boolean(leaf.provider || leaf.model)
  );
}

export function hasEligibleLeaf(target: AutoRoutingPreviewTarget): boolean {
  return firstEligibleLeaf(target) !== undefined;
}

/** Plain language for a target's suitability exclusion code. */
export function describeExclusionReason(
  reason: string | undefined,
  options: { configuredCapability?: string; requiredTier?: string } = {}
): PreviewReason | null {
  if (!reason) return null;
  const capability = options.configuredCapability ?? 'economy';
  const required = options.requiredTier ?? 'the required tier';
  switch (reason) {
    case 'capability_below_required':
      return {
        text: `Configured capability ${capability} is below required ${required}.`,
        code: reason,
      };
    case 'below_uncertainty_floor':
      return {
        text: `Configured capability ${capability} is below the uncertainty floor (${required}) while the judgment is uncertain.`,
        code: reason,
      };
    case 'continuation_target_not_eligible':
      return { text: 'Target is not eligible for the locked continuation.', code: reason };
    default:
      return { text: `Excluded: ${reason}.`, code: reason };
  }
}

/** Plain language for an ineligible leaf's reason code. */
export function describeLeafReason(reason: string | null | undefined): PreviewReason | null {
  if (!reason) return null;
  switch (reason) {
    case 'disabled':
      return { text: 'Target is disabled.', code: reason };
    case 'unknown_provider':
      return { text: 'Provider is not configured.', code: reason };
    case 'provider_disabled':
      return { text: 'Provider is disabled.', code: reason };
    case 'unknown_alias':
      return { text: 'Referenced alias is not configured.', code: reason };
    case 'alias_cycle':
      return { text: 'Alias reference forms a cycle.', code: reason };
    case 'alias_depth_exceeded':
      return { text: 'Alias nesting is deeper than the preview allows.', code: reason };
    case 'empty_alias':
      return { text: 'Referenced alias has no targets.', code: reason };
    case 'continuation_target_not_eligible':
      return { text: 'Target is not eligible for the locked continuation.', code: reason };
    default:
      return { text: `Excluded: ${reason}.`, code: reason };
  }
}

const GROUP_DECISION_TEXT: Record<string, string> = {
  cold_start: 'Cold start: no incumbent, scoring the group.',
  quality_upgrade: 'Upgrading to a higher capability tier.',
  economic_switch: 'Switching to a cheaper qualifying target.',
  cache_hold: 'Holding the incumbent to preserve cache warmth.',
  specialist_switch: 'Switching to a target specialized for this task.',
  preference_switch: 'Switching to the best-qualified target.',
  uncertain_incumbent_hold: 'Judgment is uncertain: holding the incumbent.',
  uncertain_baseline: 'Judgment is uncertain: baseline ordering.',
  continuation_locked: 'Continuation is locked to the incumbent.',
  continuation_target_unavailable: 'The continuation target is unavailable.',
  no_candidates: 'No candidate targets in this group.',
};

/** Plain language for a group-level policy decision code. */
export function describeGroupDecision(decision: string): string | null {
  if (decision === ORDINARY_GROUP_DECISION) {
    return 'Ordinary (non-auto) group: first eligible target.';
  }
  return GROUP_DECISION_TEXT[decision] ?? null;
}

/** Sentence shown when the policy falls back to the first eligible configured target. */
export function firstOptionFallbackText(requiredTier: string | undefined): string {
  const tier = requiredTier ?? 'the required tier';
  return `No eligible target meets ${tier}; using the first eligible configured target.`;
}

// ── Score breakdown ────────────────────────────────────────────────

export interface AutoPreviewScoreBreakdown {
  taskKind: string | null;
  complexity: number;
  capability: number;
  complexityWeight: number;
  capabilityWeight: number;
  complexityTerm: number;
  capabilityTerm: number;
  reasoningActive: boolean;
  reasoningThreshold: number;
  reasoningBoost: number;
  demand: number;
  scoredTier: AutoCapabilityTier;
  requiredTier: AutoCapabilityTier;
  taskFloor: AutoCapabilityTier | null;
  standardThreshold: number;
  highThreshold: number;
  premiumThreshold: number;
  confidence: number | null;
  confidenceThreshold: number;
  confidenceUncertain: boolean;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function tierRank(tier: string | undefined): number {
  const index = AUTO_CAPABILITY_TIERS.indexOf((tier ?? '') as AutoCapabilityTier);
  return index < 0 ? 0 : index;
}

function tierForDemand(
  demand: number,
  boundaries: AutoRoutingConfig['scoring']['tier_boundaries']
): AutoCapabilityTier {
  if (demand >= boundaries.premium) return 'premium';
  if (demand >= boundaries.high) return 'high';
  if (demand >= boundaries.standard) return 'standard';
  return 'economy';
}

/**
 * Reconstruct the demand score from the classification judgment and the policy
 * snapshot captured when the preview actually ran. The caller must pass the
 * snapshot, not the currently edited draft, so moved sliders cannot change a
 * previously displayed score.
 */
export function computeScoreBreakdown(
  judgment: AutoJudgment | undefined,
  config: AutoRoutingConfig | null
): AutoPreviewScoreBreakdown | null {
  if (!judgment || !config) return null;
  const complexity = finiteOrNull(judgment.complexity);
  const capability = finiteOrNull(judgment.capability_required);
  if (complexity === null || capability === null) return null;

  const scoring = config.scoring;
  const deepReasoning = finiteOrNull(judgment.deep_reasoning);
  const reasoningActive = deepReasoning !== null && deepReasoning >= scoring.reasoning_threshold;
  const reasoningBoost = reasoningActive ? scoring.reasoning_boost : 0;
  const complexityTerm = scoring.complexity_weight * complexity;
  const capabilityTerm = scoring.capability_weight * capability;
  const demand = clamp(complexityTerm + capabilityTerm + reasoningBoost, 0, 3);
  const scoredTier = tierForDemand(demand, scoring.tier_boundaries);

  const taskKind = typeof judgment.task_kind === 'string' ? judgment.task_kind : null;
  const taskFloors = scoring.task_minimum_tiers as Record<string, AutoCapabilityTier | undefined>;
  const taskFloor = taskKind ? (taskFloors[taskKind] ?? null) : null;
  const requiredTier =
    taskFloor && tierRank(taskFloor) > tierRank(scoredTier) ? taskFloor : scoredTier;

  const confidence = finiteOrNull(judgment.confidence);
  return {
    taskKind,
    complexity,
    capability,
    complexityWeight: scoring.complexity_weight,
    capabilityWeight: scoring.capability_weight,
    complexityTerm,
    capabilityTerm,
    reasoningActive,
    reasoningThreshold: scoring.reasoning_threshold,
    reasoningBoost,
    demand,
    scoredTier,
    requiredTier,
    taskFloor,
    standardThreshold: scoring.tier_boundaries.standard,
    highThreshold: scoring.tier_boundaries.high,
    premiumThreshold: scoring.tier_boundaries.premium,
    confidence,
    confidenceThreshold: scoring.confidence_threshold,
    confidenceUncertain: confidence !== null && confidence < scoring.confidence_threshold,
  };
}

// ── Selection and groups ───────────────────────────────────────────

export type PreviewSelectionMode = 'chosen' | 'fallback' | 'first_option_fallback' | 'ordinary';

export interface AutoPreviewWouldSelect {
  groupIndex: number;
  groupName: string;
  target: AutoRoutingPreviewTarget;
  leaf: AutoRoutingPreviewLeaf | null;
  mode: PreviewSelectionMode;
  /** Alias name for alias targets; provider/model for concrete targets. */
  label: string;
  /** One-line plain summary for the prominent callout. */
  summary: string;
}

export interface AutoPreviewTargetAnnotation {
  target: AutoRoutingPreviewTarget;
  /** Badge text for the selected/held row; null for ordinary rows. */
  badgeLabel: string | null;
  badgeStatus: 'success' | 'warning' | 'info' | 'neutral';
  /** Plain suitability explanation, when the server reported one. */
  reasonText: string | null;
  /** Raw server reason code, for secondary display. */
  reasonCode: string | null;
}

export interface AutoPreviewGroupExplanation {
  index: number;
  name: string;
  decision: string;
  decisionText: string | null;
  /** Plain sentence for the first-option fallback, when applicable. */
  firstOptionFallbackText: string | null;
  /** True for the earliest group with a selection, the alias-wide pick. */
  isPrimary: boolean;
  winner: AutoRoutingPreviewTarget | null;
  winnerLeaf: AutoRoutingPreviewLeaf | null;
  winnerMode: PreviewSelectionMode;
  /** Per-target annotations in server order. */
  targets: AutoPreviewTargetAnnotation[];
}

export interface AutoPreviewExplanation {
  wouldSelect: AutoPreviewWouldSelect | null;
  groups: AutoPreviewGroupExplanation[];
  score: AutoPreviewScoreBreakdown | null;
  /** True when the edited config drifted from the snapshot the preview used. */
  staleConfig: boolean;
}

interface ResolvedGroupWinner {
  target: AutoRoutingPreviewTarget;
  leaf: AutoRoutingPreviewLeaf | null;
  mode: PreviewSelectionMode;
}

function resolveGroupWinner(group: AutoRoutingPreviewGroup): ResolvedGroupWinner | null {
  if (group.decision === ORDINARY_GROUP_DECISION) {
    const target = group.targets.find(hasEligibleLeaf);
    if (!target) return null;
    return { target, leaf: firstEligibleLeaf(target) ?? null, mode: 'ordinary' };
  }

  const decided = group.targets.find(
    (target) =>
      (target.decision === 'chosen' || target.decision === 'fallback') && hasEligibleLeaf(target)
  );
  if (decided) {
    const mode: PreviewSelectionMode =
      group.decision === NO_SUITABLE_TARGET_DECISION
        ? 'first_option_fallback'
        : decided.decision === 'fallback'
          ? 'fallback'
          : 'chosen';
    return { target: decided, leaf: firstEligibleLeaf(decided) ?? null, mode };
  }

  // No explicit decision (e.g. an unsupported selector): show the first
  // eligible target rather than claiming one was chosen.
  const eligible = group.targets.find(hasEligibleLeaf);
  if (!eligible) return null;
  return { target: eligible, leaf: firstEligibleLeaf(eligible) ?? null, mode: 'chosen' };
}

function winnerBadge(
  winner: ResolvedGroupWinner,
  isPrimary: boolean
): { label: string; status: AutoPreviewTargetAnnotation['badgeStatus'] } {
  if (isPrimary) {
    if (winner.mode === 'first_option_fallback' || winner.mode === 'fallback') {
      return { label: 'Would select (fallback)', status: 'warning' };
    }
    return { label: 'Would select', status: 'success' };
  }
  if (winner.mode === 'ordinary') return { label: 'First eligible target', status: 'info' };
  if (winner.mode === 'first_option_fallback' || winner.mode === 'fallback') {
    return { label: 'Fallback in this group', status: 'warning' };
  }
  return { label: 'First choice in this group', status: 'info' };
}

function selectionSummary(groupName: string, winner: ResolvedGroupWinner, label: string): string {
  const suffix =
    winner.mode === 'first_option_fallback'
      ? ' (no suitable target, first-option fallback)'
      : winner.mode === 'fallback'
        ? ' (fallback)'
        : '';
  return `Would select ${label} in group ${groupName}${suffix}.`;
}

function annotateTarget(
  target: AutoRoutingPreviewTarget,
  winner: ResolvedGroupWinner | null,
  badge: { label: string; status: AutoPreviewTargetAnnotation['badgeStatus'] } | null
): AutoPreviewTargetAnnotation {
  const isWinner = winner !== null && target === winner.target;
  const reason =
    target.suitable === false
      ? describeExclusionReason(target.reason, {
          configuredCapability: target.profile?.capability,
          requiredTier: target.requiredTier,
        })
      : null;
  return {
    target,
    badgeLabel: isWinner ? (badge?.label ?? null) : target.decision === 'hold' ? 'Held' : null,
    badgeStatus: isWinner
      ? (badge?.status ?? 'neutral')
      : target.decision === 'hold'
        ? 'info'
        : 'neutral',
    reasonText: reason?.text ?? null,
    reasonCode: reason?.code ?? null,
  };
}

export function explainAutoPreview(params: {
  result: AutoRoutingPreviewResponse;
  /** Policy snapshot captured when the preview request resolved. */
  resultConfig: AutoRoutingConfig | null;
  /** The currently edited policy, used only to flag drift. */
  currentConfig?: AutoRoutingConfig | null;
}): AutoPreviewExplanation {
  const { result, resultConfig, currentConfig } = params;

  const winners = result.groups.map(resolveGroupWinner);
  const primaryIndex = winners.findIndex((winner) => winner !== null);

  let wouldSelect: AutoPreviewWouldSelect | null = null;
  const groups: AutoPreviewGroupExplanation[] = result.groups.map((group, index) => {
    const winner = winners[index] ?? null;
    const isPrimary = index === primaryIndex;
    const badge = winner ? winnerBadge(winner, isPrimary) : null;
    const label = winner
      ? winner.target.alias
        ? getAutoTargetLabel(winner.target)
        : winner.leaf
          ? getAutoTargetLabel(winner.leaf)
          : getAutoTargetLabel(winner.target)
      : null;
    if (isPrimary && winner && label) {
      wouldSelect = {
        groupIndex: index,
        groupName: group.name,
        target: winner.target,
        leaf: winner.target.alias ? null : winner.leaf,
        mode: winner.mode,
        label,
        summary: selectionSummary(group.name, winner, label),
      };
    }
    return {
      index,
      name: group.name,
      decision: group.decision,
      decisionText: describeGroupDecision(group.decision),
      firstOptionFallbackText:
        group.decision === NO_SUITABLE_TARGET_DECISION
          ? firstOptionFallbackText(winner?.target.requiredTier ?? group.targets[0]?.requiredTier)
          : null,
      isPrimary,
      winner: winner?.target ?? null,
      winnerLeaf: winner?.target.alias ? null : (winner?.leaf ?? null),
      winnerMode: winner?.mode ?? 'chosen',
      targets: group.targets.map((target) => annotateTarget(target, winner, badge)),
    };
  });

  const staleConfig =
    resultConfig !== null &&
    currentConfig != null &&
    JSON.stringify(resultConfig) !== JSON.stringify(currentConfig);

  return {
    wouldSelect,
    groups,
    score: computeScoreBreakdown(result.analysis.judgment, resultConfig),
    staleConfig,
  };
}
