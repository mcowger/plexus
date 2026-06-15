import type { ProviderAdapter } from '../../types/provider-adapter';
import type { ModelOverrideOptions } from '../../config';
import { logger } from '../../utils/logger';

/**
 * model_override adapter
 *
 * Conditionally rewrites `payload.model` based on the presence or values of
 * arbitrary fields in the outgoing request payload.
 *
 * This enables providers that expose reasoning variants as separate model
 * names (e.g. `deepseek-r1` with reasoning, `deepseek-r1-fast` without) to
 * be routed correctly even though the upstream client sets a `reasoning`
 * field rather than picking the variant model.
 *
 * Options schema (ModelOverrideOptions):
 *   rules: [
 *     {
 *       model: "deepseek-r1",            // match payload.model
 *       rewriteTo: "deepseek-r1-fast",  // rewrite to this model
 *       conditions: [                    // ANY match triggers rewrite (OR)
 *         { field: "reasoning.enabled", value: false },
 *         { field: "reasoning.effort", value: "none" },
 *       ]
 *     },
 *     {
 *       model: "deepseek-r1-fast",
 *       rewriteTo: "deepseek-r1",
 *       conditions: [
 *         { field: "reasoning.enabled", value: true },
 *       ]
 *     },
 *   ]
 *
 * Outbound (preDispatch):
 *   - If payload.model matches a rule's `model` field AND any condition is satisfied,
 *     payload.model is rewritten to `rewriteTo`.
 *
 * Inbound (postDispatch): no-op — model name in responses is not rewritten.
 *
 * Stream: no-op — providers do not typically echo model names in SSE chunks.
 */
export const modelOverrideAdapter: ProviderAdapter = {
  name: 'model_override',

  preDispatch(payload: Record<string, any>, options?: Record<string, any>): Record<string, any> {
    if (!options || !options.rules || !Array.isArray(options.rules)) return payload;

    const rules = options.rules as ModelOverrideOptions['rules'];

    for (const rule of rules) {
      if (payload.model !== rule.model) continue;

      // Check conditions — any match (OR) triggers the rewrite
      const matched = rule.conditions.some((condition) => evaluateCondition(payload, condition));

      if (matched) {
        logger.debug(
          `model_override: rewriting model '${payload.model}' → '${rule.rewriteTo}' ` +
            `(rule matched on ${rule.model})`
        );
        return { ...payload, model: rule.rewriteTo };
      }
    }

    return payload;
  },

  postDispatch(response: Record<string, any>, _options?: Record<string, any>): Record<string, any> {
    return response;
  },
};

/**
 * Evaluate a single condition against a payload.
 *
 * - If `condition.value` is provided: matches when the field at the dotted path
 *   equals that value (strict equality).
 * - If `condition.value` is omitted: matches when the field at the dotted path
 *   is present (not undefined).
 */
function evaluateCondition(
  payload: Record<string, any>,
  condition: { field: string; value?: any }
): boolean {
  const actual = resolveDottedPath(payload, condition.field);

  if (condition.value !== undefined) {
    // Value match — strict equality
    return actual === condition.value;
  }

  // Presence check — field must exist (not undefined)
  return actual !== undefined;
}

/**
 * Resolve a dotted path (e.g. "reasoning.enabled") into the corresponding
 * value in a nested object. Returns `undefined` if the path cannot be fully
 * resolved.
 */
export function resolveDottedPath(obj: Record<string, any>, path: string): any {
  const segments = path.split('.');
  let current: any = obj;

  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = current[segment];
  }

  return current;
}
