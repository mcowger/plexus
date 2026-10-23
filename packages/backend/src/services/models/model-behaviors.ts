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
 *
 * Some behaviors also apply implicitly: `inject_cache_control` is enabled for
 * any alias that dispatches to Anthropic's own API (see `resolveBehaviors`),
 * because a translated request can never carry breakpoints of its own.
 */

import {
  DEFAULT_INJECT_CACHE_CONTROL_BEHAVIOR,
  type InjectCacheControlBehavior,
  type ModelBehavior,
} from '../../config';
import { logger } from '../../utils/logger';
import { injectCacheControlBreakpoints } from './cache-control-injection';

/**
 * Context passed to every behavior so they can inspect the full request
 * environment without coupling to Dispatcher internals.
 */
export interface BehaviorContext {
  /** The raw incoming API type (e.g. 'messages', 'chat'). */
  incomingApiType: string;
  /** The canonical alias name (key in config.models). */
  canonicalModel: string;
  /** The resolved wire API type of the target (e.g. 'messages', 'chat'). */
  targetApiType: string;
  /**
   * True when the resolved route dispatches to Anthropic's own API. Aliases
   * that don't configure `inject_cache_control` get it implicitly here.
   */
  autoEnableCacheControl?: boolean;
  /**
   * True when the native Anthropic path rebuilds `system` after behaviors run
   * (OAuth and Claude-masking routes). A breakpoint placed there would be
   * discarded, so the injector skips that site.
   */
  systemRewrittenByMasking?: boolean;
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
  const effective = resolveBehaviors(behaviors, ctx);
  if (effective.length === 0) return payload;

  // Work on a shallow clone so we never mutate the original in-place
  let result = { ...payload };

  for (const behavior of effective) {
    if ((behavior as any).enabled === false) continue;
    result = applyBehavior(result, behavior, ctx);
  }

  return result;
}

/**
 * Expands the configured behavior list with the implicit ones. An alias that
 * configures `inject_cache_control` at all (even with `enabled: false`) always
 * wins over the auto-enable below.
 */
function resolveBehaviors(
  behaviors: ModelBehavior[] | undefined,
  ctx: BehaviorContext
): ModelBehavior[] {
  const configured = behaviors ?? [];
  if (!ctx.autoEnableCacheControl) return configured;
  if (configured.some((behavior) => behavior.type === 'inject_cache_control')) return configured;
  return [...configured, DEFAULT_INJECT_CACHE_CONTROL_BEHAVIOR];
}

function applyBehavior(
  payload: Record<string, any>,
  behavior: ModelBehavior,
  ctx: BehaviorContext
): Record<string, any> {
  switch (behavior.type) {
    case 'strip_adaptive_thinking':
      return applyStripAdaptiveThinking(payload, ctx);

    case 'inject_cache_control':
      return applyInjectCacheControl(payload, behavior, ctx);

    // ← add new cases here as new behavior types are introduced

    default: {
      // Runtime safety for unknown types (e.g. from older config files)
      logger.warn(`Unknown behavior type: ${(behavior as any)?.type}`);
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
      `strip_adaptive_thinking: removing thinking.type='adaptive' ` +
        `for alias '${ctx.canonicalModel}'`
    );
    const { thinking: _removed, ...rest } = payload;
    return rest;
  }

  return payload;
}

/**
 * inject_cache_control
 *
 * Only active when a chat/responses request is translated to Messages. Fills
 * `cache_control` breakpoints into the static prefix (tools, system) and the
 * conversation tail. See services/models/cache-control-injection.ts.
 */
function applyInjectCacheControl(
  payload: Record<string, any>,
  behavior: InjectCacheControlBehavior,
  ctx: BehaviorContext
): Record<string, any> {
  // Individual fields can be missing at runtime: `advanced` is persisted as raw
  // JSON and read back without re-parsing through the schema, so the injector
  // applies the documented defaults rather than assuming them.
  const { payload: next, sites } = injectCacheControlBreakpoints(
    payload,
    ctx.incomingApiType,
    ctx.targetApiType,
    {
      tools: behavior.tools,
      // The masking transform rebuilds `system` from fixed Claude Code blocks
      // after this runs, dropping any marker placed here — and its billing
      // header is payload-derived, so that prefix would not cache reliably
      // anyway. Skipping the site keeps the debug log honest; the freed slot
      // is left unused rather than spent on an extra trailing breakpoint.
      system: behavior.system !== false && ctx.systemRewrittenByMasking !== true,
      messageBreakpoints: behavior.message_breakpoints,
      ttl: behavior.ttl,
    }
  );

  if (sites.length > 0) {
    logger.debug(
      `inject_cache_control: marked ${sites.join(', ')} ` +
        `(ttl=${behavior.ttl ?? 'default'}) for alias '${ctx.canonicalModel}'`
    );
  }

  return next;
}
