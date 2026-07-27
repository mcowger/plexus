import type { UnifiedChatRequest } from '../../types/unified';
import { logger } from '../../utils/logger';
import type { RouteResult } from '../routing/router';
import { buildGenerationOptions, resolvePiAiModel } from '../pi-ai/registry';
import type { GenerationIntent } from '../pi-ai/generation';
import { normalizeVerbosity } from '../pi-ai/generation';
import type { ReasoningIntent, ReasoningVisibility } from '../pi-ai/reasoning';
import { normalizeEffort, normalizeVisibility } from '../pi-ai/reasoning';

function hasOwn(value: Record<string, any>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * Detects Codex CLI Responses API extensions (namespace tools, custom/freeform
 * tools, and their corresponding input items) that most Responses-API-compatible
 * upstream providers don't understand. When present, the raw body cannot be
 * forwarded as-is (pass-through) — it must go through ResponsesTransformer's
 * namespace-flattening/custom-tool-normalization so the upstream provider only
 * ever sees plain function tools.
 */
export function hasCodexResponsesExtensions(body: any): boolean {
  if (!body || typeof body !== 'object') {
    return false;
  }

  if (
    Array.isArray(body.tools) &&
    body.tools.some((t: any) => t?.type === 'namespace' || t?.type === 'custom')
  ) {
    return true;
  }

  if (
    Array.isArray(body.input) &&
    body.input.some(
      (item: any) =>
        item &&
        typeof item === 'object' &&
        (item.type === 'custom_tool_call' ||
          item.type === 'custom_tool_call_output' ||
          (item.type === 'additional_tools' &&
            Array.isArray(item.tools) &&
            item.tools.length > 0) ||
          (item.type === 'function_call' && typeof item.namespace === 'string'))
    )
  ) {
    return true;
  }

  return false;
}

function normalizeReasoningFromUnified(
  reasoning: UnifiedChatRequest['reasoning']
): ReasoningIntent {
  const effort = normalizeEffort(reasoning?.effort);
  const enabled = effort === 'off' ? false : reasoning?.enabled;
  const visibility = normalizeVisibility(reasoning?.summary);
  return {
    ...(effort && effort !== 'off' ? { effort } : {}),
    ...(reasoning?.max_tokens != null ? { budgetTokens: reasoning.max_tokens } : {}),
    ...(enabled !== undefined ? { enabled } : {}),
    ...(visibility ? { visibility } : {}),
    ...(reasoning?.summary ? { summaryDetail: reasoning.summary } : {}),
    source: 'client',
  };
}

function extractReasoningIntent(payload: any, request: UnifiedChatRequest): ReasoningIntent {
  const source = payload && typeof payload === 'object' ? payload : {};
  const incomingApiType = request.incomingApiType?.toLowerCase();

  if (incomingApiType === 'messages' && source.thinking && typeof source.thinking === 'object') {
    const thinking = source.thinking;
    const type = typeof thinking.type === 'string' ? thinking.type.toLowerCase() : undefined;
    const display = thinking.display;
    return {
      ...(type === 'disabled' ? { enabled: false } : { enabled: true }),
      ...(type === 'adaptive' ? { adaptive: true } : {}),
      ...(typeof thinking.budget_tokens === 'number'
        ? { budgetTokens: thinking.budget_tokens }
        : {}),
      ...(normalizeVisibility(display) ? { visibility: normalizeVisibility(display) } : {}),
      source: 'client',
    };
  }

  const rawReasoning = source.reasoning ?? request.reasoning;
  if (rawReasoning && typeof rawReasoning === 'object') {
    const effort = normalizeEffort((rawReasoning as any).effort);
    const summaryDetail =
      typeof (rawReasoning as any).summary === 'string' ? (rawReasoning as any).summary : undefined;
    const visibility = normalizeVisibility(summaryDetail);
    return {
      ...(effort === 'off' ? {} : effort ? { effort } : {}),
      ...(effort === 'off' ? { enabled: false } : {}),
      ...(typeof (rawReasoning as any).max_tokens === 'number'
        ? { budgetTokens: (rawReasoning as any).max_tokens }
        : {}),
      ...((rawReasoning as any).enabled !== undefined
        ? { enabled: (rawReasoning as any).enabled === true }
        : {}),
      ...(visibility ? { visibility } : {}),
      ...(summaryDetail ? { summaryDetail } : {}),
      source: 'client',
    };
  }

  const chatEffort = normalizeEffort(source.reasoning_effort);
  if (chatEffort) {
    return chatEffort === 'off'
      ? { enabled: false, source: 'client' }
      : { effort: chatEffort, enabled: true, source: 'client' };
  }

  const thinkingConfig = source.generationConfig?.thinkingConfig;
  if (thinkingConfig && typeof thinkingConfig === 'object') {
    const effort = normalizeEffort(thinkingConfig.thinkingLevel);
    const visibility: ReasoningVisibility | undefined =
      thinkingConfig.includeThoughts === true ? 'summary' : undefined;
    return {
      ...(effort && effort !== 'off' ? { effort } : {}),
      ...(typeof thinkingConfig.thinkingBudget === 'number'
        ? { budgetTokens: thinkingConfig.thinkingBudget }
        : {}),
      ...(thinkingConfig.thinkingBudget === 0 ? { enabled: false } : { enabled: true }),
      ...(visibility ? { visibility } : {}),
      source: 'client',
    };
  }

  return normalizeReasoningFromUnified(request.reasoning);
}

function extractGenerationIntent(payload: any, request: UnifiedChatRequest): GenerationIntent {
  const source = payload && typeof payload === 'object' ? payload : {};
  const maxTokens =
    source.max_output_tokens ??
    source.max_tokens ??
    source.max_completion_tokens ??
    source.generationConfig?.maxOutputTokens ??
    request.max_tokens;
  const temperature =
    source.temperature ?? source.generationConfig?.temperature ?? request.temperature;
  const verbosity = normalizeVerbosity(source.text?.verbosity ?? request.text?.verbosity);
  const serviceTier = source.service_tier ?? request.originalBody?.service_tier;

  return {
    reasoning: extractReasoningIntent(source, request),
    ...(typeof maxTokens === 'number' ? { maxTokens } : {}),
    ...(typeof temperature === 'number' ? { temperature } : {}),
    ...(verbosity ? { verbosity } : {}),
    ...(typeof serviceTier === 'string' ? { serviceTier } : {}),
  };
}

function mappedThinkingValue(model: any, effort: string | undefined): string | undefined {
  if (!effort) return undefined;
  const mapped = model.thinkingLevelMap?.[effort];
  return typeof mapped === 'string' ? mapped : effort;
}

function mappedOffValue(model: any): string | undefined {
  const off = model.thinkingLevelMap?.off;
  return typeof off === 'string' ? off : undefined;
}

function shouldDropTemperature(intent: GenerationIntent, options: Record<string, any>): boolean {
  return intent.temperature != null && !hasOwn(options, 'temperature');
}

function projectOpenAiCompletionsAutoCompat(
  payload: Record<string, any>,
  model: any,
  intent: GenerationIntent,
  options: Record<string, any>
): Record<string, any> {
  const next = { ...payload };
  const compat = model.compat ?? {};

  if (options.maxTokens != null) {
    if (compat.maxTokensField === 'max_completion_tokens') {
      delete next.max_tokens;
      next.max_completion_tokens = options.maxTokens;
    } else {
      next.max_tokens = options.maxTokens;
    }
  }
  if (hasOwn(options, 'temperature')) next.temperature = options.temperature;
  else if (shouldDropTemperature(intent, options)) delete next.temperature;

  if (!model.reasoning) return next;

  const reasoningEffort =
    typeof options.reasoningEffort === 'string' ? options.reasoningEffort : undefined;
  const enabled = reasoningEffort != null;
  const explicitOff = options.reasoning === 'off' || intent.reasoning.enabled === false;
  if (!enabled && !explicitOff) return next;

  const mapped = mappedThinkingValue(model, reasoningEffort);
  const off = mappedOffValue(model);

  switch (compat.thinkingFormat) {
    case 'zai':
      next.thinking = enabled ? { type: 'enabled', clear_thinking: false } : { type: 'disabled' };
      if (enabled && compat.supportsReasoningEffort && mapped) next.reasoning_effort = mapped;
      break;
    case 'qwen':
      next.enable_thinking = enabled;
      break;
    case 'qwen-chat-template':
      next.chat_template_kwargs = {
        ...(next.chat_template_kwargs ?? {}),
        enable_thinking: enabled,
        preserve_thinking: true,
      };
      break;
    case 'chat-template':
      next.chat_template_kwargs = {
        ...(next.chat_template_kwargs ?? {}),
        ...resolveChatTemplateKwargs(model, options),
      };
      break;
    case 'deepseek':
      next.thinking = enabled ? { type: 'enabled' } : { type: 'disabled' };
      if (enabled && compat.supportsReasoningEffort && mapped) next.reasoning_effort = mapped;
      break;
    case 'openrouter':
      next.reasoning = enabled ? { effort: mapped } : { effort: off ?? 'none' };
      break;
    case 'ant-ling':
      if (enabled && mapped) next.reasoning = { effort: mapped };
      break;
    case 'together':
      next.reasoning = { enabled };
      if (enabled && compat.supportsReasoningEffort && mapped) next.reasoning_effort = mapped;
      break;
    case 'string-thinking':
      next.thinking = enabled ? mapped : (off ?? 'none');
      break;
    default:
      if (enabled && compat.supportsReasoningEffort && mapped) {
        next.reasoning_effort = mapped;
      } else if (!enabled && compat.supportsReasoningEffort && off) {
        next.reasoning_effort = off;
      }
      break;
  }

  return next;
}

function resolveChatTemplateKwargs(model: any, options: Record<string, any>): Record<string, any> {
  const kwargs: Record<string, any> = {};
  const template = model.compat?.chatTemplateKwargs;
  if (!template || typeof template !== 'object') return kwargs;

  for (const [key, value] of Object.entries(template)) {
    const resolved = resolveChatTemplateKwargValue(model, options, value);
    if (resolved !== undefined) kwargs[key] = resolved;
  }
  return kwargs;
}

function resolveChatTemplateKwargValue(model: any, options: Record<string, any>, value: unknown) {
  if (typeof value !== 'object' || value === null) return value;
  const config = value as { $var?: string; omitWhenOff?: boolean };
  const reasoningEffort =
    typeof options.reasoningEffort === 'string' ? options.reasoningEffort : undefined;
  if (!reasoningEffort && config.omitWhenOff) return undefined;
  if (config.$var === 'thinking.enabled') return !!reasoningEffort;
  const mapped = reasoningEffort
    ? model.thinkingLevelMap?.[reasoningEffort]
    : model.thinkingLevelMap?.off;
  return mapped === undefined ? reasoningEffort : typeof mapped === 'string' ? mapped : undefined;
}

function projectResponsesAutoCompat(
  payload: Record<string, any>,
  model: any,
  intent: GenerationIntent,
  options: Record<string, any>
): Record<string, any> {
  const next = { ...payload };
  if (options.maxTokens != null) next.max_output_tokens = options.maxTokens;
  if (hasOwn(options, 'temperature')) next.temperature = options.temperature;
  else if (shouldDropTemperature(intent, options)) delete next.temperature;
  if (options.serviceTier !== undefined) next.service_tier = options.serviceTier;
  if (options.textVerbosity !== undefined) {
    next.text = { ...(next.text ?? {}), verbosity: options.textVerbosity };
  }
  if (options.reasoningEffort || options.reasoningSummary) {
    next.reasoning = {
      ...(next.reasoning ?? {}),
      effort: mappedThinkingValue(model, options.reasoningEffort) ?? 'medium',
      summary: options.reasoningSummary ?? next.reasoning?.summary ?? 'auto',
    };
    next.include = Array.from(
      new Set([...(Array.isArray(next.include) ? next.include : []), 'reasoning.encrypted_content'])
    );
  } else if (options.reasoning === 'off') {
    next.reasoning = { ...(next.reasoning ?? {}), effort: mappedOffValue(model) ?? 'none' };
  }
  return next;
}

function projectAnthropicAutoCompat(
  payload: Record<string, any>,
  model: any,
  intent: GenerationIntent,
  options: Record<string, any>
): Record<string, any> {
  const next = { ...payload };
  if (options.maxTokens != null) next.max_tokens = options.maxTokens;
  if (hasOwn(options, 'temperature')) next.temperature = options.temperature;
  else if (shouldDropTemperature(intent, options)) delete next.temperature;

  if (options.thinkingEnabled === true) {
    const display = options.thinkingDisplay ?? 'summarized';
    if (model.compat?.forceAdaptiveThinking === true) {
      next.thinking = { type: 'adaptive', display };
      if (options.effort) {
        next.output_config = { ...(next.output_config ?? {}), effort: options.effort };
      }
    } else {
      next.thinking = {
        type: 'enabled',
        budget_tokens: options.thinkingBudgetTokens ?? 1024,
        display,
      };
    }
  } else if (options.thinkingEnabled === false) {
    next.thinking = { type: 'disabled' };
  }

  return next;
}

function projectGeminiAutoCompat(
  payload: Record<string, any>,
  intent: GenerationIntent,
  options: Record<string, any>
): Record<string, any> {
  const next = { ...payload, generationConfig: { ...(payload.generationConfig ?? {}) } };
  if (options.maxTokens != null) next.generationConfig.maxOutputTokens = options.maxTokens;
  if (hasOwn(options, 'temperature')) next.generationConfig.temperature = options.temperature;
  else if (shouldDropTemperature(intent, options)) delete next.generationConfig.temperature;

  if (options.thinking?.enabled === true) {
    next.generationConfig.thinkingConfig = {
      includeThoughts: options.thinking.includeThoughts !== false,
      ...(options.thinking.level !== undefined ? { thinkingLevel: options.thinking.level } : {}),
      ...(options.thinking.budgetTokens !== undefined
        ? { thinkingBudget: options.thinking.budgetTokens }
        : {}),
    };
  } else if (options.thinking?.enabled === false) {
    next.generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  return next;
}

export function applyRegistryAutoCompat(
  providerPayload: any,
  request: UnifiedChatRequest,
  route: RouteResult,
  targetApiType: string
): any {
  const autoCompat = route.config.auto_compat === true || route.modelConfig?.auto_compat === true;
  if (!autoCompat) return providerPayload;

  const piAiProvider = route.config.pi_ai_provider;
  const piAiModelId = route.modelConfig?.pi_ai_model_id;
  if (!piAiProvider || !piAiModelId) return providerPayload;

  const piAiModel = resolvePiAiModel(piAiProvider, piAiModelId);
  if (!piAiModel) {
    logger.debug(
      `Registry auto-compat skipped: ${route.provider}/${route.model} references unresolved ` +
        `pi-ai model ${piAiProvider}/${piAiModelId}`
    );
    return providerPayload;
  }

  const intent = extractGenerationIntent(providerPayload, request);
  const options = buildGenerationOptions(piAiModel, intent);

  const api = (piAiModel.api as string | undefined) ?? targetApiType;
  let nextPayload: any;
  if (
    api === 'openai-responses' ||
    api === 'openai-codex-responses' ||
    api === 'azure-openai-responses'
  ) {
    nextPayload = projectResponsesAutoCompat(providerPayload, piAiModel, intent, options);
  } else if (api === 'anthropic-messages') {
    nextPayload = projectAnthropicAutoCompat(providerPayload, piAiModel, intent, options);
  } else if (api === 'google-generative-ai' || api === 'google-generative-ai-vertex') {
    nextPayload = projectGeminiAutoCompat(providerPayload, intent, options);
  } else {
    nextPayload = projectOpenAiCompletionsAutoCompat(providerPayload, piAiModel, intent, options);
  }

  logger.debug(`Registry auto-compat applied for ${route.provider}/${route.model}`, {
    piAiProvider,
    piAiModelId,
    api,
    optionKeys: Object.keys(options),
  });

  return nextPayload;
}

// ---------------------------------------------------------------------------
// Reactive auto-compat: strip-and-retry on named unsupported params
// ---------------------------------------------------------------------------
//
// Some upstreams 400 naming one *specific* parameter rather than rejecting the
// whole request (e.g. OpenAI-compatible Responses API providers reject a
// client-sent `safety_identifier` or `prompt_cache_key` with
// `{"detail":"Unsupported parameter: safety_identifier"}` or
// `{"error":{"message":"Unsupported parameter: 'foo'"}}`). Failing over to the
// next configured target doesn't help when the *client* sent the offending
// field — every target would reject it the same way. Instead, the dispatch
// loop (see standard-attempt-request.ts) strips the named field from the
// outbound payload and retries the SAME target.

/**
 * Matches both `{"detail":"Unsupported parameter: X"}` and
 * `{"error":{"message":"Unsupported parameter: 'X'"}}` shapes. The captured
 * group also matches dotted paths (e.g. `reasoning.summary`) and
 * bracket-notation paths (e.g. `messages[0].name`), since providers name
 * nested fields both ways. A capture that stopped at `[` would truncate
 * `messages[0].name` to `messages` — and the paired delete would then remove
 * the ENTIRE conversation from the retry payload.
 */
const UNSUPPORTED_PARAMETER_PATTERN = /unsupported parameter[:\s]+['"]?([\w.[\]]+)['"]?/i;

/**
 * Canonicalizes bracket-notation segments to dotted form
 * (`messages[0].name` → `messages.0.name`) so `deleteDottedPath` — which
 * only understands dot-separated segments — receives the path in the form
 * its array handling expects, and so the same field can't dodge
 * already-stripped dedup by being spelled two ways across retries.
 */
function normalizeBracketSegments(path: string): string {
  return path.replace(/\[(\w+)\]/g, '.$1');
}

/**
 * Extracts the offending parameter name from an upstream error response body
 * (normalized to canonical dotted form — see `normalizeBracketSegments`), or
 * `undefined` when the body doesn't name an unsupported parameter.
 */
export function matchUnsupportedParameter(responseBody: string): string | undefined {
  if (!responseBody) return undefined;
  const paramName = UNSUPPORTED_PARAMETER_PATTERN.exec(responseBody)?.[1];
  return paramName === undefined ? undefined : normalizeBracketSegments(paramName);
}

/** Segment names that must never be traversed — see `deleteDottedPath`. */
const DANGEROUS_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/** Canonical decimal index: "0", "7", "12" — never "01", "length", "-1". */
const CANONICAL_ARRAY_INDEX_PATTERN = /^(0|[1-9]\d*)$/;

/**
 * True when `segment` addresses an in-bounds element of `array` in canonical
 * decimal form. Arrays participate in `deleteDottedPath` ONLY through such
 * segments: `hasOwnProperty` alone would also admit `length` (an OWN
 * property of every array) and expando keys, and rebuilding around those
 * would corrupt the array into an object. Anything non-canonical is refused
 * (deleted:false) rather than guessed at.
 */
function isCanonicalArrayIndex(segment: string, array: readonly unknown[]): boolean {
  return CANONICAL_ARRAY_INDEX_PATTERN.test(segment) && Number(segment) < array.length;
}

export interface DeleteDottedPathResult {
  /**
   * The payload with the field removed. A NEW object (copy-on-write) when
   * `deleted` is true: every object on the affected path, from the root down
   * to the leaf's immediate parent, is shallow-cloned before the leaf is
   * deleted, so nothing shared with another reference is ever mutated.
   * Identical to the input `payload` reference when `deleted` is false
   * (rejected path or no-op — nothing to rebuild).
   */
  payload: Record<string, any>;
  /**
   * Whether a field was actually removed. `false` for a rejected dangerous
   * segment, an absent field, or a non-object intermediate segment — callers
   * MUST treat `false` as "nothing changed" and skip any retry that assumes
   * the payload is now different.
   */
  deleted: boolean;
}

/**
 * Deletes a (possibly dotted, e.g. "reasoning.summary") field path from a
 * payload object. Returns the (possibly new) payload plus whether a field
 * was actually removed.
 *
 * SECURITY: `path` is attacker-influenced — it is parsed out of an upstream
 * provider's error message (see `matchUnsupportedParameter`, whose
 * `[\w.[\]]+` capture matches dots, underscores, AND bracket segments,
 * normalized to dotted form), and the upstream is not a trusted party. Two
 * independent defenses prevent prototype pollution:
 *   1. Any segment named `__proto__`, `constructor`, or `prototype` is
 *      rejected outright, before any traversal. Without this, a path like
 *      `__proto__.toString` would resolve `payload.__proto__` via the
 *      INHERITED accessor to the real `Object.prototype` (typical payload
 *      objects have no OWN property by that name), and the previous
 *      in-place `delete target[leaf]` would then delete the global
 *      `Object.prototype.toString` for the entire process, permanently,
 *      across every subsequent request.
 *   2. Traversal only ever follows OWN enumerable properties
 *      (`hasOwnProperty`), never inherited ones (the previous `segment in
 *      target` check matched inherited properties too), so even a segment
 *      not on the deny-list can't walk onto something inherited from the
 *      prototype chain.
 *
 * COPY-ON-WRITE: the input `payload`, and every nested container on the
 * traversed path, is never mutated in place. `providerPayload` can share a
 * nested object BY REFERENCE with the long-lived `UnifiedChatRequest` (e.g.
 * `payload.reasoning = request.reasoning` in transformers/responses.ts) —
 * mutating that object in place would corrupt it for every OTHER failover
 * target built from the same request afterward. Instead, every container
 * from the root down to the leaf's immediate parent is shallow-cloned and a
 * NEW payload is returned; untouched sibling branches are shared, not
 * cloned.
 *
 * ARRAYS: numeric segments CAN traverse arrays (an upstream 400 naming e.g.
 * `messages.0.some_field` is capturable by `matchUnsupportedParameter`), and
 * every array on the path is rebuilt AS an array — never spread into an
 * object-shaped `{"0": ...}` payload. Arrays only participate via canonical
 * in-bounds indices (see `isCanonicalArrayIndex`; `length`/expando segments
 * are refused untouched). When the LEAF itself is an array index, the
 * element is removed splice-style — later elements shift left — because
 * `delete arr[i]` would leave a hole that serializes as `null`, which is
 * just as malformed as the object-shaped payload.
 */
export function deleteDottedPath(
  payload: Record<string, any>,
  path: string
): DeleteDottedPathResult {
  const segments = path.split('.');

  if (segments.some((segment) => DANGEROUS_PATH_SEGMENTS.has(segment))) {
    return { payload, deleted: false };
  }

  // Walk the path, recording the (container, key) pair at each level so the
  // chain can be rebuilt with clones afterward. Bail out — no traversal
  // beyond this point, no mutation, no clone — the instant a segment isn't
  // an own enumerable property (or, for arrays, a canonical in-bounds
  // index): an absent field or non-object intermediate means there's
  // nothing to strip.
  const chain: Array<{ obj: Record<string, any>; key: string }> = [];
  let target: any = payload;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]!;
    if (
      target == null ||
      typeof target !== 'object' ||
      !Object.prototype.hasOwnProperty.call(target, segment) ||
      (Array.isArray(target) && !isCanonicalArrayIndex(segment, target))
    ) {
      return { payload, deleted: false };
    }
    chain.push({ obj: target, key: segment });
    target = target[segment];
  }

  const leaf = segments[segments.length - 1]!;
  if (
    target == null ||
    typeof target !== 'object' ||
    !Object.prototype.hasOwnProperty.call(target, leaf) ||
    (Array.isArray(target) && !isCanonicalArrayIndex(leaf, target))
  ) {
    return { payload, deleted: false };
  }

  // Rebuild the chain bottom-up with shallow clones so nothing shared with
  // another reference is mutated, preserving each level's container kind.
  let rebuilt: any;
  if (Array.isArray(target)) {
    // Array-index leaf: splice-style removal (no hole — see doc comment).
    const index = Number(leaf);
    rebuilt = [...target.slice(0, index), ...target.slice(index + 1)];
  } else {
    rebuilt = { ...target };
    delete rebuilt[leaf];
  }
  for (let i = chain.length - 1; i >= 0; i--) {
    const { obj, key } = chain[i]!;
    if (Array.isArray(obj)) {
      const clone = [...obj];
      clone[Number(key)] = rebuilt;
      rebuilt = clone;
    } else {
      rebuilt = { ...obj, [key]: rebuilt };
    }
  }

  return { payload: rebuilt, deleted: true };
}

/** Per-target, per-request bound: at most this many strip-and-retry cycles. */
export const MAX_UNSUPPORTED_PARAM_STRIP_RETRIES = 2;

/**
 * Top-level fields the strip-and-retry mechanism must never delete
 * WHOLESALE: removing the entire conversation (`messages` / `input`) or the
 * `model` guarantees a malformed request that every upstream rejects, so an
 * upstream 400 naming one of these EXACTLY (full normalized path, no
 * sub-path) gets normal failover instead of a doomed strip-retry. Sub-paths
 * within them (e.g. `messages.0.name`) and other whole fields (`tools`,
 * `safety_identifier`, ...) remain strippable.
 */
const UNSTRIPPABLE_STRUCTURAL_FIELDS = new Set(['messages', 'input', 'model']);

/**
 * Structural roots whose DIRECT numeric elements are entire conversation
 * items. `Unsupported parameter: messages[0]` normalizes to `messages.0`,
 * which dodges the exact-name guard above — but the paired deleteDottedPath
 * would splice a whole message/input item out of the conversation, mutilating
 * the request as surely as deleting the whole field. `model` is a string, so
 * it has no element paths to guard.
 */
const STRUCTURAL_ARRAY_ROOTS = new Set(['messages', 'input']);

/**
 * True when the normalized path is exactly `<structural root>.<number>` — a
 * numeric leaf DIRECTLY under a structural array (`messages.0`, `input.12`).
 * Deeper paths (`messages.0.name`) address a field WITHIN the item and stay
 * strippable; numeric leaves under non-structural arrays (`tools.2`) stay
 * splice-deletable.
 */
function isStructuralArrayElementPath(path: string): boolean {
  const segments = path.split('.');
  return (
    segments.length === 2 && STRUCTURAL_ARRAY_ROOTS.has(segments[0]!) && /^\d+$/.test(segments[1]!)
  );
}

/** Tracks strip-and-retry progress for a single target within one request. */
export interface UnsupportedParamStripState {
  attempts: number;
  strippedParams: Set<string>;
}

export function createUnsupportedParamStripState(): UnsupportedParamStripState {
  return { attempts: 0, strippedParams: new Set() };
}

/**
 * Decides whether an upstream 400 body naming an unsupported parameter should
 * trigger another strip-and-retry cycle against the same target, recording
 * the attempt in `state` when it does.
 *
 * Returns the parameter name to strip (in canonical dotted form), or
 * `undefined` when the retry should NOT happen because:
 *   - the body doesn't name an unsupported parameter, OR
 *   - the named parameter is a protected structural field
 *     (UNSTRIPPABLE_STRUCTURAL_FIELDS) whose wholesale deletion guarantees a
 *     malformed request — refused before any budget is consumed, OR
 *   - the named parameter is a numeric element directly under a structural
 *     array (`messages.0` / `input[2]` — see isStructuralArrayElementPath):
 *     splice-deleting an entire conversation item is as destructive as
 *     deleting the whole field, so it gets the same budget-free refusal, OR
 *   - the MAX_UNSUPPORTED_PARAM_STRIP_RETRIES bound has been reached, OR
 *   - the named parameter was already stripped on an earlier attempt for this
 *     target — an upstream that keeps rejecting the same field after it's
 *     been removed can't be fixed by retrying, so stop immediately rather
 *     than burning through the retry bound on a no-op loop.
 */
export function planUnsupportedParamStrip(
  responseBody: string,
  state: UnsupportedParamStripState
): string | undefined {
  if (state.attempts >= MAX_UNSUPPORTED_PARAM_STRIP_RETRIES) return undefined;

  const paramName = matchUnsupportedParameter(responseBody);
  if (!paramName || UNSTRIPPABLE_STRUCTURAL_FIELDS.has(paramName)) return undefined;
  if (isStructuralArrayElementPath(paramName)) return undefined;
  if (state.strippedParams.has(paramName)) return undefined;

  state.attempts++;
  state.strippedParams.add(paramName);
  return paramName;
}

// ---------------------------------------------------------------------------
// Reactive auto-compat: strip-and-retry on stale Anthropic thinking-block
// signatures
// ---------------------------------------------------------------------------
//
// Alias-level failover can replay a conversation containing `thinking` /
// `redacted_thinking` blocks signed by one Claude model against a DIFFERENT
// Claude model (e.g. cc/claude-opus-5 -> cc/claude-opus-4-8 -> cc/claude-opus-4-7).
// Anthropic rejects a thinking-block signature produced by another
// model/session with a 400 naming the signature specifically, e.g.:
//   {"type":"error","error":{"type":"invalid_request_error",
//    "message":"messages.3.content.0: Invalid `signature` in `thinking` block"}}
// Failing over to the next target doesn't help — every remaining Claude
// target rejects the same stale signature the same way. Instead strip the
// thinking/redacted_thinking blocks from the outbound Anthropic Messages
// payload and retry the SAME target once.

/**
 * Matches Anthropic's stale/invalid thinking-block-signature 400, e.g.
 * `messages.3.content.0: Invalid \`signature\` in \`thinking\` block`.
 * Backtick-quoting of "signature"/"thinking" is optional since not every
 * upstream quotes them identically.
 */
const THINKING_SIGNATURE_ERROR_PATTERN = /invalid\s+`?signature`?\s+in\s+`?thinking`?\s+block/i;

/**
 * True when an upstream error response body names an invalid/stale
 * thinking-block signature.
 */
export function matchThinkingSignatureError(responseBody: string): boolean {
  if (!responseBody) return false;
  return THINKING_SIGNATURE_ERROR_PATTERN.test(responseBody);
}

/**
 * True when the outbound payload is Anthropic-Messages-API-shaped (has a
 * `messages` array) — the only shape that can carry `thinking` /
 * `redacted_thinking` blocks in the first place. Note this is a structural
 * check only: an OpenAI chat-completions payload also has a `messages`
 * array, so this alone doesn't prove the target is Anthropic. In practice
 * that's harmless here — the paired body match
 * (`matchThinkingSignatureError`) only fires on Anthropic's specific
 * signature-rejection wording, which a non-Anthropic upstream won't emit.
 */
export function isAnthropicMessagesPayload(payload: any): boolean {
  return !!payload && typeof payload === 'object' && Array.isArray(payload.messages);
}

function isThinkingBlock(block: any): boolean {
  return (
    !!block &&
    typeof block === 'object' &&
    (block.type === 'thinking' || block.type === 'redacted_thinking')
  );
}

function contentHasBlockType(content: any, type: string): boolean {
  return (
    Array.isArray(content) &&
    content.some((block: any) => block && typeof block === 'object' && block.type === type)
  );
}

// A fresh array/object is allocated per call (not a shared module-level
// constant) so multiple placeholder messages in the same payload never end
// up aliasing the same mutable content array.
function reasoningElidedPlaceholder(): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: '[reasoning elided]' }];
}

export interface ThinkingSignatureStripResult {
  /**
   * The payload with every `thinking` / `redacted_thinking` block removed.
   * A NEW object (copy-on-write) when `strippedCount` > 0: the root is
   * shallow-cloned with a NEW `messages` array, and each message whose
   * content changed is shallow-cloned — the input payload, its `messages`
   * array, and every original message object are never mutated (the payload
   * can share `messages`/message objects by reference with the long-lived
   * `UnifiedChatRequest`; see `deleteDottedPath`'s copy-on-write rationale).
   * Untouched messages are shared, not cloned. Identical to the input
   * `payload` reference when `strippedCount` is 0 — nothing to rebuild.
   */
  payload: Record<string, any>;
  /**
   * Number of thinking/redacted_thinking blocks actually removed (0 when
   * the payload isn't Anthropic-messages-shaped, or had none to strip).
   * Callers MUST treat 0 as "nothing changed" and skip any retry that
   * assumes the payload is now different — the structural
   * `isAnthropicMessagesPayload` gate also matches OpenAI chat-completions
   * payloads (they have a `messages` array too), which never carry thinking
   * blocks, so a 0-strip retry would resend a byte-identical request.
   */
  strippedCount: number;
}

/**
 * Removes every `thinking` / `redacted_thinking` block from every message's
 * `content` array, copy-on-write (see `ThinkingSignatureStripResult` — the
 * input payload is never mutated). When a message's `content` becomes empty
 * as a result of the strip, the message is dropped entirely UNLESS doing so
 * would:
 *   - break strict user/assistant role alternation — the nearest retained
 *     message before it and the message right after it would end up with
 *     the same role, or
 *   - orphan a `tool_result` — the next message carries a `tool_result` but
 *     the nearest retained message before the drop does NOT carry the
 *     matching `tool_use`, so removing the bridge would leave that
 *     `tool_result` without its paired call.
 * In either case the emptied content is replaced with a
 * `[{"type":"text","text":"[reasoning elided]"}]` placeholder instead of
 * dropping the message, so the conversation shape stays valid.
 *
 * Non-array `content` (e.g. plain-string messages) is left untouched.
 */
export function stripThinkingSignatureBlocks(
  payload: Record<string, any>
): ThinkingSignatureStripResult {
  if (!isAnthropicMessagesPayload(payload)) return { payload, strippedCount: 0 };

  let strippedCount = 0;
  const perMessage: Array<{
    message: any;
    content: any;
    isArrayContent: boolean;
    changed: boolean;
  }> = payload.messages.map((message: any) => {
    if (!message || !Array.isArray(message.content)) {
      return { message, content: message?.content, isArrayContent: false, changed: false };
    }
    const kept = message.content.filter((block: any) => {
      if (isThinkingBlock(block)) {
        strippedCount++;
        return false;
      }
      return true;
    });
    return {
      message,
      content: kept,
      isArrayContent: true,
      changed: kept.length !== message.content.length,
    };
  });

  if (strippedCount === 0) return { payload, strippedCount: 0 };

  const result: any[] = [];
  for (let i = 0; i < perMessage.length; i++) {
    const { message, content, isArrayContent, changed } = perMessage[i]!;

    if (!isArrayContent || content.length > 0) {
      // Only messages that actually lost a block are cloned; untouched
      // messages are shared by reference (copy-on-write).
      result.push(changed ? { ...message, content } : message);
      continue;
    }

    // Content became empty after stripping — decide drop vs. placeholder.
    const prevMessage = result[result.length - 1];
    const nextMessage = perMessage[i + 1]?.message;

    const wouldBreakAlternation =
      !!prevMessage && !!nextMessage && prevMessage.role === nextMessage.role;
    const nextHasToolResult = contentHasBlockType(nextMessage?.content, 'tool_result');
    const prevHasToolUse = contentHasBlockType(prevMessage?.content, 'tool_use');
    const wouldOrphanToolResult = nextHasToolResult && !prevHasToolUse;

    if (wouldBreakAlternation || wouldOrphanToolResult) {
      result.push({ ...message, content: reasoningElidedPlaceholder() });
    }
    // else: drop — push nothing for this message.
  }

  return { payload: { ...payload, messages: result }, strippedCount };
}

/** Per-target, per-request bound: at most one signature-strip-and-retry cycle. */
export const MAX_THINKING_SIGNATURE_STRIP_RETRIES = 1;

/** Tracks signature-strip-and-retry progress for a single target within one request. */
export interface ThinkingSignatureStripState {
  attempts: number;
}

export function createThinkingSignatureStripState(): ThinkingSignatureStripState {
  return { attempts: 0 };
}

/**
 * Decides whether an upstream 400 body naming an invalid thinking-block
 * signature should trigger a strip-and-retry cycle against the same target,
 * recording the attempt in `state` when it does. Returns `false` when the
 * retry should NOT happen because:
 *   - the body doesn't name a thinking-signature error, OR
 *   - the outbound payload isn't Anthropic-messages-shaped (no `messages`
 *     array to strip thinking blocks from), OR
 *   - MAX_THINKING_SIGNATURE_STRIP_RETRIES has already been used for this
 *     target (bounded to exactly one retry — unlike the unsupported-param
 *     strip, there's no "new param" escape hatch here: once the thinking
 *     blocks are gone, a repeat 400 means stripping them didn't fix it, so
 *     normal failover should proceed rather than retrying again).
 */
export function planThinkingSignatureStrip(
  responseBody: string,
  payload: any,
  state: ThinkingSignatureStripState
): boolean {
  if (state.attempts >= MAX_THINKING_SIGNATURE_STRIP_RETRIES) return false;
  if (!matchThinkingSignatureError(responseBody)) return false;
  if (!isAnthropicMessagesPayload(payload)) return false;

  state.attempts++;
  return true;
}

/**
 * Refunds the attempt recorded by the most recent `planThinkingSignatureStrip`
 * when the paired `stripThinkingSignatureBlocks` turned out to be a no-op
 * (`strippedCount` 0 — the structural `messages`-array check matched an
 * OpenAI-format payload that carries no thinking blocks). No retry happened,
 * so the budget must not be consumed: a LATER genuine signature 400 on the
 * same target must still get its one strip-and-retry.
 *
 * Loop safety: the refund is issued only on the signature branch's no-strip
 * path, which itself never `continue`s — so a refund can never re-arm the
 * signature retry it was issued for. The refunding ITERATION may still
 * `continue` via the unsupported-param handling in the latter half of the
 * same `response.status === 400` guard, but that retry consumes an attempt
 * from the param-strip budget, so the combined fetch bound in
 * standard-attempt-request.ts holds: every extra fetch consumes an
 * un-refunded attempt from one of the two strip budgets.
 */
export function refundThinkingSignatureStrip(state: ThinkingSignatureStripState): void {
  if (state.attempts > 0) state.attempts--;
}
