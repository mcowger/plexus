import { FastifyRequest, FastifyReply } from 'fastify';
import { QuotaEnforcer, UsageRecord, QuotaContext, QuotaCheckSnapshot } from './quota-enforcer';
import { logger } from '../../utils/logger';

interface QuotaUsageRecord {
  tokensInput?: number | null;
  tokensOutput?: number | null;
  tokensCached?: number | null;
  tokensCacheWrite?: number | null;
  tokensReasoning?: number | null;
  costTotal?: number | null;
}

export interface QuotaCheckResult {
  ok: boolean;
  context: QuotaContext | null;
}

/**
 * Pick the most-constrained snapshot (smallest remaining/limit ratio) out of
 * a blocking set — used to populate the legacy single-quota top-level
 * fields on the 429 body. Pure; assumes `blocking` is non-empty. A
 * `limit === 0` definition is treated as fully constrained (ratio 0) rather
 * than dividing by zero.
 */
function selectMostConstrained(blocking: QuotaCheckSnapshot[]): QuotaCheckSnapshot {
  const ratio = (q: QuotaCheckSnapshot) => (q.limit > 0 ? q.remaining / q.limit : 0);
  return blocking.reduce((min, q) => (ratio(q) < ratio(min) ? q : min));
}

/**
 * Build the 429 response body for one or more exhausted quotas. Keeps the
 * legacy top-level shape (message/quota_name/current_usage/limit/resets_at,
 * derived from the most-constrained blocking snapshot) for backward
 * compatibility, and adds `blocking_quotas` — one entry per blocking
 * snapshot — so callers can see every quota that contributed to the block.
 */
export function buildQuotaExceededBody(blocking: QuotaCheckSnapshot[]): Record<string, unknown> {
  const primary = selectMostConstrained(blocking);
  return {
    error: {
      message: `Quota exceeded: ${primary.quotaName} limit of ${primary.limit} reached`,
      type: 'quota_exceeded',
      quota_name: primary.quotaName,
      current_usage: primary.currentUsage,
      limit: primary.limit,
      resets_at: new Date(primary.resetsAtMs).toISOString(),
      blocking_quotas: blocking.map((q) => ({
        quotaName: q.quotaName,
        limitType: q.limitType,
        limit: q.limit,
        currentUsage: q.currentUsage,
        remaining: q.remaining,
        resetsAt: new Date(q.resetsAtMs).toISOString(),
      })),
    },
  };
}

/**
 * Build the terminal quota-exceeded error thrown when routing has no
 * remaining candidates (either a blocked global quota up front, or every
 * candidate filtered out by scoped quotas). Mirrors the EXACT pattern of
 * `buildAccessDeniedError` in key-access-policy.ts — a plain Error carrying
 * `routingContext` — so existing route catch handlers can map it to a reply
 * the same way they already do for access-denied errors.
 *
 * `retryHistory` (the caller's skip entries, e.g. `quota_exceeded:<name>`)
 * is threaded into routingContext as a JSON string — matching the
 * failover-exhaustion pattern in dispatcher.buildAllTargetsFailedError — so
 * the saved UsageRecord keeps the breadcrumbs even when every candidate was
 * quota-blocked.
 */
export function buildQuotaExceededError(
  blocking: QuotaCheckSnapshot[],
  retryHistory?: unknown[]
): Error {
  const primary = selectMostConstrained(blocking);
  const error = new Error(
    `Quota exceeded: ${primary.quotaName} limit of ${primary.limit} reached`
  ) as Error & { routingContext?: Record<string, unknown> };
  error.routingContext = {
    statusCode: 429,
    code: 'quota_exceeded',
    body: buildQuotaExceededBody(blocking),
    ...(retryHistory && retryHistory.length > 0
      ? { retryHistory: JSON.stringify(retryHistory) }
      : {}),
  };
  return error;
}

/**
 * Response headers for a successful request: `x-plexus-quota*`, derived from
 * whichever quota (global or scope-matching) is most constrained for the
 * final (provider, model). Empty object when no quota applies.
 */
export function buildQuotaHeaders(
  ctx: QuotaContext | null,
  provider: string,
  model: string
): Record<string, string> {
  const quota = QuotaEnforcer.selectHeaderQuota(ctx, provider, model);
  if (!quota) return {};

  const headers: Record<string, string> = {
    'x-plexus-quota': quota.quotaName,
    'x-plexus-quota-limit': String(quota.limit),
    'x-plexus-quota-remaining': String(quota.remaining),
    'x-plexus-quota-reset': new Date(quota.resetsAtMs).toISOString(),
  };

  if (
    quota.warnAt !== undefined &&
    quota.limit > 0 &&
    quota.currentUsage / quota.limit >= quota.warnAt
  ) {
    headers['x-plexus-quota-warning'] = quota.quotaName;
  }

  return headers;
}

/**
 * Attach a loaded QuotaContext onto a unified request's metadata, mirroring
 * how `plexus_key_policy` is attached in utils/auth.ts's
 * `attachKeyAccessPolicy`. No-op (returns the input unchanged) when `ctx` is
 * null — e.g. the key has no quotas assigned.
 */
export function attachQuotaContext<T extends { metadata?: Record<string, any> }>(
  unifiedRequest: T,
  ctx: QuotaContext | null
): T {
  if (!ctx) return unifiedRequest;

  return {
    ...unifiedRequest,
    metadata: {
      ...(unifiedRequest.metadata || {}),
      plexus_metadata: {
        ...(unifiedRequest.metadata?.plexus_metadata || {}),
        plexus_quota_context: ctx,
      },
    },
  };
}

/**
 * Reusable function for pre-request quota checks.
 *
 * Loads the full quota context for the key and blocks only on
 * `blockedGlobal` — an exhausted quota with global scope, i.e. one that
 * would block regardless of which candidate ends up being dispatched.
 * Scoped quotas are NOT enforced here: they narrow candidate routing later
 * (see Dispatcher.applyQuotaFilter / the v2 pi-ai executor), and only 429 if
 * every candidate ends up blocked.
 *
 * Always stashes the loaded context on the request (`(request as
 * any).quotaContext`) — even when `ok` is false — so callers that read
 * request state directly (the v2 executor) see it without needing the
 * return value threaded through.
 */
export async function checkQuotaMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
  quotaEnforcer: QuotaEnforcer
): Promise<QuotaCheckResult> {
  const keyName = (request as any).keyName;

  if (!keyName) {
    logger.debug('No keyName found on request, skipping quota check');
    return { ok: true, context: null };
  }

  const ctx = await quotaEnforcer.loadQuotaContext(keyName);
  (request as any).quotaContext = ctx;

  if (!ctx || !ctx.blockedGlobal) {
    return { ok: true, context: ctx };
  }

  reply.code(429).send(buildQuotaExceededBody([ctx.blockedGlobal]));
  return { ok: false, context: ctx };
}

/**
 * Reusable function for post-request usage recording. Usage is recorded
 * against the FINAL attempt's resolved provider/model — the candidate that
 * actually served the request, which the caller must resolve (may differ
 * from any candidate considered during quota filtering, e.g. after
 * failover).
 */
export async function recordQuotaUsage(
  keyName: string | undefined,
  finalProvider: string | null | undefined,
  finalModel: string | null | undefined,
  usageRecord: QuotaUsageRecord,
  quotaEnforcer: QuotaEnforcer
): Promise<void> {
  logger.debug(
    `recordQuotaUsage called: keyName=${keyName}, costTotal=${usageRecord.costTotal}, tokensInput=${usageRecord.tokensInput}`
  );
  if (!keyName) {
    logger.debug('recordQuotaUsage: no keyName, skipping');
    return;
  }

  const usage: UsageRecord = {
    tokensInput: usageRecord.tokensInput ?? undefined,
    tokensOutput: usageRecord.tokensOutput ?? undefined,
    tokensCached: usageRecord.tokensCached ?? undefined,
    tokensCacheWrite: usageRecord.tokensCacheWrite ?? undefined,
    tokensReasoning: usageRecord.tokensReasoning ?? undefined,
    costTotal: usageRecord.costTotal ?? undefined,
  };

  try {
    await quotaEnforcer.recordUsage(keyName, finalProvider ?? '', finalModel ?? '', usage);
  } catch (error) {
    // Log error but don't fail the request
    logger.error('Failed to record quota usage:', error);
  }
}
