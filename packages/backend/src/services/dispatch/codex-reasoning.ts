import { normalizeEffort } from '../pi-ai/reasoning';
import type { CodexReasoningCapabilities } from '../providers/provider-model-discovery';

const EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

type WireReasoning = Record<string, unknown> & { effort?: unknown };
type WireInputItem = Record<string, unknown> & { reasoning?: WireReasoning };
type CodexPayload = Record<string, unknown> & { reasoning?: WireReasoning; input?: unknown };

function resolveEffort(raw: string, capabilities?: CodexReasoningCapabilities): string | undefined {
  const allowed = capabilities?.supportedEfforts;
  // These are Codex modes, not additional rungs on the reasoning scale.
  // In particular, generic Responses normalization treats "disabled" as off.
  if (raw === 'persistent' || raw === 'disabled') {
    return allowed?.includes('persistent') || allowed?.includes('disabled')
      ? 'disabled'
      : undefined;
  }
  if (raw === 'ultra' && allowed?.includes('ultra')) {
    const preferred = capabilities?.multiAgentEffort;
    if (preferred && preferred !== 'ultra' && allowed.includes(preferred)) {
      return resolveEffort(preferred, capabilities);
    }
    if (allowed.includes('max')) return 'max';
    const highest = allowed.findLast((effort) => effort !== 'ultra');
    return highest ? resolveEffort(highest, capabilities) : undefined;
  }

  // Preserve exact catalog values, including new model-defined effort names.
  if (allowed?.includes(raw)) return raw;
  const normalized = normalizeEffort(raw);
  const effort = normalized === 'off' ? 'none' : normalized;
  if (!allowed) return raw === 'ultra' ? undefined : (effort ?? raw);
  if (effort && allowed.includes(effort)) return effort;
  const requested = raw === 'ultra' ? EFFORT_ORDER.length : EFFORT_ORDER.indexOf(effort ?? '');
  if (requested < 0) return undefined;

  let lowest: string | undefined;
  let floor: string | undefined;
  for (const [index, level] of EFFORT_ORDER.entries()) {
    if (!allowed.includes(level)) continue;
    lowest ??= level;
    if (index <= requested) floor = level;
  }
  return floor ?? lowest;
}

function isConfigurationUpdate(item: unknown): item is WireInputItem {
  return (
    item !== null &&
    typeof item === 'object' &&
    'type' in item &&
    item.type === 'configuration_update'
  );
}

/** Only the outbound copy changes; saved history and later attempts retain the client's intent. */
export function projectCodexReasoning(
  payload: CodexPayload,
  capabilities: CodexReasoningCapabilities | undefined
): CodexPayload {
  let next = payload;
  if (payload.reasoning && typeof payload.reasoning === 'object') {
    const { effort: raw, enabled, max_tokens, adaptive, ...fields } = payload.reasoning;
    const requested = enabled === false ? 'off' : raw;
    const effort =
      typeof requested === 'string' ? resolveEffort(requested, capabilities) : requested;
    if (
      effort !== raw ||
      enabled !== undefined ||
      max_tokens !== undefined ||
      adaptive !== undefined
    ) {
      next = { ...payload, reasoning: effort === undefined ? fields : { ...fields, effort } };
      if (effort === undefined && Object.keys(fields).length === 0) delete next.reasoning;
    }
  }

  if (!Array.isArray(payload.input)) return next;
  let input: unknown[] | undefined;
  for (const [index, item] of payload.input.entries()) {
    let projected: unknown = item;
    if (isConfigurationUpdate(item)) {
      const raw = item.reasoning?.effort;
      if (capabilities?.supportsEffortUpdates && typeof raw === 'string') {
        const effort =
          resolveEffort(raw, capabilities) ??
          (capabilities.defaultEffort && resolveEffort(capabilities.defaultEffort, capabilities));
        projected =
          effort === raw
            ? item
            : effort
              ? { ...item, reasoning: { ...item.reasoning, effort } }
              : undefined;
      } else {
        projected = undefined;
      }
    }
    if (projected !== item) input ??= payload.input.slice(0, index);
    if (projected !== undefined) input?.push(projected);
  }
  return input ? { ...next, input } : next;
}

export function needsCodexReasoningCapabilities(payload: CodexPayload): boolean {
  return (
    typeof payload.reasoning?.effort === 'string' ||
    payload.reasoning?.enabled === false ||
    (Array.isArray(payload.input) && payload.input.some(isConfigurationUpdate))
  );
}
