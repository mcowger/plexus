import type { ProviderAdapter } from '../../types/provider-adapter';
import type { ReasoningRewriteOptions, FieldRewrite, MatchCondition } from '../../config';
import { resolveDottedPath } from './model-override.adapter';
import { logger } from '../../utils/logger';

/**
 * reasoning_rewrite adapter
 *
 * Declaratively rewrites reasoning/thinking fields in the outbound provider
 * payload. Different providers accept reasoning effort via different field
 * names and shapes — e.g. `enable_thinking`, `thinking.type`,
 * `chat_template_kwargs.enable_thinking`, `budget_tokens`, `thinking_budget`,
 * or `reasoning.effort`. This adapter reads from unified fields and writes to
 * provider-specific fields, optionally stripping the unified fields afterward.
 *
 * Options schema (ReasoningRewriteOptions):
 *   rules: [
 *     {
 *       source: "reasoning.enabled",       // read from this dotted path
 *       when: { op: "present" },           // optional condition on source value
 *       rewrites: [
 *         {
 *           target: "enable_thinking",    // write to this dotted path
 *           value: { from: "source" },    // pass source value through
 *         },
 *         {
 *           target: "thinking.type",
 *           value: { from: "boolean", truthy: "enabled", falsy: "disabled" },
 *         },
 *       ],
 *       strip: ["reasoning"],              // remove these paths after rewriting
 *     },
 *     {
 *       source: "reasoning.effort",
 *       when: { op: "eq", value: "none" },
 *       rewrites: [{ target: "budget_tokens", value: 0 }],
 *       strip: ["reasoning"],
 *     },
 *     {
 *       source: "reasoning.effort",
 *       when: { op: "in", values: ["low","medium","high"] },
 *       rewrites: [
 *         {
 *           target: "budget_tokens",
 *           value: { from: "map", values: { low: 1024, medium: 8192, high: 32768 } },
 *         },
 *       ],
 *     },
 *   ]
 *
 * Outbound (preDispatch):
 *   - For each rule, reads the source field from the payload.
 *   - If `when` is specified, evaluates the condition; skips the rule if it fails.
 *   - If `when` is omitted, the rule fires when the source field is present (not undefined).
 *   - For each rewrite in the rule, computes the target value and writes it via setDottedPath.
 *   - After all rewrites, strips any paths listed in `strip`.
 *
 * Inbound (postDispatch): no-op.
 * Stream: no-op.
 */

export const reasoningRewriteAdapter: ProviderAdapter = {
  name: 'reasoning_rewrite',

  preDispatch(payload: Record<string, any>, options?: Record<string, any>): Record<string, any> {
    if (!options || !options.rules || !Array.isArray(options.rules)) return payload;

    const rules = options.rules as ReasoningRewriteOptions['rules'];
    if (rules.length === 0) return payload;

    // Deep-clone so we don't mutate the original (deferred until first mutation)
    let result: Record<string, any> | null = null;
    const mutate = (): Record<string, any> => result ?? (result = structuredClone(payload));

    for (const rule of rules) {
      const sourceValue = resolveDottedPath(result ?? payload, rule.source);

      // Default: rule fires when source field is present (not undefined)
      const shouldFire = rule.when
        ? evaluateCondition(sourceValue, rule.when)
        : sourceValue !== undefined;

      if (!shouldFire) continue;

      const obj = mutate(); // clone on first actual mutation
      logger.debug(
        `reasoning_rewrite: rule matched source '${rule.source}' ` +
          `(value: ${JSON.stringify(sourceValue)})`
      );

      for (const rewrite of rule.rewrites) {
        const targetValue = computeTargetValue(sourceValue, rewrite);
        setDottedPath(obj, rewrite.target, targetValue);
        logger.debug(`reasoning_rewrite:   ${rewrite.target} = ${JSON.stringify(targetValue)}`);
      }

      if (rule.strip && Array.isArray(rule.strip)) {
        for (const stripPath of rule.strip) {
          removeDottedPath(obj, stripPath);
          logger.debug(`reasoning_rewrite:   stripped '${stripPath}'`);
        }
      }
    }

    return result ?? payload;
  },

  postDispatch(response: Record<string, any>, _options?: Record<string, any>): Record<string, any> {
    return response;
  },
};

// ── Condition evaluation ────────────────────────────────────────────────

/**
 * Evaluate a MatchCondition against the resolved source value.
 *
 * `undefined` means the source field was not present in the payload.
 */
function evaluateCondition(sourceValue: any, condition: MatchCondition): boolean {
  switch (condition.op) {
    case 'present':
      return sourceValue !== undefined;
    case 'absent':
      return sourceValue === undefined;
    case 'eq':
      return sourceValue === condition.value;
    case 'neq':
      return sourceValue !== condition.value;
    case 'gt':
      return sourceValue > condition.value;
    case 'gte':
      return sourceValue >= condition.value;
    case 'lt':
      return sourceValue < condition.value;
    case 'lte':
      return sourceValue <= condition.value;
    case 'in':
      return Array.isArray(condition.values) && condition.values.includes(sourceValue);
    default:
      return false;
  }
}

// ── Target value computation ────────────────────────────────────────────

/**
 * Compute the value to write at the target path.
 *
 * - Literal values (string | number | boolean | null) are returned as-is.
 * - { from: "source" }          → copy the source value verbatim
 * - { from: "map", values: {} } → lookup source value in the map; if not found, undefined (skip write)
 * - { from: "boolean", truthy: X, falsy: Y } → coerce source to bool → map
 */
function computeTargetValue(sourceValue: any, rewrite: FieldRewrite): any {
  const v = rewrite.value;

  // Literal value (primitives and null)
  if (v === null || v === undefined || typeof v !== 'object') {
    return v;
  }

  // Value transform objects
  if (typeof v === 'object' && 'from' in v) {
    const from = v.from as string;

    if (from === 'source') {
      return sourceValue;
    }

    if (from === 'map') {
      const map = v.values as Record<string, any>;
      if (map && sourceValue in map) {
        return map[sourceValue];
      }
      // Key not in map — return undefined so the write is skipped
      return undefined;
    }

    if (from === 'boolean') {
      const coerced = !!sourceValue;
      return coerced ? v.truthy : v.falsy;
    }
  }

  // Fallback: return as-is (covers objects the user might pass as literals)
  return v;
}

// ── Dotted-path helpers ────────────────────────────────────────────────

/**
 * Set a value at a dotted path, creating intermediate objects as needed.
 *
 * Example: setDottedPath(payload, "chat_template_kwargs.enable_thinking", true)
 * will create `payload.chat_template_kwargs = {}` if it doesn't exist, then set
 * `enable_thinking = true` on it.
 */
export function setDottedPath(obj: Record<string, any>, path: string, value: any): void {
  if (value === undefined) return; // skip undefined writes

  const segments = path.split('.');
  if (segments.length === 0) return;
  const lastKey = segments[segments.length - 1]!;
  let current: any = obj;

  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    if (current[seg] === null || current[seg] === undefined || typeof current[seg] !== 'object') {
      current[seg] = {};
    }
    current = current[seg];
  }

  current[lastKey] = value;
}

/**
 * Remove the leaf value at a dotted path.
 *
 * Does NOT prune empty parent objects — this is intentional because
 * a parent object may have other keys that should be preserved.
 *
 * If the path doesn't exist, this is a no-op.
 */
export function removeDottedPath(obj: Record<string, any>, path: string): void {
  const segments = path.split('.');
  if (segments.length === 0) return;
  const lastKey = segments[segments.length - 1]!;
  let current: any = obj;

  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    if (current[seg] === null || current[seg] === undefined || typeof current[seg] !== 'object') {
      return; // path doesn't exist, nothing to remove
    }
    current = current[seg];
  }

  delete current[lastKey];
}
