/**
 * Auto-routing preview slice.
 *
 * Simulates the pure auto policy against an *unsaved* alias draft plus the
 * current configured alias graph. It never dispatches a generation request and
 * never mutates global config, the database, the production incumbent, warmth,
 * or continuation state. A preview classifier call may still cost money and is
 * reported as an explicit simulation.
 *
 * The judgment handle cache below is private to previews. Handles are bound to
 * the server-derived admin context, the alias, the sample context fingerprint,
 * and the classifier binding/rubric. A supplied handle that does not match is
 * rejected rather than silently reclassified (which would spend money).
 *
 * The classifier is the shared `auto-classifier.ts` module, keyed by a
 * synthetic request whose `plexus_key_id` is the server-derived admin context.
 * Tests can override `classify`/`lookupJudgment` through `AutoPreviewDeps`.
 */

import { z } from 'zod';
import type { AutoCapabilityTier, AutoRoutingConfig, AutoTargetProfile } from '@plexus/shared';
import type { UnifiedChatRequest } from '../../types/unified';
import type {
  ModelConfig,
  ModelTarget,
  ModelTargetGroup,
  ProviderConfig,
  PlexusConfig,
} from '../../config';
import { assertNoAliasRefCycles, assertAutoRoutingConfigValid, getConfig } from '../../config';
import type {
  AutoCostEstimate,
  AutoJudgment,
  AutoPricingInput,
  AutoPolicyCandidate,
  AutoPolicyContext,
  AutoRankingResult,
} from './auto-policy';
import { estimateAutoCandidateCost, rankAutoCandidates, validateAutoJudgment } from './auto-policy';
import { SelectorFactory } from './selectors/factory';
import type { EnrichedModelTarget } from './selectors/base';
import {
  classifyAutoRequest,
  lookupAutoJudgmentForHandle,
  type AutoClassifierResult,
  type AutoJudgmentSource,
} from './auto-classifier';

export const AUTO_PREVIEW_MAX_PROMPT_CHARS = 32_000;
export const AUTO_PREVIEW_MAX_INPUT_TOKENS = 10_000_000;
/** Per-logical-target leaf expansion cap so a wide alias graph cannot blow up. */
const AUTO_PREVIEW_MAX_LEAVES_PER_TARGET = 64;
const AUTO_PREVIEW_MAX_ALIAS_DEPTH = 8;
/** Rough characters-per-token used only when the caller omits `input_tokens`. */
const AUTO_PREVIEW_CHARS_PER_TOKEN_ESTIMATE = 4;
/**
 * Conservative output-token estimate when the preview has no `max_tokens`
 * ceiling. Mirrors the runtime default in `auto-router.ts` so preview and
 * inference cost economics agree.
 */
const AUTO_PREVIEW_DEFAULT_OUTPUT_TOKENS = 512;

// ── Request validation ──────────────────────────────────────────────

export const AutoPreviewScenarioSchema = z
  .object({
    incumbent: z
      .object({
        provider: z.string().min(1).max(256),
        model: z.string().min(1).max(512),
      })
      .strict()
      .optional(),
    input_tokens: z.number().finite().int().min(0).max(AUTO_PREVIEW_MAX_INPUT_TOKENS).optional(),
    cache_state: z.enum(['cold', 'warm', 'unknown']).optional(),
  })
  .strict();

export const AutoPreviewRequestSchema = z
  .object({
    alias: z.unknown(),
    alias_name: z.string().min(1).max(512).optional(),
    prompt: z.string().min(1).max(AUTO_PREVIEW_MAX_PROMPT_CHARS),
    judgment_handle: z.string().min(1).max(256).optional(),
    scenario: AutoPreviewScenarioSchema.optional(),
  })
  .strict();

export type AutoPreviewScenario = z.infer<typeof AutoPreviewScenarioSchema>;

export class AutoPreviewError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
    public readonly code: string = 'invalid_request'
  ) {
    super(message);
    this.name = 'AutoPreviewError';
  }
}

// ── Classifier seam ──────────────────────────────────────────────

/**
 * Minimal synthetic request used to key the shared classifier's judgment
 * handle/cache. The admin context is server-derived (never from the request
 * body) and is carried as `plexus_key_id`; the server-owned
 * `plexus_auto_purpose: 'preview'` discriminator keeps preview scopes and
 * accounting separate from every production API-key scope.
 */
export function buildPreviewClassifierRequest(
  aliasName: string,
  prompt: string,
  adminContext: string
): UnifiedChatRequest {
  return {
    model: aliasName,
    messages: [{ role: 'user', content: prompt }],
    incomingApiType: 'chat',
    metadata: {
      plexus_metadata: { plexus_key_id: adminContext, plexus_auto_purpose: 'preview' },
    },
  };
}

export interface AutoPreviewClassifierDeps {
  classify(
    request: UnifiedChatRequest,
    config: AutoRoutingConfig,
    signal?: AbortSignal
  ): Promise<AutoClassifierResult>;
  lookupJudgment(
    handle: string,
    request: UnifiedChatRequest,
    config: AutoRoutingConfig
  ): AutoJudgment | undefined;
}

function defaultClassifierDeps(): AutoPreviewClassifierDeps {
  return {
    classify: classifyAutoRequest,
    lookupJudgment: lookupAutoJudgmentForHandle,
  };
}

function mapClassifierSource(source: AutoJudgmentSource): AutoPreviewAnalysis['source'] {
  switch (source) {
    case 'fresh':
      return 'fresh';
    case 'exact_cache':
      return 'cache';
    case 'continuation':
      return 'continuation';
    default:
      return 'unavailable';
  }
}

// ── Target graph ────────────────────────────────────────────────────

export interface AutoPreviewLeafResult {
  id: string;
  provider: string;
  model: string;
  eligible: boolean;
  reason: string | null;
  /** Alias chain that produced this leaf, outer-most first. */
  provenance: string[];
}

export interface AutoPreviewLogicalTarget {
  id: string;
  provider?: string;
  model?: string;
  alias?: string;
  profile: AutoTargetProfile | null;
  pricing?: AutoPricingInput;
  declaredIndex: number;
  leaves: AutoPreviewLeafResult[];
}

export interface AutoPreviewGroupPlan {
  name: string;
  selector: string;
  targets: AutoPreviewLogicalTarget[];
}

function groupsOf(model: ModelConfig): ModelTargetGroup[] {
  if (model.target_groups) return model.target_groups;
  if (model.targets) {
    return [{ name: 'default', selector: model.selector ?? 'random', targets: model.targets }];
  }
  return [];
}

function resolveConfiguredAlias(
  config: PlexusConfig,
  name: string
): { slug: string; model: ModelConfig } | null {
  const direct = config.models?.[name];
  if (direct) return { slug: name, model: direct };
  for (const [slug, model] of Object.entries(config.models ?? {})) {
    if (model?.additional_aliases?.includes(name)) return { slug, model };
  }
  return null;
}

function normalizeProfile(profile: AutoTargetProfile | undefined): AutoTargetProfile | null {
  if (!profile) return null;
  return { ...profile, specialties: profile.specialties ?? [] };
}

function findModelPricing(provider: ProviderConfig | undefined, model: string): AutoPricingInput {
  if (!provider || Array.isArray(provider.models)) return undefined;
  return provider.models?.[model]?.pricing as AutoPricingInput;
}

function concreteLeaf(
  config: PlexusConfig,
  target: ModelTarget,
  provenance: string[]
): AutoPreviewLeafResult {
  const provider = target.provider ?? '';
  const model = target.model ?? '';
  const id = `${provider}/${model}`;
  if (target.enabled === false) {
    return { id, provider, model, eligible: false, reason: 'disabled', provenance };
  }
  const providerConfig = config.providers?.[provider];
  if (!providerConfig) {
    return { id, provider, model, eligible: false, reason: 'unknown_provider', provenance };
  }
  if (providerConfig.enabled === false) {
    return { id, provider, model, eligible: false, reason: 'provider_disabled', provenance };
  }
  return { id, provider, model, eligible: true, reason: null, provenance };
}

function isEligibleConcrete(config: PlexusConfig, target: ModelTarget): boolean {
  if (target.enabled === false) return false;
  if (!target.provider || !target.model) return false;
  const providerConfig = config.providers?.[target.provider];
  return !!providerConfig && providerConfig.enabled !== false;
}

function enrichForSelector(config: PlexusConfig, target: ModelTarget): EnrichedModelTarget {
  const providerConfig = target.provider ? config.providers?.[target.provider] : undefined;
  const modelConfig =
    providerConfig && providerConfig.models && !Array.isArray(providerConfig.models) && target.model
      ? providerConfig.models[target.model]
      : undefined;
  return { ...target, route: { modelConfig } };
}

/**
 * Order a group's concrete targets with the same ordinary selector the router
 * uses. Selectors that need runtime services are reused when the registry can
 * construct them; otherwise preview keeps declared order and records an
 * assumption rather than mutating global state or failing the request.
 */
async function orderBySelector(
  selectorType: string,
  targets: ModelTarget[]
): Promise<{ ordered: ModelTarget[]; applied: boolean }> {
  if (targets.length === 0) return { ordered: [], applied: true };
  let selector;
  try {
    selector = SelectorFactory.getSelector(selectorType);
  } catch {
    return { ordered: [...targets], applied: false };
  }
  const ordered: ModelTarget[] = [];
  const remaining = [...targets];
  while (remaining.length > 0) {
    const selected = await selector.select(remaining);
    if (!selected) break;
    ordered.push(selected);
    const index = remaining.findIndex(
      (candidate) => candidate.provider === selected.provider && candidate.model === selected.model
    );
    if (index >= 0) remaining.splice(index, 1);
    else remaining.shift();
  }
  ordered.push(...remaining);
  return { ordered, applied: true };
}

/**
 * Deployment order for one ordinary group: selector-ordered eligible concrete
 * targets, then ineligible concrete targets (kept for explanation), then
 * alias-ref fallback chains in declared order. Mirrors the router's
 * `buildGroupCandidates` ordering.
 */
async function orderOrdinaryGroupTargets(
  config: PlexusConfig,
  group: ModelTargetGroup,
  aliasLabel: string,
  notes: string[]
): Promise<ModelTarget[]> {
  const concrete = group.targets.filter((target) => !target.alias);
  const aliasTargets = group.targets.filter((target) => target.alias);
  const eligible = concrete.filter((target) => isEligibleConcrete(config, target));
  const ineligible = concrete.filter((target) => !isEligibleConcrete(config, target));
  const { ordered, applied } = await orderBySelector(
    group.selector,
    eligible.map((target) => enrichForSelector(config, target))
  );
  if (!applied) {
    notes.push(
      `Alias '${aliasLabel}' group '${group.name}' uses selector '${group.selector}', which preview cannot initialize; its leaves use declared order.`
    );
  }
  return [...ordered, ...ineligible, ...aliasTargets];
}

async function collectAliasLeaves(
  config: PlexusConfig,
  aliasName: string,
  visited: Set<string>,
  depth: number,
  provenance: string[],
  cap: { remaining: number },
  notes: string[]
): Promise<AutoPreviewLeafResult[]> {
  if (cap.remaining <= 0) return [];
  const terminal = (reason: string): AutoPreviewLeafResult[] => [
    {
      id: `alias:${aliasName}`,
      provider: '',
      model: '',
      eligible: false,
      reason,
      provenance,
    },
  ];
  if (depth > AUTO_PREVIEW_MAX_ALIAS_DEPTH || visited.has(aliasName)) {
    return terminal(visited.has(aliasName) ? 'alias_cycle' : 'alias_depth_exceeded');
  }
  const resolved = resolveConfiguredAlias(config, aliasName);
  if (!resolved) return terminal('unknown_alias');

  const nextVisited = new Set(visited);
  nextVisited.add(aliasName);
  const leaves: AutoPreviewLeafResult[] = [];
  const push = (leaf: AutoPreviewLeafResult): boolean => {
    if (cap.remaining <= 0) return false;
    leaves.push(leaf);
    cap.remaining -= 1;
    return true;
  };

  for (const group of groupsOf(resolved.model)) {
    if (cap.remaining <= 0) break;
    const ordered = await orderOrdinaryGroupTargets(config, group, resolved.slug, notes);
    for (const target of ordered) {
      if (cap.remaining <= 0) break;
      if (target.alias) {
        if (target.enabled === false) {
          push({
            id: `alias:${target.alias}`,
            provider: '',
            model: '',
            eligible: false,
            reason: 'disabled',
            provenance: [...provenance, target.alias],
          });
          continue;
        }
        const nested = await collectAliasLeaves(
          config,
          target.alias,
          nextVisited,
          depth + 1,
          [...provenance, target.alias],
          cap,
          notes
        );
        leaves.push(...nested);
      } else {
        push(concreteLeaf(config, target, provenance));
      }
    }
  }

  if (leaves.length === 0) return terminal('empty_alias');
  return leaves;
}

async function buildGroupPlans(
  draft: ModelConfig,
  aliasName: string,
  config: PlexusConfig
): Promise<{ plans: AutoPreviewGroupPlan[]; selectorNotes: string[] }> {
  const models = config.models ?? {};
  // Graph/cycle/nested-auto validation against the unsaved draft merged into
  // the configured graph. These throw plain Errors; the caller maps them.
  assertNoAliasRefCycles({ ...models, [aliasName]: draft });
  assertAutoRoutingConfigValid({ ...models, [aliasName]: draft });

  const plans: AutoPreviewGroupPlan[] = [];
  const selectorNotes: string[] = [];
  for (const group of groupsOf(draft)) {
    const orderedTargets =
      group.selector === 'auto'
        ? group.targets
        : await orderOrdinaryGroupTargets(config, group, aliasName, selectorNotes);
    const targets: AutoPreviewLogicalTarget[] = [];
    let declaredIndex = 0;
    for (const target of orderedTargets) {
      if (target.alias) {
        const resolved = resolveConfiguredAlias(config, target.alias);
        // Nested auto is rejected in every mode here, not only active mode.
        if (resolved && groupsOf(resolved.model).some((g) => g.selector === 'auto')) {
          throw new AutoPreviewError(
            `Auto routing target 'alias:${target.alias}' uses auto routing; nested auto aliases are not supported`,
            400,
            'nested_auto_alias'
          );
        }
        const cap = { remaining: AUTO_PREVIEW_MAX_LEAVES_PER_TARGET };
        const leaves =
          target.enabled === false
            ? [
                {
                  id: `alias:${target.alias}`,
                  provider: '',
                  model: '',
                  eligible: false,
                  reason: 'disabled',
                  provenance: [target.alias],
                },
              ]
            : await collectAliasLeaves(
                config,
                target.alias,
                new Set(),
                0,
                [target.alias],
                cap,
                selectorNotes
              );
        const firstEligible = leaves.find((leaf) => leaf.eligible);
        targets.push({
          id: `alias:${target.alias}`,
          alias: target.alias,
          profile: normalizeProfile(target.auto_profile),
          pricing: firstEligible
            ? findModelPricing(config.providers?.[firstEligible.provider], firstEligible.model)
            : undefined,
          declaredIndex: declaredIndex++,
          leaves,
        });
      } else if (target.provider && target.model) {
        const leaf = concreteLeaf(config, target, []);
        targets.push({
          id: `${target.provider}/${target.model}`,
          provider: target.provider,
          model: target.model,
          profile: normalizeProfile(target.auto_profile),
          pricing: findModelPricing(config.providers?.[target.provider], target.model),
          declaredIndex: declaredIndex++,
          leaves: [leaf],
        });
      }
    }
    plans.push({ name: group.name, selector: group.selector, targets });
  }
  return { plans, selectorNotes };
}

// ── Response shaping ────────────────────────────────────────────────

export interface AutoPreviewAnalysis {
  judgment?: AutoJudgment;
  source: 'fresh' | 'cache' | 'continuation' | 'unavailable';
  reason?: string;
  latencyMs: number;
  cost?: number | null;
}

export interface AutoPreviewTargetResult {
  id: string;
  provider?: string;
  model?: string;
  alias?: string;
  profile?: AutoTargetProfile | null;
  rank?: number;
  eligible?: boolean;
  suitable?: boolean;
  reason?: string;
  decision?: string;
  requiredTier?: AutoCapabilityTier;
  demand?: number;
  preference?: number;
  estimatedCostUsd?: number | null;
  cacheState?: 'cold' | 'warm' | 'unknown';
  leaves?: AutoPreviewLeafResult[];
}

export interface AutoPreviewGroupResult {
  name: string;
  decision: string;
  targets: AutoPreviewTargetResult[];
}

export interface AutoPreviewResponse {
  judgment_handle?: string;
  analysis: AutoPreviewAnalysis;
  groups: AutoPreviewGroupResult[];
  assumptions: string[];
}

function cacheStateFor(
  target: AutoPreviewLogicalTarget,
  costEvidence: Record<string, AutoCostEstimate> | null,
  scenario: AutoPreviewScenario | undefined
): 'cold' | 'warm' | 'unknown' {
  const evidence = costEvidence?.[target.id];
  if (evidence) return evidence.warmth === 'uncertain' ? 'unknown' : evidence.warmth;
  if (scenario?.cache_state === 'warm') return 'warm';
  if (scenario?.cache_state === 'unknown') return 'unknown';
  return 'cold';
}

function targetResult(
  target: AutoPreviewLogicalTarget,
  ranking: AutoRankingResult | null,
  order: number | undefined,
  scenario: AutoPreviewScenario | undefined,
  eligible: boolean,
  costEvidence: Record<string, AutoCostEstimate> | null
): AutoPreviewTargetResult {
  const ranked = ranking?.rankings.find((entry) => entry.id === target.id);
  const cost = costEvidence?.[target.id];
  const result: AutoPreviewTargetResult = {
    id: target.id,
    provider: target.provider,
    model: target.model,
    alias: target.alias,
    profile: target.profile,
    eligible,
    cacheState: cacheStateFor(target, costEvidence, scenario),
    leaves: target.leaves,
  };
  if (order !== undefined) result.rank = order;
  if (ranking && ranking.demand !== null) result.demand = ranking.demand;
  if (ranking && ranking.requiredTier !== null)
    result.requiredTier = tierName(ranking.requiredTier);
  if (ranked) {
    result.suitable = ranked.suitable;
    result.preference = ranked.preference ?? undefined;
    result.reason = ranked.exclusion ?? undefined;
  }
  if (cost && cost.known && cost.expectedUsd !== null) {
    result.estimatedCostUsd = cost.expectedUsd;
  } else if (cost) {
    result.estimatedCostUsd = null;
  }
  return result;
}

// ── Orchestrator ────────────────────────────────────────────────────

export interface AutoPreviewInput {
  draft: ModelConfig;
  aliasName?: string;
  prompt: string;
  judgmentHandle?: string;
  scenario?: AutoPreviewScenario;
  /** Server-derived identity. Defaults to the safe `admin-preview` scope. */
  adminContext?: string;
  /** Injectable clock for deterministic tests. */
  now?: number;
}

export interface AutoPreviewDeps {
  classifier?: Partial<AutoPreviewClassifierDeps>;
  config?: PlexusConfig;
  signal?: AbortSignal;
}

interface ResolvedScenario {
  inputTokens: number;
  expectedOutputTokens: number;
  outputTokenRange: { lower: number; upper: number };
  incumbentId?: string;
  observations?: AutoPolicyContext['observations'];
  prefixFingerprint?: string;
  assumptions: string[];
}

/** Synthetic prefix used only to model an explicitly-warm preview scenario. */
const AUTO_PREVIEW_SIMULATED_PREFIX = 'auto-preview-simulated-prefix';

/**
 * Bounded output-token estimate mirroring the runtime default. The preview has
 * no `max_tokens` ceiling, so it uses the conservative 512-token point estimate
 * and a plausible 0.5x-1.5x range so economic sliders are testable.
 */
function estimatePreviewOutputTokens(): {
  expected: number;
  range: { lower: number; upper: number };
} {
  const expected = AUTO_PREVIEW_DEFAULT_OUTPUT_TOKENS;
  return {
    expected,
    range: { lower: Math.floor(expected * 0.5), upper: Math.ceil(expected * 1.5) },
  };
}

function resolveScenario(
  scenario: AutoPreviewScenario | undefined,
  prompt: string,
  candidates: AutoPolicyCandidate[],
  logicalById: Map<string, AutoPreviewLogicalTarget>,
  incumbentRelevant: boolean
): ResolvedScenario {
  const assumptions: string[] = [
    'Preview never dispatches a generation request; a classifier call may still cost money.',
    'Provider cooldown, concurrency, and quota health are not consulted for preview eligibility.',
  ];
  const estimated = Math.max(1, Math.ceil(prompt.length / AUTO_PREVIEW_CHARS_PER_TOKEN_ESTIMATE));
  const inputTokens = scenario?.input_tokens ?? estimated;
  if (scenario?.input_tokens === undefined) {
    assumptions.push(
      `input_tokens was not supplied; estimated ${inputTokens} tokens from the sample prompt length.`
    );
  }

  const outputEstimate = estimatePreviewOutputTokens();
  assumptions.push(
    `Output tokens are estimated at ${outputEstimate.expected} (plausible range ` +
      `${outputEstimate.range.lower}-${outputEstimate.range.upper}) because preview has no ` +
      'max_tokens ceiling; cost estimates use this bound.'
  );

  let incumbentId: string | undefined;
  if (incumbentRelevant && scenario?.incumbent) {
    const { provider, model } = scenario.incumbent;
    const match = [...logicalById.values()].find((target) =>
      target.leaves.some((leaf) => leaf.provider === provider && leaf.model === model)
    );
    if (match) {
      incumbentId = match.id;
    } else {
      assumptions.push(
        `scenario.incumbent ${provider}/${model} is not reachable from this alias; ignored.`
      );
    }
  }

  let observations: AutoPolicyContext['observations'];
  let prefixFingerprint: string | undefined;
  if (scenario?.cache_state === 'warm') {
    observations = {};
    prefixFingerprint = AUTO_PREVIEW_SIMULATED_PREFIX;
    for (const candidate of candidates) {
      observations[candidate.id] = {
        cachedInputTokens: inputTokens,
        cacheWriteTokens: 0,
        prefixFingerprint: AUTO_PREVIEW_SIMULATED_PREFIX,
      };
    }
    assumptions.push(
      `cache_state=warm assumes all ${inputTokens} input tokens are a cache read hit for every target; ` +
        'this is a simulation assumption, not measured provider cache behavior.'
    );
  } else if (scenario?.cache_state === 'cold') {
    assumptions.push(
      'cache_state=cold assumes no cached input for any target; this is a simulation assumption.'
    );
  } else if (scenario?.cache_state === 'unknown') {
    observations = {};
    for (const candidate of candidates) {
      observations[candidate.id] = { cachedInputTokens: 0, cacheWriteTokens: 0 };
    }
    assumptions.push(
      'cache_state=unknown makes cache economics uncertain, so cache savings cannot drive a switch.'
    );
  }

  assumptions.push(
    'Child alias leaves use the child alias ordinary selector where preview can initialize it; ' +
      'health, concurrency, and quota filtering is not simulated.'
  );

  return {
    inputTokens,
    expectedOutputTokens: outputEstimate.expected,
    outputTokenRange: outputEstimate.range,
    incumbentId,
    observations,
    prefixFingerprint,
    assumptions,
  };
}

async function resolveJudgment(
  config: AutoRoutingConfig,
  adminContext: string,
  aliasName: string,
  prompt: string,
  judgmentHandle: string | undefined,
  deps: AutoPreviewClassifierDeps,
  signal: AbortSignal
): Promise<{
  judgment: AutoJudgment | null;
  source: AutoPreviewAnalysis['source'];
  reason?: string;
  latencyMs: number;
  cost?: number | null;
  handle?: string;
}> {
  const request = buildPreviewClassifierRequest(aliasName, prompt, adminContext);

  if (judgmentHandle) {
    const judgment = deps.lookupJudgment(judgmentHandle, request, config);
    if (!judgment) {
      throw new AutoPreviewError(
        'judgment_handle is not valid for this admin, sample context, or classifier/rubric; refusing to reclassify',
        400,
        'invalid_judgment_handle'
      );
    }
    return {
      judgment,
      source: 'cache',
      reason: 'reused cached judgment',
      latencyMs: 0,
      cost: null,
      handle: judgmentHandle,
    };
  }

  const result = await deps.classify(request, config, signal);
  if (result.judgment) {
    const validated = validateAutoJudgment(result.judgment);
    if (!validated) {
      throw new AutoPreviewError(
        'Classifier returned a malformed judgment; refusing to substitute a plausible one',
        502,
        'invalid_judgment'
      );
    }
    return {
      judgment: validated,
      source: mapClassifierSource(result.source),
      reason: result.reason,
      latencyMs: result.latencyMs,
      cost: result.cost ?? null,
      handle: result.handle,
    };
  }
  return {
    judgment: null,
    source: mapClassifierSource(result.source),
    reason: result.reason,
    latencyMs: result.latencyMs,
    cost: result.cost ?? null,
  };
}

/**
 * Run the auto policy against an unsaved draft without side effects.
 * Throws `AutoPreviewError` for invalid requests/handles/classifier output.
 */
export async function previewAutoRouting(
  input: AutoPreviewInput,
  deps: AutoPreviewDeps = {}
): Promise<AutoPreviewResponse> {
  const config = deps.config ?? getConfig();
  const aliasName = input.aliasName ?? '__preview__';
  const adminContext = input.adminContext ?? 'admin-preview';
  const now = input.now ?? Date.now();
  const signal = deps.signal ?? new AbortController().signal;
  const draft = input.draft;

  const autoRouting = draft.auto_routing;
  const autoActive = autoRouting?.mode === 'active';

  let plansResult: { plans: AutoPreviewGroupPlan[]; selectorNotes: string[] };
  try {
    plansResult = await buildGroupPlans(draft, aliasName, config);
  } catch (error) {
    if (error instanceof AutoPreviewError) throw error;
    throw new AutoPreviewError(
      error instanceof Error ? error.message : 'Invalid auto alias graph',
      400,
      'invalid_auto_graph'
    );
  }
  const { plans, selectorNotes } = plansResult;
  if (!plans.some((plan) => plan.selector === 'auto')) {
    throw new AutoPreviewError(
      'The alias draft has no auto selector group to preview',
      400,
      'no_auto_group'
    );
  }

  // ── Classify / reuse exactly once (active mode only) ────────────
  const classifierDeps: AutoPreviewClassifierDeps = {
    ...defaultClassifierDeps(),
    ...deps.classifier,
  };
  const classification: Awaited<ReturnType<typeof resolveJudgment>> = autoActive
    ? await resolveJudgment(
        autoRouting!,
        adminContext,
        aliasName,
        input.prompt,
        input.judgmentHandle,
        classifierDeps,
        signal
      )
    : {
        judgment: null,
        source: 'unavailable',
        reason: 'auto_off',
        latencyMs: 0,
        cost: null,
      };

  const assumptionSet = new Set<string>(selectorNotes);

  const groups: AutoPreviewGroupResult[] = [];

  // Classify once; reuse the judgment across every auto group. Emit groups in
  // the draft's configured priority order so ordinary fallback groups keep
  // their position rather than being pushed to the end.
  for (const plan of plans) {
    const isAuto = plan.selector === 'auto';
    const logicalById = new Map(plan.targets.map((target) => [target.id, target]));
    const candidates: AutoPolicyCandidate[] = plan.targets
      .filter((target) => target.leaves.some((leaf) => leaf.eligible))
      .map((target) => {
        const representative = target.leaves.find((leaf) => leaf.eligible);
        const provider = target.provider ?? representative?.provider ?? '';
        const model = target.model ?? representative?.model ?? '';
        return {
          id: target.id,
          profile: target.profile ?? { specialties: [] },
          provider,
          model,
          pricing: target.pricing,
          providerDiscount: config.providers?.[provider]?.discount,
        };
      });

    const scenario = resolveScenario(input.scenario, input.prompt, candidates, logicalById, isAuto);
    for (const line of scenario.assumptions) assumptionSet.add(line);
    const context: AutoPolicyContext = {
      judgment: classification.judgment ?? undefined,
      incumbentId: scenario.incumbentId,
      inputTokens: scenario.inputTokens,
      expectedOutputTokens: scenario.expectedOutputTokens,
      outputTokenRange: scenario.outputTokenRange,
      observations: scenario.observations,
      prefixFingerprint: scenario.prefixFingerprint,
      now,
    };

    if (!isAuto) {
      // Ordinary fallback groups keep their selector/declared order but still
      // report the same unknown-price-aware cost estimates as auto targets.
      const costEvidence: Record<string, AutoCostEstimate> = {};
      for (const candidate of candidates) {
        costEvidence[candidate.id] = estimateAutoCandidateCost(candidate, context);
      }
      groups.push({
        name: plan.name,
        decision: 'unqualified_group_fallback',
        targets: plan.targets.map((target) =>
          targetResult(
            target,
            null,
            undefined,
            input.scenario,
            target.leaves.some((leaf) => leaf.eligible),
            costEvidence
          )
        ),
      });
      continue;
    }

    const ranking = rankAutoCandidates(candidates, autoRouting, context);
    const orderIndex = new Map(ranking.orderedIds.map((id, index) => [id, index + 1]));

    const orderedTargets: AutoPreviewTargetResult[] = [];
    for (const target of plan.targets) {
      const eligible = target.leaves.some((leaf) => leaf.eligible);
      orderedTargets.push(
        targetResult(
          target,
          ranking,
          orderIndex.get(target.id),
          input.scenario,
          eligible,
          ranking.costEvidence
        )
      );
    }
    orderedTargets.sort((a, b) => {
      const ra = a.rank ?? Number.MAX_SAFE_INTEGER;
      const rb = b.rank ?? Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      const ia = logicalById.get(a.id)?.declaredIndex ?? 0;
      const ib = logicalById.get(b.id)?.declaredIndex ?? 0;
      return ia - ib;
    });

    for (const target of orderedTargets) {
      if (target.id === ranking.decision.chosenId) {
        target.decision = ranking.decision.fallback ? 'fallback' : 'chosen';
      } else if (target.id === ranking.decision.incumbentId) {
        target.decision = 'hold';
      }
    }

    groups.push({ name: plan.name, decision: ranking.decision.reason, targets: orderedTargets });
  }

  if (classification.source === 'unavailable') {
    assumptionSet.add(
      'Classification was unavailable; the preview uses the uncertainty/baseline path without a judgment.'
    );
  }

  return {
    judgment_handle: classification.handle,
    analysis: {
      judgment: classification.judgment ?? undefined,
      source: classification.source,
      reason: classification.reason,
      latencyMs: classification.latencyMs,
      cost: classification.cost,
    },
    groups,
    assumptions: [...assumptionSet],
  };
}

function tierName(rank: number): AutoCapabilityTier {
  const tiers: AutoCapabilityTier[] = ['economy', 'standard', 'high', 'premium'];
  return tiers[Math.max(0, Math.min(tiers.length - 1, Math.round(rank)))]!;
}
