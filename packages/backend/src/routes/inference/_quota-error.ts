import { UsageRecord } from '../../types/usage';
import { UsageStorageService } from '../../services/usage-storage';
import { DebugManager } from '../../services/debug-manager';

/**
 * Shared bookkeeping for a terminal quota_exceeded error thrown out of
 * routing (see `buildQuotaExceededError`): finalize the usage record,
 * persist the request + error rows, and flush debug logs. Used by every
 * inference route's catch block; the caller stays responsible for the
 * protocol-specific 429 reply (`e.routingContext.body`).
 *
 * `responseStatus` is the distinct 'quota_exceeded' (not the generic
 * 'error') so quota rejections are filterable in usage views. Error-rate
 * metrics count `!= 'success'`, so they see it the same as before.
 *
 * Persistence is intentionally fire-and-forget, matching every sibling
 * branch of the route catch blocks: both storage calls swallow their own
 * failures internally (they never reject), the debug flush writes an
 * unrelated table with no ordering dependency on either save, and the
 * caller's 429 reply must not wait on telemetry writes.
 */
export function saveQuotaExceededUsage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  e: any,
  apiType: string,
  usageRecord: Partial<UsageRecord>,
  usageStorage: UsageStorageService,
  requestId: string,
  startTime: number
): void {
  usageRecord.responseStatus = 'quota_exceeded';
  usageRecord.durationMs = Date.now() - startTime;
  usageRecord.attemptCount = e.routingContext?.attemptCount || usageRecord.attemptCount || 1;
  usageRecord.retryHistory = e.routingContext?.retryHistory || usageRecord.retryHistory || null;
  usageStorage.saveRequest(usageRecord as UsageRecord);
  usageStorage.saveError(requestId, e, { apiType, ...(e.routingContext || {}) });
  DebugManager.getInstance().flush(requestId);
}

/**
 * Finalize the usage record for a request 429'd up front by
 * `checkQuotaMiddleware` (blocked GLOBAL quota — the middleware already
 * sent the 429 reply itself). Every v1 route pre-inserts a
 * `responseStatus: 'pending'` row via `emitStartedAsync` for the live view;
 * without this upsert a quota-blocked request would sit "in-flight" in the
 * dashboard forever. Fire-and-forget like `saveQuotaExceededUsage` above —
 * the save never rejects and nothing downstream depends on its completion.
 */
export function saveQuotaBlockedUsage(
  usageRecord: Partial<UsageRecord>,
  usageStorage: UsageStorageService,
  requestId: string,
  startTime: number
): void {
  usageRecord.responseStatus = 'quota_exceeded';
  usageRecord.durationMs = Date.now() - startTime;
  usageStorage.saveRequest(usageRecord as UsageRecord);
  DebugManager.getInstance().flush(requestId);
}
