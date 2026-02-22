/**
 * Model Behaviors
 *
 * Applies alias-level "advanced" behaviors to an outgoing provider payload
 * before it is dispatched. Each behavior is identified by its `type` discriminant,
 * making it straightforward to add new behaviors in the future:
 *
 *   1. Add a new Zod schema variant in config.ts `ModelBehaviorSchema`.
 *   2. Add a corresponding `case` block in `applyBehavior` below.
 *   3. Expose a UI toggle in the frontend Advanced accordion.
 */

import type { ModelBehavior } from '../config';
import { logger } from '../utils/logger';

/**
 * Context passed to every behavior so they can inspect the full request
 * environment without coupling to Dispatcher internals.
 */
export interface BehaviorContext {
  /** The raw incoming API type (e.g. 'messages', 'chat'). */
  incomingApiType: string;
  /** The canonical alias name (key in config.models). */
  canonicalModel: string;
}

/**
 * Applies all enabled `advanced` behaviors to `payload` in order.
 * Returns a (potentially mutated) copy of the payload.
 */
export function applyModelBehaviors(
  payload: Record<string, any>,
  behaviors: ModelBehavior[] | undefined,
  ctx: BehaviorContext
): Record<string, any> {
  if (!behaviors || behaviors.length === 0) return payload;

  // Work on a shallow clone so we never mutate the original in-place
  let result = { ...payload };

  for (const behavior of behaviors) {
    if ((behavior as any).enabled === false) continue;
    result = applyBehavior(result, behavior, ctx);
  }

  return result;
}

function applyBehavior(
  payload: Record<string, any>,
  behavior: ModelBehavior,
  ctx: BehaviorContext
): Record<string, any> {
  switch (behavior.type) {
    case 'strip_adaptive_thinking':
      return applyStripAdaptiveThinking(payload, ctx);

    // ← add new cases here as new behavior types are introduced

    default: {
      // Runtime safety for unknown types (e.g. from older config files)
      logger.warn(`[model-behaviors] Unknown behavior type: ${(behavior as any)?.type}`);
      return payload;
    }
  }
}

// ─── Individual behavior implementations ──────────────────────────

/**
 * strip_adaptive_thinking
 *
 * Only active on the `messages` (Anthropic) path.
 * If the outgoing payload contains `thinking.type === 'adaptive'`, removes the
 * entire `thinking` field so the provider uses its default behaviour.
 * Any other `thinking` value is passed through unchanged.
 */
function applyStripAdaptiveThinking(
  payload: Record<string, any>,
  ctx: BehaviorContext
): Record<string, any> {
  if (ctx.incomingApiType !== 'messages') return payload;

  const thinking = payload.thinking;
  if (thinking && typeof thinking === 'object' && thinking.type === 'adaptive') {
    logger.debug(
      `[model-behaviors] strip_adaptive_thinking: removing thinking.type='adaptive' ` +
        `for alias '${ctx.canonicalModel}'`
    );
    const { thinking: _removed, ...rest } = payload;
    return rest;
  }

  return payload;
}
