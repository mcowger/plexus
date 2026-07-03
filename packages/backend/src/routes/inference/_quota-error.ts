import { UsageRecord } from '../../types/usage';
import { UsageStorageService } from '../../services/usage-storage';
import { DebugManager } from '../../services/debug-manager';

/**
 * Shared bookkeeping for a terminal quota_exceeded error thrown out of
 * routing (see `buildQuotaExceededError`): finalize the usage record,
 * persist the request + error rows, and flush debug logs. Used by every
 * inference route's catch block; the caller stays responsible for the
 * protocol-specific 429 reply (`e.routingContext.body`).
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
  usageRecord.responseStatus = 'error';
  usageRecord.durationMs = Date.now() - startTime;
  usageRecord.attemptCount = e.routingContext?.attemptCount || usageRecord.attemptCount || 1;
  usageRecord.retryHistory = e.routingContext?.retryHistory || usageRecord.retryHistory || null;
  usageStorage.saveRequest(usageRecord as UsageRecord);
  usageStorage.saveError(requestId, e, { apiType, ...(e.routingContext || {}) });
  DebugManager.getInstance().flush(requestId);
}
