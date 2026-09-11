import { getCatalogModel } from '../../services/pi-ai/catalog';
import {
  clampEffortToWindow,
  normalizeEffort,
  splitReasoningSuffix,
} from '../../services/pi-ai/reasoning';

/**
 * Check whether an Anthropic model supports disabling thinking.
 *
 * Models like Claude Opus 5 and Claude Fable 5 have `thinkingLevelMap.off === null`,
 * meaning thinking cannot be disabled. For these models, any client attempt to turn
 * thinking off (e.g. `thinking: { type: 'disabled' }` or `output_config: { effort: 'off' }`)
 * must be clamped to the model's lowest supported thinking mode: adaptive thinking with low effort.
 */
export function anthropicModelSupportsDisable(modelId?: string): boolean {
  if (!modelId) return true;
  let cleanId = modelId.trim().toLowerCase();
  cleanId = splitReasoningSuffix(cleanId).alias;
  cleanId = cleanId.replace(/^anthropic\//, '');
  const baseId = cleanId.replace(/-\d{8}$/, '');
  const model = getCatalogModel('anthropic', cleanId) ?? getCatalogModel('anthropic', baseId);
  if (model && typeof model === 'object' && 'thinkingLevelMap' in model) {
    const map = model.thinkingLevelMap;
    if (map && typeof map === 'object' && 'off' in map) {
      return (map as Record<string, unknown>).off !== null;
    }
  }
  if (/(?:opus-5|fable-5)/i.test(cleanId)) {
    return false;
  }
  return true;
}

/**
 * Clamp Anthropic thinking and effort values to valid ranges.
 *
 * Anthropic's Messages API accepts only 'low', 'medium', 'high', 'xhigh', 'max'
 * for `output_config.effort`. It rejects 'minimal' or 'off' with:
 *   "Provider failed: 400 output_config.effort: Input should be 'low', 'medium', 'high', 'xhigh' or 'max'"
 *
 * This function:
 * 1. Clamps any `output_config.effort` to `['low', 'max']` (e.g. 'minimal' -> 'low').
 * 2. If a model cannot disable thinking (e.g. Claude Opus 5), maps disabled thinking
 *    or effort 'off' to adaptive thinking with effort 'low'.
 * 3. If a model can disable thinking and effort is 'off', removes `output_config.effort`
 *    and sets `thinking: { type: 'disabled' }`.
 * 4. Ensures `output_config.effort` is not sent when `thinking: { type: 'disabled' }`.
 */
export function clampAnthropicEffortAndThinking<T extends Record<string, unknown>>(
  payload: T,
  modelId?: string
): T & {
  thinking?: { type: string; display?: string };
  output_config?: { effort?: string };
} {
  if (!payload || typeof payload !== 'object') return payload;

  const rawModel =
    typeof payload.model === 'string' && payload.model.trim() ? payload.model.trim() : undefined;
  const model = rawModel || modelId;
  const supportsDisable = anthropicModelSupportsDisable(model);

  const outputConfig =
    payload.output_config && typeof payload.output_config === 'object'
      ? (payload.output_config as Record<string, unknown>)
      : undefined;
  const rawEffort = outputConfig?.effort;
  const hasEffort = rawEffort !== undefined;
  const normalizedEffort = hasEffort ? normalizeEffort(rawEffort) : undefined;

  const thinking =
    payload.thinking && typeof payload.thinking === 'object'
      ? (payload.thinking as Record<string, unknown>)
      : undefined;
  const thinkingDisabled = thinking?.type === 'disabled';

  if (!supportsDisable) {
    // Model cannot disable thinking (e.g. Claude Opus 5, Fable 5)
    if (thinkingDisabled || normalizedEffort === 'off') {
      (payload as Record<string, unknown>).thinking = {
        type: 'adaptive',
        ...(typeof thinking?.display === 'string' ? { display: thinking.display } : {}),
      };
      (payload as Record<string, unknown>).output_config = {
        ...(outputConfig ?? {}),
        effort: 'low',
      };
    } else if (hasEffort && outputConfig) {
      const clamped = normalizedEffort
        ? clampEffortToWindow(normalizedEffort, 'low', 'max')
        : 'low';
      outputConfig.effort = clamped;
    }
  } else {
    if (normalizedEffort === 'off') {
      if (outputConfig) {
        delete outputConfig.effort;
        if (Object.keys(outputConfig).length === 0)
          delete (payload as Record<string, unknown>).output_config;
      }
      (payload as Record<string, unknown>).thinking = { type: 'disabled' };
    } else if (thinkingDisabled) {
      if (outputConfig?.effort) {
        delete outputConfig.effort;
        if (Object.keys(outputConfig).length === 0)
          delete (payload as Record<string, unknown>).output_config;
      }
    } else if (hasEffort && outputConfig) {
      const clamped = normalizedEffort
        ? clampEffortToWindow(normalizedEffort, 'low', 'max')
        : 'low';
      outputConfig.effort = clamped;
    }
  }

  return payload;
}
