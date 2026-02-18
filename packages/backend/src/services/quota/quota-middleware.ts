import { FastifyRequest, FastifyReply } from 'fastify';
import { QuotaEnforcer, QuotaCheckResult } from './quota-enforcer';
import { logger } from '../../utils/logger';

interface QuotaUsageRecord {
  tokensInput?: number | null;
  tokensOutput?: number | null;
  tokensCached?: number | null;
  tokensCacheWrite?: number | null;
  tokensReasoning?: number | null;
}

/**
 * Reusable function for pre-request quota checks.
 * Returns true if allowed, false if quota exceeded (and sends 429 response).
 */
export async function checkQuotaMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
  quotaEnforcer: QuotaEnforcer
): Promise<boolean> {
  const keyName = (request as any).keyName;
  
  if (!keyName) {
    logger.debug('[QuotaMiddleware] No keyName found on request, skipping quota check');
    return true;
  }

  const result = await quotaEnforcer.checkQuota(keyName);
  
  // No quota assigned, allow
  if (result === null) {
    return true;
  }

  // Quota exceeded
  if (!result.allowed) {
    const errorResponse = {
      error: {
        message: `Quota exceeded: ${result.quotaName} limit of ${result.limit} reached`,
        type: 'quota_exceeded',
        quota_name: result.quotaName,
        current_usage: result.currentUsage,
        limit: result.limit,
        resets_at: result.resetsAt?.toISOString() ?? null,
      }
    };
    
    reply.code(429).send(errorResponse);
    return false;
  }

  // Under limit, allow
  return true;
}

/**
 * Reusable function for post-request usage recording.
 */
export async function recordQuotaUsage(
  keyName: string | undefined,
  usageRecord: QuotaUsageRecord,
  quotaEnforcer: QuotaEnforcer
): Promise<void> {
  if (!keyName) {
    return;
  }

  try {
    await quotaEnforcer.recordUsage(keyName, {
      tokensInput: usageRecord.tokensInput ?? undefined,
      tokensOutput: usageRecord.tokensOutput ?? undefined,
      tokensCached: usageRecord.tokensCached ?? undefined,
      tokensCacheWrite: usageRecord.tokensCacheWrite ?? undefined,
      tokensReasoning: usageRecord.tokensReasoning ?? undefined,
    });
  } catch (error) {
    // Log error but don't fail the request
    logger.error('[QuotaMiddleware] Failed to record quota usage:', error);
  }
}
