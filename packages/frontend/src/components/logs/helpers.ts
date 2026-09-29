import type { UsageRecord } from '../../types/usage';
import { getApiBaseType, isDecisionsTargetAccess } from '../../lib/apiFormats';

/** True when `apiType` is the Decisions ingress type or a Decisions target protocol. */
export const isDecisionsApiType = (apiType?: string | null): boolean => {
  if (!apiType) return false;
  const base = getApiBaseType(apiType);
  // Logs predate the collapse; the shared helper still recognizes the
  // legacy `openrouter-decisions` / `typesafe-decisions` target names.
  return base === 'decisions' || isDecisionsTargetAccess(base);
};

export const formatReasoningEffort = (effort?: string | null): string | null => {
  if (!effort) return null;
  return effort.charAt(0).toUpperCase() + effort.slice(1);
};

export const hasUpstreamRewrite = (
  log: Pick<UsageRecord, 'finalAttemptModel' | 'selectedModelName' | 'upstreamModel'>
): boolean => {
  const routeModel = log.finalAttemptModel ?? log.selectedModelName;
  return Boolean(log.upstreamModel) && log.upstreamModel !== routeModel;
};

export const getAttemptIndicatorLabel = (attemptCount?: number | null): string | null => {
  if (attemptCount && attemptCount > 1) return `${attemptCount}x`;
  return null;
};

export const formatDateSafely = (dateStr: string | undefined | null) => {
  if (!dateStr) return { time: '-', date: '-' };
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return { time: 'Invalid', date: 'Date' };
    return {
      time: d.toLocaleTimeString(),
      date: d.toISOString().split('T')[0],
    };
  } catch {
    return { time: 'Error', date: 'Date' };
  }
};
