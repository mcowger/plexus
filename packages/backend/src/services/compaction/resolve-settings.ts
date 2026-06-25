import {
  COMPACTION_DEFAULTS,
  type CompactionSettings,
  type ResolvedCompactionSettings,
} from './types';

/**
 * Returns the first non-null, non-undefined value from the provided list.
 * Used to implement alias > provider > global precedence.
 */
function pick<T>(...vals: (T | null | undefined)[]): T | undefined {
  for (const v of vals) {
    if (v !== null && v !== undefined) return v;
  }
  return undefined;
}

/**
 * Resolve compaction settings by merging three override layers with field-level
 * precedence: alias > provider > global > COMPACTION_DEFAULTS.
 *
 * Nested objects (native, headroom) are merged field-by-field — a layer only
 * contributes the specific sub-fields it defines, leaving the rest to lower
 * layers or defaults.
 */
export function resolveCompactionSettings(
  global?: CompactionSettings,
  provider?: CompactionSettings,
  alias?: CompactionSettings
): ResolvedCompactionSettings {
  return {
    enabled:
      pick(alias?.enabled, provider?.enabled, global?.enabled) ?? COMPACTION_DEFAULTS.enabled,

    strategy:
      pick(alias?.strategy, provider?.strategy, global?.strategy) ?? COMPACTION_DEFAULTS.strategy,

    triggerRatio:
      pick(alias?.triggerRatio, provider?.triggerRatio, global?.triggerRatio) ??
      COMPACTION_DEFAULTS.triggerRatio,

    absoluteTriggerTokens:
      pick(
        alias?.absoluteTriggerTokens,
        provider?.absoluteTriggerTokens,
        global?.absoluteTriggerTokens
      ) ?? COMPACTION_DEFAULTS.absoluteTriggerTokens,

    minTokens:
      pick(alias?.minTokens, provider?.minTokens, global?.minTokens) ??
      COMPACTION_DEFAULTS.minTokens,

    protectRecent:
      pick(alias?.protectRecent, provider?.protectRecent, global?.protectRecent) ??
      COMPACTION_DEFAULTS.protectRecent,

    native: {
      maxArrayItems:
        pick(
          alias?.native?.maxArrayItems,
          provider?.native?.maxArrayItems,
          global?.native?.maxArrayItems
        ) ?? COMPACTION_DEFAULTS.native.maxArrayItems,

      maxStringChars:
        pick(
          alias?.native?.maxStringChars,
          provider?.native?.maxStringChars,
          global?.native?.maxStringChars
        ) ?? COMPACTION_DEFAULTS.native.maxStringChars,
    },

    headroom: {
      baseUrl:
        pick(alias?.headroom?.baseUrl, provider?.headroom?.baseUrl, global?.headroom?.baseUrl) ??
        COMPACTION_DEFAULTS.headroom.baseUrl,

      apiKey:
        pick(alias?.headroom?.apiKey, provider?.headroom?.apiKey, global?.headroom?.apiKey) ??
        COMPACTION_DEFAULTS.headroom.apiKey,

      targetRatio:
        pick(
          alias?.headroom?.targetRatio,
          provider?.headroom?.targetRatio,
          global?.headroom?.targetRatio
        ) ?? COMPACTION_DEFAULTS.headroom.targetRatio,

      timeoutMs:
        pick(
          alias?.headroom?.timeoutMs,
          provider?.headroom?.timeoutMs,
          global?.headroom?.timeoutMs
        ) ?? COMPACTION_DEFAULTS.headroom.timeoutMs,
    },
  };
}
