/**
 * Runtime orchestration for the `auto` alias routing policy.
 *
 * The pure scoring/switching logic lives in `auto-policy.ts`, the bounded
 * API-key-scoped state in `auto-state.ts`, and the internal Decisions
 * classifier lifecycle in `auto-classifier.ts`. This module is the only place
 * that ties them to a live request: it classifies once per inference request
 * (except on a hard continuation turn, which locks to the known target without
 * a new classifier call), reconstructs logical targets from the router's
 * provenance, ranks each auto group once, writes the result back into the flat
 * candidate list, records the decision on request metadata, and updates
 * observations from real dispatches.
 *
 * It never adds providers, bypasses access/quota/admission, or changes the
 * requested alias. Ordinary (non-`auto`) groups and direct routes are left
 * exactly as the router produced them.
 */

import { createHash } from 'node:crypto';
import type {
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedMessage,
  UnifiedUsage,
} from '../../types/unified';
import { getConfig, type ModelConfig } from '../../config';
import type { AutoTargetProfile } from '@plexus/shared';
import { logger } from '../../utils/logger';
import { estimateInputTokens, estimateTokens } from '../../utils/estimate-tokens';
import type { RouteResult } from './router';
import {
  rankAutoCandidates,
  type AutoPolicyCandidate,
  type AutoPolicyContext,
  type AutoPricingInput,
  type AutoRankingResult,
  type AutoWarmthObservation,
} from './auto-policy';
import { AutoStateStore, buildAutoStateScope, type AutoContinuationTarget } from './auto-state';
import { classifyAutoRequest, type AutoClassifierResult } from './auto-classifier';
import { deriveAutoSessionBranch } from './auto-session';
import { PricingManager } from '../observability/pricing-manager';

// ── Continuation detection ──────────────────────────────────────────

/**
 * Conservative structural continuation detection. A trailing tool result or an
 * assistant turn with unanswered tool calls means the provider/model must be
 * retained for protocol correctness. Tool results are portable on their own
 * (see `detectProviderBoundSignature`), so this reports the structural shape
 * only, not whether the wire state is provider-bound. Responses requests are
 * not special-cased: `previousResponseId` alone does not lock, matching the
 * "no Responses-specific lock" rule.
 */
export function detectAutoContinuationLock(request: UnifiedChatRequest): boolean {
  const messages = request.messages ?? [];
  const last = messages[messages.length - 1];
  if (!last) return false;
  if (last.role === 'tool') return true;
  if (last.role === 'assistant' && (last.tool_calls?.length ?? 0) > 0) return true;
  return false;
}

/**
 * Messages belonging to the unresolved continuation window: everything after
 * the last user turn. Signed state from a completed turn before a new
 * substantive user message must not pin the rest of the conversation.
 */
function continuationWindow(messages: UnifiedMessage[]): UnifiedMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') return messages.slice(i + 1);
  }
  return messages;
}

/**
 * Detect provider-bound wire state: signed reasoning/thinking content and
 * thought signatures that only the originating provider can verify. This state
 * is not portable across providers, so a request carrying it may only continue
 * on a known owner; with none the router must refuse rather than invent a
 * target. Tool results alone are portable and intentionally not counted here.
 */
export function detectProviderBoundSignature(request: UnifiedChatRequest): boolean {
  for (const message of continuationWindow(request.messages ?? [])) {
    if (message.role !== 'assistant') continue;
    if (typeof message.thought_signature === 'string' && message.thought_signature.length > 0) {
      return true;
    }
    if (typeof message.thinking?.signature === 'string' && message.thinking.signature.length > 0) {
      return true;
    }
    for (const toolCall of message.tool_calls ?? []) {
      if (typeof toolCall.thought_signature === 'string' && toolCall.thought_signature.length > 0) {
        return true;
      }
    }
  }
  return false;
}

// ── Identity, branch, prefix ────────────────────────────────────────

/**
 * Server-owned API-key identity. When absent, auto state (incumbent, warmth,
 * judgment reuse, continuation persistence) is disabled entirely rather than
 * shared across anonymous callers.
 */
function autoKeyId(request: UnifiedChatRequest): string | null {
  const explicit = request.metadata?.plexus_metadata?.plexus_key_id;
  if (typeof explicit !== 'string') return null;
  const trimmed = explicit.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Conversation-branch scope. Shared with the classifier's session cache so the
 * runtime's state scope and the classifier cannot drift apart. Branchless
 * requests return `undefined` and stay stateless.
 */
function deriveBranch(request: UnifiedChatRequest): string | undefined {
  return deriveAutoSessionBranch(request);
}

/**
 * Whether the effective wire prefix is opaque enough that warmth cannot be
 * predicted cheaply and safely. Compaction rewrites the prefix per provider, so
 * an alias/global compaction override invalidates optimistic warmth.
 */
function prefixIsOpaque(alias: ModelConfig): boolean {
  if (alias.compaction?.enabled === true) return true;
  try {
    return getConfig().compaction?.enabled === true;
  } catch {
    return false;
  }
}

/**
 * Whether a resolved candidate rewrites the wire prefix per provider/model.
 * Provider-level compaction, or enabled provider/model adapters, mean the
 * fingerprint computed from the raw request cannot predict this leaf's cached
 * prefix; its warmth evidence is uncertain rather than optimistic.
 */
function candidatePrefixIsOpaque(route: RouteResult): boolean {
  if (route.config.compaction?.enabled === true) return true;
  const adapters = [...(route.config.adapter ?? []), ...(route.modelConfig?.adapter ?? [])];
  return adapters.some((adapter) => adapter.enabled !== false);
}

/** Request parameters that materially change the effective wire prefix. */
function prefixParams(request: UnifiedChatRequest): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  const fields = [
    'temperature',
    'max_tokens',
    'response_format',
    'text',
    'reasoning',
    'tool_choice',
    'parallel_tool_calls',
    'stop',
    'seed',
  ] as const;
  for (const field of fields) {
    const value = (request as unknown as Record<string, unknown>)[field];
    if (value !== undefined) params[field] = value;
  }
  return params;
}

/**
 * Fingerprint of the stable, provider-visible prefix: system content, tools,
 * the leading messages that anchor the conversation, and generation parameters.
 * Returns `undefined` (warmth uncertain) when compaction makes the prefix
 * opaque or when there is not enough stable content to fingerprint.
 */
export function deriveAutoPrefixFingerprint(
  request: UnifiedChatRequest,
  alias: ModelConfig
): string | undefined {
  if (prefixIsOpaque(alias)) return undefined;
  const messages = request.messages ?? [];
  const prefix = {
    system: request.systemInstruction ?? null,
    tools: request.tools ?? null,
    messages: messages.slice(0, 3),
    params: prefixParams(request),
  };
  if (!prefix.system && !prefix.tools && messages.length === 0) return undefined;
  return createHash('sha256').update(JSON.stringify(prefix)).digest('hex');
}

// ── Token + pricing inputs ──────────────────────────────────────────

function estimateAutoInputTokens(request: UnifiedChatRequest): number {
  if (request.originalBody) {
    const estimated = estimateInputTokens(request.originalBody, request.incomingApiType || 'chat');
    if (estimated > 0) return estimated;
  }
  // Unified fallback: includes system, tools, and messages so a large tool
  // schema still counts toward the request's input estimate.
  return estimateTokens(
    JSON.stringify([request.systemInstruction ?? null, request.messages ?? [], request.tools ?? []])
  );
}

/** Default bounded output estimate when the client gives no smaller ceiling. */
const DEFAULT_OUTPUT_ESTIMATE_TOKENS = 512;

/**
 * Bounded output-token estimate for cache/cost economics. `max_tokens` is a
 * ceiling, not a prediction, so the default 512-token estimate is capped by
 * it; plausible output bounds are 0.5×–1.5× that estimate and never exceed the
 * ceiling.
 */
function estimateAutoOutputTokens(request: UnifiedChatRequest): {
  expected: number;
  range: { lower: number; upper: number };
} {
  const ceiling =
    typeof request.max_tokens === 'number' &&
    Number.isFinite(request.max_tokens) &&
    request.max_tokens > 0
      ? request.max_tokens
      : undefined;
  const expected = Math.min(
    DEFAULT_OUTPUT_ESTIMATE_TOKENS,
    ceiling ?? DEFAULT_OUTPUT_ESTIMATE_TOKENS
  );
  const lower = Math.max(0, Math.floor(expected * 0.5));
  const upper =
    ceiling !== undefined
      ? Math.min(ceiling, Math.ceil(expected * 1.5))
      : Math.ceil(expected * 1.5);
  return { expected, range: { lower, upper } };
}

/**
 * Normalize OpenRouter slug pricing through PricingManager into per-million
 * token rates. Unresolved slugs return `undefined` — unknown, never free.
 * Resolved rates apply the per-pricing discount, falling back to the
 * provider-level discount using the same `1 - discount` convention as
 * `calculate-costs`.
 */
function toAutoPricingInput(pricing: unknown, providerDiscount?: number): AutoPricingInput {
  if (!pricing || typeof pricing !== 'object') {
    return pricing as AutoPricingInput;
  }
  const record = pricing as Record<string, any>;
  if (record.source !== 'openrouter' || typeof record.slug !== 'string') {
    return pricing as AutoPricingInput;
  }
  const resolved = PricingManager.getInstance().getPricing(record.slug);
  if (!resolved) return undefined;
  const effectiveDiscount =
    typeof record.discount === 'number' ? record.discount : providerDiscount;
  const multiplier = effectiveDiscount ? 1 - effectiveDiscount : 1;
  const perMillion = (value: string | undefined): number | undefined => {
    if (value === undefined) return undefined;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed * 1_000_000 * multiplier : undefined;
  };
  const inputPerMillion = perMillion(resolved.prompt);
  const outputPerMillion = perMillion(resolved.completion);
  if (inputPerMillion === undefined || outputPerMillion === undefined) return undefined;
  return {
    inputPerMillion,
    outputPerMillion,
    cacheReadPerMillion: perMillion(resolved.input_cache_read),
    cacheWritePerMillion: perMillion(resolved.input_cache_write),
  };
}

// ── Public API ──────────────────────────────────────────────────────

export interface ApplyAutoRoutingParams {
  request: UnifiedChatRequest;
  /** Canonical alias config resolved for this request. */
  alias: ModelConfig;
  canonicalModel: string;
  /** Access/quota-filtered candidates from the normal router. */
  candidates: RouteResult[];
  signal?: AbortSignal;
}

export interface ApplyAutoRoutingResult {
  candidates: RouteResult[];
  decision: Record<string, unknown>;
}

interface LogicalTargetBlock {
  targetKey: string;
  targetIndex: number;
  profile?: AutoTargetProfile;
  leaves: RouteResult[];
}

function isAutoGroup(group: { selector: string }): boolean {
  return group.selector === 'auto';
}

function storeDecision(request: UnifiedChatRequest, decision: Record<string, unknown>): void {
  const metadata = (request.metadata ??= {} as UnifiedChatRequest['metadata']) as Record<
    string,
    any
  >;
  const plexus = (metadata.plexus_metadata ??= {});
  plexus.auto_routing_decision = decision;
}

/** Reconstruct logical targets (declaration order) for one auto group. */
function collectLogicalTargets(
  candidates: RouteResult[],
  groupIndex: number
): LogicalTargetBlock[] {
  const blocks = new Map<string, LogicalTargetBlock>();
  for (const candidate of candidates) {
    const provenance = candidate.autoProvenance;
    if (!provenance || provenance.groupIndex !== groupIndex) continue;
    let block = blocks.get(provenance.targetKey);
    if (!block) {
      block = {
        targetKey: provenance.targetKey,
        targetIndex: provenance.targetIndex,
        profile: provenance.profile,
        leaves: [],
      };
      blocks.set(provenance.targetKey, block);
    }
    block.leaves.push(candidate);
  }
  const ordered = [...blocks.values()].sort((a, b) => a.targetIndex - b.targetIndex);
  for (const block of ordered) {
    block.leaves.sort(
      (a, b) => (a.autoProvenance?.leafIndex ?? 0) - (b.autoProvenance?.leafIndex ?? 0)
    );
  }
  return ordered;
}

/**
 * Map actual-target warmth observations onto logical-target ids. Warmth is
 * recorded per real provider/model leaf; the policy reads it by logical target
 * id, so the representative (first eligible) leaf supplies the observation.
 * When that leaf rewrites the wire prefix, its stored evidence is exposed as
 * uncertain (no fingerprint) rather than assumed warm.
 */
function mapObservationsToLogicalTargets(
  store: AutoStateStore,
  scope: string,
  blocks: LogicalTargetBlock[],
  prefixFingerprint: string | undefined,
  preferLeaf?: (leaf: RouteResult) => boolean
): Record<string, AutoWarmthObservation> {
  const observations: Record<string, AutoWarmthObservation> = {};
  for (const block of blocks) {
    const representative =
      (preferLeaf ? block.leaves.find(preferLeaf) : undefined) ?? block.leaves[0];
    if (!representative) continue;
    const candidateId = `${representative.provider}/${representative.model}`;
    if (candidatePrefixIsOpaque(representative)) {
      const warmth = store.getWarmth(scope, candidateId);
      if (warmth) observations[block.targetKey] = { ...warmth, prefixFingerprint: undefined };
      continue;
    }
    const warmth = store.getWarmth(scope, candidateId, prefixFingerprint);
    if (warmth) observations[block.targetKey] = warmth;
  }
  return observations;
}

/** Keep the first occurrence of each provider/model in ordered order. */
function dedupeFirstOccurrence(candidates: RouteResult[]): RouteResult[] {
  const seen = new Set<string>();
  const result: RouteResult[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.provider}\u0000${candidate.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

/**
 * Classify once, rank every auto group, and write the ordered logical targets
 * back into the flat candidate list without disturbing ordinary groups.
 */
export async function applyAutoRouting(
  params: ApplyAutoRoutingParams
): Promise<ApplyAutoRoutingResult> {
  const { request, alias, canonicalModel, candidates, signal } = params;
  const groups = alias.target_groups ?? [];
  const autoGroups = groups.filter(isAutoGroup);
  const policy = alias.auto_routing;
  if (autoGroups.length === 0 || !policy || policy.mode !== 'active') {
    return { candidates, decision: {} };
  }

  const keyId = autoKeyId(request);
  const apiType = request.incomingApiType || 'chat';
  const branch = deriveBranch(request);
  // State is keyed by API-key identity and a stable conversation branch only.
  // Without a branch, every request would create a fresh random scope and the
  // bounded LRU would evict real conversations' state; branchless requests stay
  // stateless instead.
  const stateful = keyId !== null && branch !== undefined;
  const scope = stateful
    ? buildAutoStateScope({ keyId: keyId!, alias: canonicalModel, apiType, branch })
    : null;
  const store = AutoStateStore.getInstance();
  const prefixFingerprint = deriveAutoPrefixFingerprint(request, alias);
  // Reserve one sequence for the whole request so every state write below and
  // the later completion share it. Without it, a late completion has no
  // ordering evidence and can overwrite a newer request's state.
  const sequence = scope ? store.reserveSequence(scope) : null;

  // Recompute the continuation shape before classifying. A structural tool
  // turn is only a hard lock when we already know the target that produced it;
  // a cold portable tool turn goes through normal ranking/fallback instead of
  // arbitrarily pinning the first leaf. A stored lock is never treated as hard
  // on its own (a soft acknowledgement must not pin the conversation).
  const structuralLock = detectAutoContinuationLock(request);
  const providerBound = detectProviderBoundSignature(request);
  const detectedLock = structuralLock || providerBound;
  const storedContinuation = scope ? store.getContinuation(scope) : null;
  const snapshot = scope ? store.snapshot(scope) : null;
  const inputTokens = estimateAutoInputTokens(request);
  const outputEstimate = estimateAutoOutputTokens(request);
  const incumbent = snapshot?.incumbent ?? null;

  // A locked continuation must retain the exact target it was locked to. The
  // stored continuation target is authoritative when present (the dispatched
  // target may have been re-recorded since); otherwise fall back to the
  // incumbent the last dispatch recorded.
  const lockedTarget: AutoContinuationTarget | null = detectedLock
    ? storedContinuation?.provider && storedContinuation.model
      ? {
          candidateId:
            storedContinuation.candidateId ??
            `${storedContinuation.provider}/${storedContinuation.model}`,
          provider: storedContinuation.provider,
          model: storedContinuation.model,
        }
      : incumbent?.provider && incumbent.model
        ? {
            candidateId: incumbent.candidateId,
            provider: incumbent.provider,
            model: incumbent.model,
          }
        : null
    : null;
  const continuationLocked = detectedLock && lockedTarget !== null;

  // Provider-bound state cannot be replayed on another provider. With no
  // recorded owner, refuse with an explicit continuation error rather than
  // pinning an arbitrary target or silently switching providers.
  if (providerBound && !lockedTarget) {
    const error = new Error(
      `Provider-bound auto continuation state has no known target for alias '${canonicalModel}'`
    ) as Error & { routingContext?: Record<string, unknown> };
    error.routingContext = {
      statusCode: 409,
      code: 'continuation_target_unavailable',
    };
    throw error;
  }

  const classification: AutoClassifierResult = continuationLocked
    ? { source: 'continuation', reason: 'continuation_locked', latencyMs: 0 }
    : await classifyAutoRequest(request, policy, signal);
  const classifierLatencyMs = classification.latencyMs ?? 0;

  if (scope) {
    store.setContinuation(
      scope,
      continuationLocked,
      sequence ?? undefined,
      undefined,
      lockedTarget ?? undefined
    );
  }

  // The incumbent is identified by the real provider/model it dispatched to,
  // matched across every leaf of each logical target (including alias-ref
  // child fallbacks). This survives a child leaf ordering change better than a
  // bare logical-target id.
  const incumbentMatches = (leaf: RouteResult): boolean => {
    if (!incumbent) return false;
    const provider = incumbent.provider;
    const model = incumbent.model;
    if (provider && model) {
      return leaf.provider === provider && leaf.model === model;
    }
    return leaf.autoProvenance?.targetKey === incumbent.candidateId;
  };

  const matchesLockedTarget = (leaf: RouteResult): boolean => {
    if (!lockedTarget) return false;
    if (lockedTarget.provider && lockedTarget.model) {
      return leaf.provider === lockedTarget.provider && leaf.model === lockedTarget.model;
    }
    return leaf.autoProvenance?.targetKey === lockedTarget.candidateId;
  };

  // A known locked target that access/quota removed from the eligible set
  // cannot be safely replaced mid-continuation.
  if (continuationLocked && !candidates.some(matchesLockedTarget)) {
    const error = new Error(
      `Auto routing continuation target is unavailable for alias '${canonicalModel}'`
    ) as Error & { routingContext?: Record<string, unknown> };
    error.routingContext = {
      statusCode: 409,
      code: 'continuation_target_unavailable',
    };
    throw error;
  }

  const groupTraces: Record<string, unknown>[] = [];
  const reasons: string[] = [];
  let fallback = false;
  let orderedCandidates = [...candidates];

  for (const group of autoGroups) {
    const groupIndex = groups.indexOf(group);
    const positions: number[] = [];
    orderedCandidates.forEach((candidate, index) => {
      if (candidate.autoProvenance?.groupIndex === groupIndex) positions.push(index);
    });
    if (positions.length === 0) {
      groupTraces.push({
        groupIndex,
        groupName: group.name,
        eligibleTargetKeys: [],
        orderedTargetKeys: [],
        reason: 'no_candidates',
      });
      continue;
    }

    const blocks = collectLogicalTargets(orderedCandidates, groupIndex);
    const observations =
      scope && snapshot
        ? mapObservationsToLogicalTargets(store, scope, blocks, prefixFingerprint, incumbentMatches)
        : {};
    const policyCandidates: AutoPolicyCandidate[] = blocks.map((block) => {
      // The incumbent's actual leaf is the representative when it is still in
      // this logical target, so its warmth/cost drive the hold; the leaf order
      // itself is preserved for dispatch and other targets.
      const representative = block.leaves.find(incumbentMatches) ?? block.leaves[0]!;
      return {
        id: block.targetKey,
        // Incomplete profiles mean "general purpose / economy", matching the
        // single-target qualification semantics. Defaults are re-applied here
        // because router provenance can carry an unparsed raw profile.
        profile: { specialties: [], ...(block.profile ?? {}) },
        provider: representative.provider,
        model: representative.model,
        pricing: toAutoPricingInput(
          representative.modelConfig?.pricing,
          representative.config.discount
        ),
        providerDiscount: representative.config.discount,
      };
    });

    const lockedBlock = blocks.find((block) => block.leaves.some(matchesLockedTarget));
    const incumbentBlock =
      lockedBlock ?? blocks.find((block) => block.leaves.some(incumbentMatches));
    const context: AutoPolicyContext = {
      judgment: classification.judgment,
      // Keep the incumbent's recorded logical-target id even when eligibility
      // removed its leaf, so the policy can trace `incumbent_unavailable`
      // instead of silently treating the request as a cold start.
      incumbentId: incumbentBlock?.targetKey ?? incumbent?.candidateId,
      previousDemand: incumbent?.previousDemand ?? undefined,
      previousRequiredTier: incumbent?.previousRequiredTier ?? undefined,
      continuationLocked,
      inputTokens,
      expectedOutputTokens: outputEstimate.expected,
      outputTokenRange: outputEstimate.range,
      observations,
      prefixFingerprint,
    };

    const ranking: AutoRankingResult = rankAutoCandidates(policyCandidates, policy, context);

    const blockByKey = new Map(blocks.map((block) => [block.targetKey, block]));
    const orderedBlocks: LogicalTargetBlock[] = [];
    // Leaves actually written back for this group. A hard continuation sets
    // this to exactly the locked leaf and empties every other group — no
    // failover and no excluded-position retention.
    let flattened: RouteResult[];
    if (continuationLocked && lockedTarget) {
      flattened = blocks.flatMap((block) => block.leaves).filter(matchesLockedTarget);
      if (lockedBlock) orderedBlocks.push(lockedBlock);
    } else {
      const used = new Set<string>();
      for (const id of ranking.orderedIds) {
        const block = blockByKey.get(id);
        if (!block || used.has(id)) continue;
        used.add(id);
        orderedBlocks.push(block);
      }
      // `ranking.orderedIds` is the complete intended order: the policy drops
      // unsuitable targets from the confident path and lists every eligible
      // target in the fallback/uncertainty paths. Nothing is re-appended, so
      // an excluded target can never survive at a stale position.
      flattened = orderedBlocks.flatMap((block) => block.leaves);
    }
    if (flattened.length === 0 && orderedBlocks.length > 0) {
      flattened = orderedBlocks.flatMap((block) => block.leaves);
    }

    // Replace this group's slice with the ordered leaves and DROP any
    // positions that are left unfilled — otherwise a stale, unsuitable or
    // non-incumbent candidate would survive at a removed position.
    const groupPositions = new Set(positions);
    const rebuilt: RouteResult[] = [];
    let inserted = false;
    orderedCandidates.forEach((candidate, index) => {
      if (!groupPositions.has(index)) {
        rebuilt.push(candidate);
        return;
      }
      if (!inserted) {
        rebuilt.push(...flattened);
        inserted = true;
      }
    });
    orderedCandidates = rebuilt;

    if (ranking.decision.fallback) fallback = true;
    reasons.push(ranking.decision.reason);

    groupTraces.push({
      groupIndex,
      groupName: group.name,
      eligibleTargetKeys: blocks.map((block) => block.targetKey),
      orderedTargetKeys: orderedBlocks.map((block) => block.targetKey),
      decision: ranking.decision,
      demand: ranking.demand,
      requiredTier: ranking.requiredTier,
      rankings: ranking.rankings,
      costEvidence: ranking.costEvidence,
    });
  }

  // A hard continuation is alias-wide: ordinary fallback groups must not stay
  // available around a locked target. Keep only the exact locked leaf.
  if (continuationLocked && lockedTarget) {
    orderedCandidates = orderedCandidates.filter(matchesLockedTarget);
  }

  // The router intentionally leaves duplicate provider/model leaves in place
  // for aliases with an auto group so a shared leaf reached by multiple
  // logical targets keeps each target's local profile through ranking. The
  // first path in the final order wins; later paths must not survive merely
  // because they share a leaf.
  orderedCandidates = dedupeFirstOccurrence(orderedCandidates);

  const decision: Record<string, unknown> = {
    version: 1,
    alias: canonicalModel,
    apiType,
    keyId,
    stateScope: scope,
    sequence,
    policy: {
      mode: policy.mode,
      classifierAlias: policy.classifier_alias,
      rubricVersion: policy.rubric_version,
      baselinePolicy: policy.baseline_policy,
    },
    judgmentSource: classification.source,
    judgmentReason: classification.reason,
    classifierLatencyMs,
    classifierCost: classification.cost ?? null,
    judgment: classification.judgment ?? null,
    continuationLocked,
    inputTokens,
    prefixFingerprint: prefixFingerprint ?? null,
    demand: groupTraces[0]?.demand ?? null,
    requiredTier: groupTraces[0]?.requiredTier ?? null,
    fallback,
    reasons,
    groups: groupTraces,
  };
  storeDecision(request, decision);

  logger.debug(
    `Auto routing for '${canonicalModel}': source=${classification.source} ` +
      `stateful=${stateful} reasons=[${reasons.join(', ')}] groups=${autoGroups.length}`
  );

  return { candidates: orderedCandidates, decision };
}

// ── Observations ────────────────────────────────────────────────────

export interface AutoObservedUsage {
  cachedTokens?: number;
  cacheWriteTokens?: number;
}

/**
 * Record the actually-dispatched target and, when provider usage is known,
 * its cache-read/write tokens against API-key-scoped state. Called only after
 * a successful dispatch so incumbent/warmth reflect reality, never the
 * proposed first choice. Does nothing without an authenticated API-key
 * identity — anonymous requests never share routing state.
 */
export function recordAutoRoutingOutcome(
  request: UnifiedChatRequest,
  route: RouteResult,
  usage?: AutoObservedUsage
): void {
  const decision = request.metadata?.plexus_metadata?.auto_routing_decision as
    | Record<string, unknown>
    | undefined;
  if (!decision) return;

  const keyId = autoKeyId(request);
  if (!keyId) return;

  const stateScope = typeof decision.stateScope === 'string' ? decision.stateScope : null;
  // Branchless requests are intentionally stateless (see applyAutoRouting), so
  // there is no scope to write to and no fallback random scope to invent.
  if (!stateScope) return;
  const sequence = typeof decision.sequence === 'number' ? decision.sequence : undefined;
  const store = AutoStateStore.getInstance();

  const previousDemand =
    typeof decision.demand === 'number' ? (decision.demand as number) : undefined;
  const previousRequiredTier =
    typeof decision.requiredTier === 'number' ? (decision.requiredTier as number) : undefined;

  store.recordIncumbent(stateScope, {
    candidateId: route.autoProvenance?.targetKey ?? `${route.provider}/${route.model}`,
    provider: route.provider,
    model: route.model,
    previousDemand,
    previousRequiredTier,
    sequence,
  });

  // A known usage report wins over prior warmth even when it is zero: a
  // completed request with no cache reads/writes must not leave an older
  // optimistic observation in place.
  if (usage) {
    // Reuse the fingerprint recorded while ranking. The live request may have
    // been rewritten in place (e.g. vision preprocessing) after ranking, so
    // recomputing it here would compare against a different prefix. Candidate
    // compaction/adapters still force the evidence to uncertain.
    const decisionFingerprint =
      typeof decision.prefixFingerprint === 'string' ? decision.prefixFingerprint : undefined;
    store.recordObservation(stateScope, `${route.provider}/${route.model}`, {
      cachedInputTokens: usage.cachedTokens ?? 0,
      cacheWriteTokens: usage.cacheWriteTokens ?? 0,
      prefixFingerprint: candidatePrefixIsOpaque(route) ? undefined : decisionFingerprint,
      sequence,
    });
  }
}

/** Extract cache token counts from a unified response, when present. */
export function autoObservedUsageFromResponse(
  response: UnifiedChatResponse | undefined
): AutoObservedUsage | undefined {
  const usage: UnifiedUsage | undefined = response?.usage;
  if (!usage) return undefined;
  // Report zero cache usage explicitly: `autoObservedUsageFromResponse` must
  // not conflate a real zero with "no usage information", or an older warmth
  // observation would survive a request that reported no cache use.
  return {
    cachedTokens: usage.cached_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_tokens ?? 0,
  };
}
