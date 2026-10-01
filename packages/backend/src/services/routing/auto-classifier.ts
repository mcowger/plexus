/**
 * Internal auto-routing classifier lifecycle: obtains one validated
 * `AutoJudgment` per request via a bounded, typed Decisions call to an
 * administrator-authorized classifier alias.
 *
 * Owns continuation reuse, exact-cache + single-flight, a circuit breaker and
 * concurrency gate, one total deadline with parent cancellation, strict answer
 * validation, child usage/quota accounting, and preview judgment handles.
 * It reads no prices or candidate models and never inherits the caller's chat
 * access policy onto the child request.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { AutoRoutingConfig } from '@plexus/shared';
import type { DecisionsQuestion } from '../../types/decisions';
import type {
  UnifiedChatRequest,
  UnifiedDecisionsRequest,
  UnifiedDecisionsResponse,
} from '../../types/unified';
import type { UsageRecord } from '../../types/usage';
import { getConfig, type ModelConfig } from '../../config';
import { logger } from '../../utils/logger';
import { calculateCosts } from '../../utils/calculate-costs';
import { UsageStorageService } from '../observability/usage-storage';
import { QuotaEnforcer, type QuotaContext } from '../quota/quota-enforcer';
import { DebugManager } from '../observability/debug-manager';
import { runInRequestContext } from '../observability/request-context';
import { AUTO_TASK_KINDS, validateAutoJudgment, type AutoJudgment } from './auto-policy';
import { deriveAutoSessionBranch } from './auto-session';

// ── Public contract ─────────────────────────────────────────────────

export type AutoJudgmentSource = 'fresh' | 'exact_cache' | 'continuation' | 'unavailable';

export interface AutoClassifierResult {
  /** Absent when no judgment was produced; callers fall back to baseline. */
  judgment?: AutoJudgment;
  source: AutoJudgmentSource;
  /** Stable reason code; never raw prompt text. */
  reason?: string;
  latencyMs: number;
  /** Classifier cost in USD; `undefined` is unknown, never zero. */
  cost?: number;
  /** Reusable handle bound to API key + context + classifier + rubric. */
  handle?: string;
}

export interface AutoClassifierDispatcher {
  dispatchDecisions(
    request: UnifiedDecisionsRequest,
    signal?: AbortSignal,
    resolveTimeoutMs?: (timeoutMs?: number | null) => number
  ): Promise<UnifiedDecisionsResponse>;
}

export interface AutoClassifierUsageRecorder {
  saveRequest(record: UsageRecord): Promise<void> | void;
}

export interface AutoClassifierQuotaRecorder {
  loadQuotaContext(keyName: string): Promise<QuotaContext | null>;
  recordUsage(
    keyName: string,
    finalProvider: string,
    finalModel: string,
    usage: Partial<UsageRecord>
  ): Promise<void> | void;
}

export interface AutoClassifierDependencies {
  getModels(): Record<string, ModelConfig> | undefined;
  createDispatcher(): Promise<AutoClassifierDispatcher>;
  getUsageRecorder(): AutoClassifierUsageRecorder | undefined;
  getQuotaRecorder(): AutoClassifierQuotaRecorder | undefined;
  now(): number;
}

export interface AutoClassifierScope {
  keyId: string;
  /** Whether this is a production inference scope or an admin preview scope. */
  purpose: AutoRequestPurpose;
  classifierAlias: string;
  /** Hash of the classifier's reachable provider/model binding (no secrets). */
  classifierFingerprint: string;
  rubricVersion: number;
  contextFingerprint: string;
  /** Opaque hash of the exact scope; doubles as the cache key + handle. */
  handle: string;
}

/** Server-owned request purpose. Only the admin preview path sets `preview`. */
export type AutoRequestPurpose = 'inference' | 'preview';

// ── Tunables (process-local, bounded) ───────────────────────────────

const EXACT_CACHE_MAX_ENTRIES = 200;
const EXACT_CACHE_TTL_MS = 5 * 60 * 1000;
const SESSION_CACHE_MAX_ENTRIES = 200;
const SESSION_CACHE_TTL_MS = 30 * 60 * 1000;
const BREAKER_FAILURE_THRESHOLD = 3;
const BREAKER_RESET_MS = 30 * 1000;
const MAX_CONCURRENT_CLASSIFICATIONS = 4;
const DEFAULT_DEADLINE_MS = 500;
const MAX_CONTEXT_MESSAGES = 8;
const MAX_MESSAGE_CHARS = 800;
const MAX_CONTEXT_CHARS = 6000;
const MAX_CLASSIFIER_GRAPH_NODES = 64;
const MAX_CLASSIFIER_GRAPH_DEPTH = 8;

class TtlLruCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
    private readonly now: () => number
  ) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

interface BreakerState {
  failures: number;
  openedAt: number | null;
}

let sharedUsageRecorder: AutoClassifierUsageRecorder | undefined;
let sharedQuotaRecorder: AutoClassifierQuotaRecorder | undefined;

function defaultUsageRecorder(): AutoClassifierUsageRecorder | undefined {
  if (!sharedUsageRecorder) {
    try {
      sharedUsageRecorder = new UsageStorageService();
    } catch (error) {
      logger.warn(`Auto classifier could not create usage recorder: ${String(error)}`);
    }
  }
  return sharedUsageRecorder;
}

function defaultQuotaRecorder(): AutoClassifierQuotaRecorder | undefined {
  if (!sharedQuotaRecorder) {
    try {
      sharedQuotaRecorder = new QuotaEnforcer();
    } catch (error) {
      logger.warn(`Auto classifier could not create quota recorder: ${String(error)}`);
    }
  }
  return sharedQuotaRecorder;
}

function createDefaultDependencies(): AutoClassifierDependencies {
  let dispatcher: AutoClassifierDispatcher | undefined;
  return {
    getModels: () => getConfig().models,
    createDispatcher: async () => {
      if (dispatcher) return dispatcher;
      const { Dispatcher } = await import('../dispatch/dispatcher');
      dispatcher = new Dispatcher();
      return dispatcher;
    },
    getUsageRecorder: defaultUsageRecorder,
    getQuotaRecorder: defaultQuotaRecorder,
    now: () => Date.now(),
  };
}

interface SingleflightEntry {
  promise: Promise<AutoClassifierResult>;
  /** Aborted when the last waiter leaves; stops otherwise-wasted dispatch. */
  sharedController: AbortController;
  waiters: number;
}

let dependencies: AutoClassifierDependencies = createDefaultDependencies();
let exactCache = newCache<AutoJudgment>(EXACT_CACHE_MAX_ENTRIES, EXACT_CACHE_TTL_MS);
let sessionCache = newCache<AutoJudgment>(SESSION_CACHE_MAX_ENTRIES, SESSION_CACHE_TTL_MS);
const singleflight = new Map<string, SingleflightEntry>();
const pendingAccounting = new Set<Promise<unknown>>();
/** Circuit breakers are per classifier alias so one bad alias cannot block others. */
const breakers = new Map<string, BreakerState>();
const MAX_CLASSIFIER_BREAKERS = 64;
let inFlightCount = 0;

/** Keep background accounting observable and rejected-safe for shutdown/tests. */
function trackAccounting(promise: Promise<unknown>): void {
  const tracked = promise.then(
    () => undefined,
    () => undefined
  );
  pendingAccounting.add(tracked);
  void tracked.finally(() => pendingAccounting.delete(tracked));
}

/** Await any accounting scheduled after a bounded deadline (tests). */
export async function drainAutoClassifierAccountingForTesting(): Promise<void> {
  while (pendingAccounting.size > 0) {
    await Promise.allSettled(Array.from(pendingAccounting));
  }
}

function newCache<V>(maxEntries: number, ttlMs: number): TtlLruCache<V> {
  return new TtlLruCache<V>(maxEntries, ttlMs, () => dependencies.now());
}

/** Override runtime dependencies (index wiring and tests). */
export function configureAutoClassifier(overrides: Partial<AutoClassifierDependencies>): void {
  dependencies = { ...dependencies, ...overrides };
}

/** Reset all process-local state. Call in `beforeEach`. */
export function resetAutoClassifierForTesting(): void {
  dependencies = createDefaultDependencies();
  exactCache = newCache<AutoJudgment>(EXACT_CACHE_MAX_ENTRIES, EXACT_CACHE_TTL_MS);
  sessionCache = newCache<AutoJudgment>(SESSION_CACHE_MAX_ENTRIES, SESSION_CACHE_TTL_MS);
  singleflight.clear();
  pendingAccounting.clear();
  breakers.clear();
  inFlightCount = 0;
}

// ── Scope + bounded context ─────────────────────────────────────────

export interface BuiltAutoContext {
  state: Record<string, unknown>;
  fingerprint: string;
  sessionKey?: string;
  continuation: boolean;
}

function contentText(message: UnifiedChatRequest['messages'][number]): string {
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…[truncated ${value.length - max}]`;
}

function summarizeToolCalls(message: UnifiedChatRequest['messages'][number]): unknown[] {
  return (message.tool_calls ?? []).map((call) => ({
    name: call.function?.name,
    arguments: truncate(call.function?.arguments ?? '', 200),
  }));
}

/** Bounded structural context; excludes prices, budgets, candidates, cache. */
export function buildClassificationContext(request: UnifiedChatRequest): BuiltAutoContext {
  const messages = request.messages ?? [];
  const conversation: Array<Record<string, unknown>> = [];
  let totalChars = 0;

  for (const message of messages.slice(-MAX_CONTEXT_MESSAGES)) {
    if (totalChars >= MAX_CONTEXT_CHARS) break;
    const text = truncate(contentText(message), MAX_MESSAGE_CHARS);
    totalChars += text.length;
    const entry: Record<string, unknown> = { role: message.role, text };
    if (message.tool_calls?.length) entry.tool_calls = summarizeToolCalls(message);
    if (message.role === 'tool' && message.name) entry.name = message.name;
    conversation.push(entry);
  }

  const state: Record<string, unknown> = {
    task: 'classify_request',
    conversation,
    structural: {
      message_count: messages.length,
      has_tools: (request.tools?.length ?? 0) > 0,
      tool_count: request.tools?.length ?? 0,
      has_images: messages.some(
        (message) =>
          Array.isArray(message.content) &&
          message.content.some((part) => part.type === 'image_url')
      ),
      api_type: request.incomingApiType ?? 'chat',
    },
  };

  return {
    state,
    fingerprint: createHash('sha256').update(JSON.stringify(state)).digest('hex'),
    sessionKey: deriveAutoSessionBranch(request),
    continuation: isContinuation(request),
  };
}

const ACKNOWLEDGEMENT_PATTERN =
  /^(ok|okay|k|thanks|thank you|thx|yes|yep|yeah|sure|go on|go ahead|continue|proceed|please continue|keep going|got it|sounds good|great|do it|cool|nice|perfect)\b/i;

function isAcknowledgement(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[.!?,;:'"]+$/g, '')
    .replace(/\s+/g, ' ');
  return (
    normalized.length > 0 && normalized.length <= 40 && ACKNOWLEDGEMENT_PATTERN.test(normalized)
  );
}

function looksLikeToolResult(text: string): boolean {
  return /^(tool result|function result|result:)/i.test(text.trim());
}

function isSubstantiveUserMessage(message: UnifiedChatRequest['messages'][number]): boolean {
  const text = contentText(message).trim();
  return text.length > 0 && !isAcknowledgement(text) && !looksLikeToolResult(text);
}

/**
 * Continuation means the latest turn carries no new substantive user intent
 * (tool result, acknowledgement, or assistant/tool-only). A short *first* user
 * request is not a continuation and is always classified.
 */
export function isContinuation(request: UnifiedChatRequest): boolean {
  const messages = request.messages ?? [];
  if (messages.length === 0) return false;
  const last = messages[messages.length - 1]!;
  if (last.role === 'tool') return true;

  const userMessages = messages.filter((message) => message.role === 'user');
  const lastUser = userMessages[userMessages.length - 1];
  if (!lastUser) return true;

  const priorSubstantive = userMessages
    .slice(0, -1)
    .filter((message) => isSubstantiveUserMessage(message));
  if (priorSubstantive.length === 0) return false;

  const lastUserText = contentText(lastUser);
  if (isAcknowledgement(lastUserText) || looksLikeToolResult(lastUserText)) return true;

  const afterLastUser = messages.slice(messages.lastIndexOf(lastUser) + 1);
  return afterLastUser.length > 0 && afterLastUser.every((message) => message.role !== 'user');
}

function handleForExactKey(exactKey: string): string {
  return createHash('sha256').update(exactKey).digest('hex').slice(0, 32);
}

function apiKeyIdOf(request: UnifiedChatRequest): string | undefined {
  const meta = request.metadata?.plexus_metadata as Record<string, unknown> | undefined;
  const explicit = meta?.plexus_key_id;
  // Only the server-set explicit scope counts; ambient context is never a
  // substitute for an authenticated key id.
  return typeof explicit === 'string' && explicit.trim().length > 0 ? explicit.trim() : undefined;
}

/**
 * Server-owned purpose discriminator. Production auth strips any client-supplied
 * `plexus_auto_purpose`, so only the internal preview path can set it. The
 * purpose is part of the cached scope so a real key named like an admin scope
 * can never collide with a preview judgment.
 */
export function purposeOf(request: UnifiedChatRequest): AutoRequestPurpose {
  const meta = request.metadata?.plexus_metadata as Record<string, unknown> | undefined;
  return meta?.plexus_auto_purpose === 'preview' ? 'preview' : 'inference';
}

/** Exact-cache scope; null when there is no authenticated API key. */
export function computeAutoScope(
  request: UnifiedChatRequest,
  config: AutoRoutingConfig
): AutoClassifierScope | null {
  const keyId = apiKeyIdOf(request);
  if (!keyId) return null;
  const context = buildClassificationContext(request);
  const classifierAlias = config.classifier_alias?.trim() ?? '';
  const rubricVersion = config.rubric_version ?? 1;
  const classifierFingerprint = classifierBindingFingerprint(
    classifierAlias,
    dependencies.getModels()
  );
  const purpose = purposeOf(request);
  // Structured JSON (not a delimiter string) so an identity like
  // `admin` + `preview` can never collide with a real key named
  // `admin|preview` or a delimiter-bearing key id.
  const exactKey = JSON.stringify({
    keyId,
    purpose,
    classifierAlias,
    classifierFingerprint,
    rubricVersion,
    contextFingerprint: context.fingerprint,
  });
  return {
    keyId,
    purpose,
    classifierAlias,
    classifierFingerprint,
    rubricVersion,
    contextFingerprint: context.fingerprint,
    handle: handleForExactKey(exactKey),
  };
}

function sessionCacheKey(scope: AutoClassifierScope, sessionKey: string): string {
  return `${scope.keyId}|${scope.purpose}|${scope.classifierAlias}|${scope.classifierFingerprint}|${scope.rubricVersion}|${sessionKey}`;
}

/** Opaque reusable handle for the preview API; no raw prompt is retained. */
export function getAutoJudgmentHandle(
  request: UnifiedChatRequest,
  config: AutoRoutingConfig
): string | undefined {
  return computeAutoScope(request, config)?.handle;
}

/** Look up a retained judgment; mismatched scope returns undefined. */
export function lookupAutoJudgmentForHandle(
  handle: string,
  request: UnifiedChatRequest,
  config: AutoRoutingConfig
): AutoJudgment | undefined {
  const scope = computeAutoScope(request, config);
  if (!scope || scope.handle !== handle) return undefined;
  return exactCache.get(handle);
}

// ── Classifier alias guard ──────────────────────────────────────────

function canonicalResolver(models: Record<string, ModelConfig>): Map<string, string> {
  const canonical = new Map<string, string>();
  for (const key of Object.keys(models)) {
    canonical.set(key, key);
    for (const nickname of models[key]?.additional_aliases ?? []) {
      if (!canonical.has(nickname)) canonical.set(nickname, key);
    }
  }
  return canonical;
}

function hasAutoGroup(model: ModelConfig | undefined): boolean {
  return (model?.target_groups ?? []).some((group) => group.selector === 'auto');
}

interface ClassifierBindingNode {
  slug: string;
  type: string | null;
  groups: Array<{
    selector: string;
    targets: Array<{
      provider: string | null;
      model: string | null;
      alias: string | null;
      enabled: boolean;
    }>;
  }>;
}

/**
 * Stable fingerprint of the classifier's reachable routing binding — the
 * canonical alias, its selector/target structure, and every transitively
 * referenced alias. Routing-only fields (never credentials), so a target or
 * catalog change invalidates cached judgments without retaining secrets.
 */
function classifierBindingFingerprint(
  alias: string,
  models: Record<string, ModelConfig> | undefined
): string {
  const canonical = models ? canonicalResolver(models) : new Map<string, string>();
  const nodes: ClassifierBindingNode[] = [];
  const seen = new Set<string>();

  const visit = (slug: string, depth: number): void => {
    const canonicalSlug = canonical.get(slug) ?? slug;
    if (seen.has(canonicalSlug) || depth > MAX_CLASSIFIER_GRAPH_DEPTH) return;
    if (nodes.length >= MAX_CLASSIFIER_GRAPH_NODES) return;
    seen.add(canonicalSlug);
    const model = models?.[canonicalSlug];
    const groups = (model?.target_groups ?? []).map((group) => ({
      selector: group.selector,
      targets: group.targets.map((target) => ({
        provider: target.provider ?? null,
        model: target.model ?? null,
        alias: target.alias ? (canonical.get(target.alias) ?? target.alias) : null,
        enabled: target.enabled !== false,
      })),
    }));
    nodes.push({ slug: canonicalSlug, type: model?.type ?? null, groups });
    for (const group of model?.target_groups ?? []) {
      for (const target of group.targets) {
        if (target.alias) visit(target.alias, depth + 1);
      }
    }
  };

  visit(alias, 0);
  nodes.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return createHash('sha256').update(JSON.stringify(nodes)).digest('hex').slice(0, 16);
}

function reachesAutoGroup(
  slug: string,
  models: Record<string, ModelConfig>,
  canonical: Map<string, string>,
  seen = new Set<string>()
): boolean {
  const canonicalSlug = canonical.get(slug) ?? slug;
  if (seen.has(canonicalSlug)) return false;
  seen.add(canonicalSlug);
  const model = models[canonicalSlug];
  if (!model) return false;
  if (hasAutoGroup(model)) return true;
  for (const group of model.target_groups ?? []) {
    for (const target of group.targets) {
      if (target.enabled === false || !target.alias) continue;
      if (reachesAutoGroup(target.alias, models, canonical, seen)) return true;
    }
  }
  return false;
}

/** Reject missing, non-Decisions, or auto-reaching classifier aliases. */
export function assertClassifierAliasUsable(
  alias: string,
  models: Record<string, ModelConfig> | undefined
): void {
  if (!alias) throw new Error('Auto routing classifier alias is not configured');
  if (!models) throw new Error('Auto routing classifier alias cannot be validated');
  const canonical = canonicalResolver(models);
  const canonicalSlug = canonical.get(alias) ?? alias;
  const model = models[canonicalSlug];
  if (!model) throw new Error(`Unknown auto routing classifier alias '${alias}'`);
  if (model.type !== 'decisions') {
    throw new Error(`Auto routing classifier alias '${alias}' is not a Decisions alias`);
  }
  if (reachesAutoGroup(canonicalSlug, models, canonical)) {
    throw new Error(`Auto routing classifier alias '${alias}' must not use auto routing`);
  }
}

// ── Typed questions + strict validation ─────────────────────────────

const TASK_KIND_OPTIONS = [...AUTO_TASK_KINDS, 'unknown'] as const;

export const AUTO_CLASSIFIER_RUBRIC_VERSION = 1;

/** Server-owned rubric; clients never supply these instructions. */
export function buildClassifierQuestions(
  rubricVersion: number = AUTO_CLASSIFIER_RUBRIC_VERSION
): Record<string, DecisionsQuestion> {
  if (rubricVersion !== AUTO_CLASSIFIER_RUBRIC_VERSION) {
    throw new Error(`Unsupported auto routing rubric version '${rubricVersion}'`);
  }
  return {
    task_kind: {
      type: 'choice',
      instructions:
        'Choose the closest task kind for the latest substantive user request. ' +
        'Use "unknown" when no listed kind fits.',
      criteria: Object.fromEntries(
        TASK_KIND_OPTIONS.map((kind) => [kind, `The request is primarily ${kind}.`])
      ),
    },
    complexity: {
      type: 'score',
      instructions:
        'Rate the scope, dependency count, ambiguity, and stakes of the request on a 0–3 scale.',
      criteria: [
        '0 — trivial, single obvious step',
        '1 — small, well-scoped change',
        '2 — multi-step with some dependencies or ambiguity',
        '3 — large, ambiguous, or high-stakes',
      ],
    },
    capability_required: {
      type: 'score',
      instructions:
        'Rate the model capability needed to answer well on a 0–3 scale, ignoring price.',
      criteria: [
        '0 — economy model is sufficient',
        '1 — standard model is sufficient',
        '2 — high-capability model is needed',
        '3 — premium model is needed',
      ],
    },
    deep_reasoning: {
      type: 'noul',
      instructions:
        'Is extended reasoning materially helpful for this request? ' +
        'Higher means extended reasoning is more likely to help.',
    },
  };
}

export interface ParsedJudgment {
  judgment: AutoJudgment;
}

function asRecord(value: unknown): Record<string, any> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, any>) : undefined;
}

function confidenceOf(answer: Record<string, any> | undefined): number | undefined {
  const value = answer?.confidence;
  if (value === undefined) return undefined;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : Number.NaN;
}

/**
 * Validate a Decisions response into an `AutoJudgment`. Any malformed required
 * answer fails the whole judgment; missing optional confidence stays neutral.
 */
export function parseJudgmentAnswers(
  response: UnifiedDecisionsResponse
): ParsedJudgment | { error: string } {
  const answers = response.answers ?? {};
  const task = asRecord(answers.task_kind);
  if (!task || task.type !== 'choice' || typeof task.choice !== 'string') {
    return { error: 'task_kind_missing' };
  }
  if (!(TASK_KIND_OPTIONS as readonly string[]).includes(task.choice)) {
    return { error: 'task_kind_invalid' };
  }

  const complexity = asRecord(answers.complexity);
  if (
    !complexity ||
    complexity.type !== 'score' ||
    typeof complexity.score !== 'number' ||
    !Number.isFinite(complexity.score) ||
    complexity.score < 0 ||
    complexity.score > 3
  ) {
    return { error: 'complexity_invalid' };
  }

  const capability = asRecord(answers.capability_required);
  if (
    !capability ||
    capability.type !== 'score' ||
    typeof capability.score !== 'number' ||
    !Number.isFinite(capability.score) ||
    capability.score < 0 ||
    capability.score > 3
  ) {
    return { error: 'capability_required_invalid' };
  }

  const reasoning = asRecord(answers.deep_reasoning);
  if (
    !reasoning ||
    reasoning.type !== 'noul' ||
    typeof reasoning.noul !== 'number' ||
    !Number.isFinite(reasoning.noul) ||
    reasoning.noul < 0 ||
    reasoning.noul > 1
  ) {
    return { error: 'deep_reasoning_invalid' };
  }

  const confidences = [
    confidenceOf(task),
    confidenceOf(complexity),
    confidenceOf(capability),
  ].filter((value): value is number => value !== undefined);
  if (confidences.some((value) => Number.isNaN(value))) {
    return { error: 'confidence_invalid' };
  }

  const judgment: AutoJudgment = {
    task_kind: task.choice as AutoJudgment['task_kind'],
    complexity: complexity.score,
    capability_required: capability.score,
    deep_reasoning: reasoning.noul,
    ...(confidences.length > 0 ? { confidence: Math.min(...confidences) } : {}),
  };

  return validateAutoJudgment(judgment) ? { judgment } : { error: 'invalid_judgment' };
}

// ── Concurrency gate + circuit breaker ──────────────────────────────

/** Immediate overload signal; classification never queues unbounded. */
function tryAcquireSlot(): boolean {
  if (inFlightCount >= MAX_CONCURRENT_CLASSIFICATIONS) return false;
  inFlightCount += 1;
  return true;
}

function releaseSlot(): void {
  inFlightCount = Math.max(0, inFlightCount - 1);
}

function breakerFor(alias: string): BreakerState {
  const existing = breakers.get(alias);
  if (existing) return existing;
  const state: BreakerState = { failures: 0, openedAt: null };
  breakers.set(alias, state);
  while (breakers.size > MAX_CLASSIFIER_BREAKERS) {
    const oldest = breakers.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    breakers.delete(oldest);
  }
  return state;
}

function breakerIsOpen(alias: string, now: number): boolean {
  const state = breakers.get(alias);
  if (!state || state.openedAt === null) return false;
  if (now - state.openedAt >= BREAKER_RESET_MS) {
    breakers.delete(alias);
    return false;
  }
  return true;
}

function breakerOnSuccess(alias: string): void {
  breakers.delete(alias);
}

function breakerOnFailure(alias: string, now: number): void {
  const state = breakerFor(alias);
  state.failures += 1;
  if (state.failures >= BREAKER_FAILURE_THRESHOLD) state.openedAt = now;
}

// ── Deadline / cancellation ─────────────────────────────────────────

class ClassifierCancelledError extends Error {
  constructor() {
    super('classifier parent cancelled');
    this.name = 'ClassifierCancelledError';
  }
}

class ClassifierTimeoutError extends Error {
  constructor() {
    super('classifier deadline expired');
    this.name = 'ClassifierTimeoutError';
  }
}

/**
 * Race the in-flight child dispatch against an absolute deadline and the
 * shared-abandon signal (raised only when every waiter has left). The dispatch
 * controller is always aborted and the timer/listener cleaned up, so a provider
 * that ignores the signal cannot stall the caller.
 */
function raceDispatch(
  dispatch: Promise<UnifiedDecisionsResponse>,
  controller: AbortController,
  deadlineAt: number,
  sharedSignal: AbortSignal
): Promise<UnifiedDecisionsResponse> {
  return new Promise<UnifiedDecisionsResponse>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      sharedSignal.removeEventListener('abort', onSharedAbort);
    };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const onSharedAbort = () => {
      controller.abort();
      finish(() => reject(new ClassifierCancelledError()));
    };
    timer = setTimeout(
      () => {
        controller.abort();
        finish(() => reject(new ClassifierTimeoutError()));
      },
      Math.max(0, deadlineAt - dependencies.now())
    );
    if (sharedSignal.aborted) {
      onSharedAbort();
      return;
    }
    sharedSignal.addEventListener('abort', onSharedAbort, { once: true });
    dispatch.then(
      (response) => finish(() => resolve(response)),
      (error) => finish(() => reject(error))
    );
  });
}

// ── Child accounting + trace ────────────────────────────────────────

function buildChildUsageRecord(params: {
  childRequestId: string;
  keyId: string;
  purpose: AutoRequestPurpose;
  response: UnifiedDecisionsResponse;
  startTime: number;
  durationMs: number;
}): Partial<UsageRecord> {
  const provider = params.response.plexus?.provider ?? null;
  const model = params.response.plexus?.model ?? null;
  return {
    requestId: params.childRequestId,
    date: new Date(params.startTime).toISOString(),
    sourceIp: null,
    // Preview classification is admin-attributed and must not debit a real API
    // key's quota; the admin identity rides in `attribution` instead.
    apiKey: params.purpose === 'preview' ? null : params.keyId,
    attribution: params.purpose === 'preview' ? `auto-preview:${params.keyId}` : null,
    incomingApiType: 'decisions',
    provider,
    incomingModelAlias: null,
    canonicalModelName: params.response.plexus?.canonicalModel ?? null,
    selectedModelName: model,
    finalAttemptProvider: provider,
    finalAttemptModel: model,
    outgoingApiType:
      params.response.plexus?.targetApiType ?? params.response.plexus?.apiType ?? null,
    tokensInput: params.response.usage?.input_tokens ?? null,
    tokensOutput: params.response.usage?.output_tokens ?? null,
    tokensReasoning: null,
    tokensCached: null,
    tokensCacheWrite: null,
    providerReportedCost: params.response.usage?.cost ?? null,
    startTime: params.startTime,
    durationMs: params.durationMs,
    isStreamed: false,
    responseStatus: 'success',
    isPassthrough: false,
    attemptCount: 1,
  };
}

function buildAccountedChildUsage(params: {
  childRequestId: string;
  keyId: string;
  purpose: AutoRequestPurpose;
  response: UnifiedDecisionsResponse;
  startTime: number;
  durationMs: number;
}): { record: Partial<UsageRecord>; cost?: number } {
  const record = buildChildUsageRecord(params);
  calculateCosts(record, params.response.plexus?.pricing, params.response.plexus?.providerDiscount);
  const providerCost = params.response.usage?.cost;
  const cost =
    typeof providerCost === 'number' && Number.isFinite(providerCost)
      ? providerCost
      : typeof record.costTotal === 'number' && Number.isFinite(record.costTotal)
        ? record.costTotal
        : undefined;
  return { record, cost };
}

async function recordChildUsage(
  record: Partial<UsageRecord>,
  params: { keyId: string; purpose: AutoRequestPurpose; response: UnifiedDecisionsResponse }
): Promise<void> {
  const usageRecorder = dependencies.getUsageRecorder();
  const quotaRecorder = dependencies.getQuotaRecorder();
  if (!usageRecorder && !quotaRecorder) return;
  try {
    if (usageRecorder) await usageRecorder.saveRequest(record as UsageRecord);
    if (quotaRecorder && params.purpose !== 'preview') {
      await quotaRecorder.recordUsage(
        params.keyId,
        params.response.plexus?.provider ?? '',
        params.response.plexus?.model ?? '',
        {
          tokensInput: record.tokensInput ?? undefined,
          tokensOutput: record.tokensOutput ?? undefined,
          tokensCached: record.tokensCached ?? undefined,
          tokensCacheWrite: record.tokensCacheWrite ?? undefined,
          costTotal: record.costTotal ?? undefined,
        }
      );
    }
  } catch (error) {
    logger.warn(`Auto classifier child usage accounting failed: ${String(error)}`);
  }
}

/** Account a completed child call, including malformed/late responses. */
async function accountChildUsage(params: {
  childRequestId: string;
  keyId: string;
  purpose: AutoRequestPurpose;
  response: UnifiedDecisionsResponse;
  startTime: number;
  durationMs: number;
}): Promise<number | undefined> {
  const { record, cost } = buildAccountedChildUsage(params);
  await recordChildUsage(record, {
    keyId: params.keyId,
    purpose: params.purpose,
    response: params.response,
  });
  return cost;
}

/**
 * Account a completed child call without letting a slow ledger push the
 * routing deadline out. The recording continues in the background (tracked) if
 * it has not settled by `deadlineAt`; the synchronously-computed cost is still
 * returned so the judgment cost is never missing just because the write lagged.
 */
async function accountChildUsageWithin(
  params: {
    childRequestId: string;
    keyId: string;
    purpose: AutoRequestPurpose;
    response: UnifiedDecisionsResponse;
    startTime: number;
    durationMs: number;
  },
  deadlineAt: number
): Promise<number | undefined> {
  const { record, cost } = buildAccountedChildUsage(params);
  const recording = recordChildUsage(record, {
    keyId: params.keyId,
    purpose: params.purpose,
    response: params.response,
  });
  trackAccounting(recording);
  const budget = Math.max(0, deadlineAt - dependencies.now());
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    recording,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, budget);
    }),
  ]);
  if (timer) clearTimeout(timer);
  return cost;
}

/** Bound a read-only quota pre-check by the same deadline as the dispatch. */
async function loadQuotaContextWithin(
  keyId: string,
  deadlineAt: number
): Promise<QuotaContext | null> {
  const quotaRecorder = dependencies.getQuotaRecorder();
  if (!quotaRecorder) return null;
  try {
    const load = quotaRecorder.loadQuotaContext(keyId);
    const budget = Math.max(0, deadlineAt - dependencies.now());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const context = await Promise.race([
      load,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), budget);
      }),
    ]);
    if (timer) clearTimeout(timer);
    return context;
  } catch (error) {
    logger.warn(`Auto classifier quota pre-check failed: ${String(error)}`);
    return null;
  }
}

function startChildTrace(
  childRequestId: string,
  parentRequestId: string | undefined,
  purpose: AutoRequestPurpose
): void {
  try {
    DebugManager.getInstance().startLog(childRequestId, {
      plexus_auto_classifier: { parent_request_id: parentRequestId ?? null, purpose },
    });
  } catch {
    // Trace capture is best-effort.
  }
}

function finishChildTrace(childRequestId: string): void {
  try {
    DebugManager.getInstance().flush(childRequestId);
  } catch {
    // Trace capture is best-effort.
  }
}

// ── Fresh classification ────────────────────────────────────────────

function unavailable(reason: string, startTime: number, handle?: string): AutoClassifierResult {
  return {
    source: 'unavailable',
    reason,
    latencyMs: Math.max(0, dependencies.now() - startTime),
    ...(handle ? { handle } : {}),
  };
}

async function runFreshClassification(params: {
  request: UnifiedChatRequest;
  config: AutoRoutingConfig;
  scope: AutoClassifierScope;
  startTime: number;
  deadlineAt: number;
  sharedSignal: AbortSignal;
}): Promise<AutoClassifierResult> {
  const { request, scope, startTime, deadlineAt, sharedSignal } = params;
  const config = params.config;
  const classifierAlias = config.classifier_alias.trim();
  const rubricVersion = config.rubric_version ?? AUTO_CLASSIFIER_RUBRIC_VERSION;
  const context = buildClassificationContext(request);

  if (breakerIsOpen(classifierAlias, dependencies.now())) {
    return unavailable('classifier_circuit_open', startTime, scope.handle);
  }
  if (!tryAcquireSlot()) {
    return unavailable('classifier_overloaded', startTime, scope.handle);
  }

  const childRequestId = `${request.requestId ? `${request.requestId}:` : ''}auto-classifier-${randomUUID()}`;
  const childStart = dependencies.now();
  const isPreview = scope.purpose === 'preview';
  try {
    // The quota pre-check shares the routing deadline and its loaded context is
    // attached to the child so scoped provider quotas are enforced by dispatch.
    // Preview classification is admin-attributed and never debits key quota.
    const quotaContext = isPreview ? null : await loadQuotaContextWithin(scope.keyId, deadlineAt);
    if (quotaContext?.blockedGlobal) {
      return unavailable('key_quota_blocked', startTime, scope.handle);
    }
    if (sharedSignal.aborted) {
      return unavailable('parent_cancelled', startTime, scope.handle);
    }

    const childRequest: UnifiedDecisionsRequest = {
      model: classifierAlias,
      state: context.state,
      questions: buildClassifierQuestions(rubricVersion),
      requestId: childRequestId,
      incomingApiType: 'decisions',
      metadata: {
        plexus_metadata: {
          plexus_internal_purpose: 'auto_classifier',
          parent_request_id: request.requestId ?? null,
          ...(quotaContext ? { plexus_quota_context: quotaContext } : {}),
        } as any,
      },
    };

    const controller = new AbortController();
    let dispatch: Promise<UnifiedDecisionsResponse> | undefined;
    let response: UnifiedDecisionsResponse;
    try {
      // Dispatcher creation and trace start run inside the child request
      // context so neither reads or overwrites the parent's AsyncLocal state.
      response = await runInRequestContext(
        { keyName: scope.keyId, requestId: childRequestId },
        () => {
          startChildTrace(childRequestId, request.requestId, scope.purpose);
          const inflight = dependencies
            .createDispatcher()
            .then((dispatcher) => dispatcher.dispatchDecisions(childRequest, controller.signal));
          dispatch = inflight;
          return raceDispatch(inflight, controller, deadlineAt, sharedSignal).finally(() => {
            finishChildTrace(childRequestId);
          });
        }
      );
    } catch (error) {
      // A provider that ignores abort may finish later; keep accounting it.
      if (dispatch) {
        trackAccounting(
          dispatch.then((late) =>
            accountChildUsage({
              childRequestId,
              keyId: scope.keyId,
              purpose: scope.purpose,
              response: late,
              startTime: childStart,
              durationMs: Math.max(0, dependencies.now() - childStart),
            })
          )
        );
      }
      if (error instanceof ClassifierCancelledError) {
        return unavailable('parent_cancelled', startTime, scope.handle);
      }
      breakerOnFailure(classifierAlias, dependencies.now());
      if (error instanceof ClassifierTimeoutError) {
        return unavailable('classifier_timeout', startTime, scope.handle);
      }
      logger.warn(`Auto classifier dispatch failed: ${String(error)}`);
      return unavailable('classifier_error', startTime, scope.handle);
    }

    // Account before interpreting answers: invalid output still cost money.
    // Bounded so a slow ledger cannot push the routing deadline out; the
    // synchronously-computed cost is still returned.
    const cost = await accountChildUsageWithin(
      {
        childRequestId,
        keyId: scope.keyId,
        purpose: scope.purpose,
        response,
        startTime: childStart,
        durationMs: Math.max(0, dependencies.now() - childStart),
      },
      deadlineAt
    );

    const parsed = parseJudgmentAnswers(response);
    if ('error' in parsed) {
      breakerOnFailure(classifierAlias, dependencies.now());
      return unavailable(parsed.error, startTime, scope.handle);
    }

    breakerOnSuccess(classifierAlias);
    exactCache.set(scope.handle, parsed.judgment);
    if (context.sessionKey) {
      sessionCache.set(sessionCacheKey(scope, context.sessionKey), parsed.judgment);
    }

    return {
      judgment: parsed.judgment,
      source: 'fresh',
      reason: 'classified',
      latencyMs: Math.max(0, dependencies.now() - startTime),
      handle: scope.handle,
      ...(typeof cost === 'number' && Number.isFinite(cost) ? { cost } : {}),
    };
  } finally {
    releaseSlot();
  }
}

// ── Public entry point ──────────────────────────────────────────────

/**
 * Classify one inbound request. Returns `source: 'unavailable'` (never throws)
 * so callers fall back to the deterministic baseline without bypassing
 * suitability, continuation, permission, or quota constraints.
 */
export async function classifyAutoRequest(
  request: UnifiedChatRequest,
  config: AutoRoutingConfig,
  signal?: AbortSignal
): Promise<AutoClassifierResult> {
  const startTime = dependencies.now();

  if (config.mode !== 'active') return unavailable('auto_off', startTime);

  const classifierAlias = config.classifier_alias?.trim() ?? '';
  if (!classifierAlias) return unavailable('classifier_unavailable', startTime);
  try {
    assertClassifierAliasUsable(classifierAlias, dependencies.getModels());
  } catch (error) {
    logger.warn(`Auto classifier alias rejected: ${String(error)}`);
    return unavailable('classifier_unavailable', startTime);
  }

  const scope = computeAutoScope(request, config);
  if (!scope) return unavailable('unauthenticated', startTime);
  if (signal?.aborted) return unavailable('parent_cancelled', startTime, scope.handle);

  const context = buildClassificationContext(request);

  if (context.continuation && context.sessionKey) {
    const prior = sessionCache.get(sessionCacheKey(scope, context.sessionKey));
    if (prior) {
      return {
        judgment: prior,
        source: 'continuation',
        reason: 'continuation_reuse',
        latencyMs: Math.max(0, dependencies.now() - startTime),
        handle: scope.handle,
      };
    }
  }

  const cached = exactCache.get(scope.handle);
  if (cached) {
    return {
      judgment: cached,
      source: 'exact_cache',
      reason: 'exact_cache_hit',
      latencyMs: Math.max(0, dependencies.now() - startTime),
      handle: scope.handle,
    };
  }

  const existing = singleflight.get(scope.handle);
  if (existing) return waitForSharedResult(existing, signal, startTime, scope.handle);

  const deadlineMs = config.classifier_deadline_ms ?? DEFAULT_DEADLINE_MS;
  // One clock covers queue admission, quota pre-check, dispatcher init,
  // network call, and accounting.
  const deadlineAt = startTime + deadlineMs;
  const sharedController = new AbortController();
  let entry: SingleflightEntry | undefined;
  const pending = runFreshClassification({
    request,
    config,
    scope,
    startTime,
    deadlineAt,
    sharedSignal: sharedController.signal,
  }).finally(() => {
    if (entry && singleflight.get(scope.handle) === entry) singleflight.delete(scope.handle);
  });
  entry = { promise: pending, sharedController, waiters: 0 };
  singleflight.set(scope.handle, entry);
  return waitForSharedResult(entry, signal, startTime, scope.handle);
}

/**
 * Attach one caller to a shared classification without letting that caller's
 * own cancellation fail the others. Each caller resolves `parent_cancelled`
 * on its signal; the shared dispatch keeps running until the deadline or until
 * the last waiter leaves.
 */
function waitForSharedResult(
  entry: SingleflightEntry,
  signal: AbortSignal | undefined,
  startTime: number,
  handle: string
): Promise<AutoClassifierResult> {
  entry.waiters += 1;
  let released = false;
  const releaseWaiter = () => {
    if (released) return;
    released = true;
    entry.waiters = Math.max(0, entry.waiters - 1);
    if (entry.waiters === 0) entry.sharedController.abort();
  };

  if (signal?.aborted) {
    releaseWaiter();
    return Promise.resolve(unavailable('parent_cancelled', startTime, handle));
  }

  return new Promise<AutoClassifierResult>((resolve) => {
    let settled = false;
    const settle = (result: AutoClassifierResult) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      releaseWaiter();
      resolve(result);
    };
    const onAbort = () => settle(unavailable('parent_cancelled', startTime, handle));
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    entry.promise.then(
      (result) => settle(result),
      () => settle(unavailable('classifier_error', startTime, handle))
    );
  });
}
