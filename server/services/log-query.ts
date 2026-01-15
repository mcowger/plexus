import { UsageStore } from "../storage/usage-store";
import { ErrorStore } from "../storage/error-store";
import { DebugStore } from "../storage/debug-store";
import type { LogsQuery, LogDetailResponse, LogsDeleteRequest } from "../types/management";
import { logger } from "../utils/logger";

export class LogQueryService {
  constructor(
    private usageStore: UsageStore,
    private errorStore: ErrorStore,
    private debugStore: DebugStore
  ) {}

  /**
   * Query logs based on filters
   */
  async queryLogs(query: LogsQuery) {
    // Phase 8: Currently focusing on Usage Logs for the list view mostly, 
    // but the API supports querying errors/traces too.
    
    if (query.type === "error") {
        const errors = await this.errorStore.query(query.startDate, query.endDate);
        // Basic filtering for errors (in-memory for now as ErrorStore is simple)
        // Note: ErrorStore query currently just returns all in range.
        
        let filtered = errors;
        if (query.limit) {
            const offset = query.offset || 0;
            filtered = filtered.slice(offset, offset + query.limit);
        }
        
        return {
            type: "error",
            total: errors.length,
            limit: query.limit || 100,
            offset: query.offset || 0,
            hasMore: errors.length > (query.offset || 0) + (query.limit || 100),
            entries: filtered
        };
    } else if (query.type === "trace") {
       const traces = await this.debugStore.query({
           startDate: query.startDate,
           endDate: query.endDate,
           limit: query.limit,
           offset: query.offset
       });

       // We don't have an easy way to get total count without scanning all.
       // For now returning current page count or approximation if needed.
       // Or we could return 'total: -1' to indicate unknown.
       // Let's assume hasMore if we got full limit.
       
       return {
           type: "trace",
           total: traces.length, // Only returning count of fetched page effectively
           limit: query.limit || 100,
           offset: query.offset || 0,
           hasMore: traces.length === (query.limit || 100),
           entries: traces
       };
    } else {
        // Default to usage
        const usage = await this.usageStore.query({
            startDate: query.startDate,
            endDate: query.endDate,
            provider: query.provider,
            model: query.model,
            apiKey: query.apiKey,
            success: query.success,
            limit: query.limit,
            offset: query.offset
        });

        // Total count is hard to get without scanning all files matching range.
        // For now, we'll return the length of what we found + assumption of more if we hit limit.
        
        return {
            type: "usage",
            total: usage.length, // Approximation or need a count method
            limit: query.limit || 100,
            offset: query.offset || 0,
            hasMore: usage.length === (query.limit || 100),
            entries: usage
        };
    }
  }

  /**
   * Get full details for a request ID
   */
  async getLogDetails(requestId: string): Promise<LogDetailResponse | null> {
    // 1. Find usage log
    const usage = await this.usageStore.getById(requestId);

    // 2. Find traces
    const trace = await this.debugStore.getById(requestId);

    // 3. Find error log
    const error = await this.errorStore.getById(requestId);

    // Return null if nothing found
    if (!usage && !error && !trace) {
      return null;
    }

    // If no usage but error exists, return error-only response
    if (!usage) {
      return {
        usage: null,
        errors: error ? [error] : [],
        traces: trace ? [trace] : []
      };
    }

    // Find related errors (ErrorStore is date-partitioned)
    const date = usage.timestamp.split('T')[0];
    const errorsOfDay = await this.errorStore.query(date, date);
    const relatedErrors = errorsOfDay.filter(e => e.id === requestId);

    return {
        usage,
        errors: relatedErrors,
        traces: trace ? [trace] : []
    };
  }

  async deleteLogs(request: LogsDeleteRequest) {
     const result = {
         success: true,
         deleted: { usage: 0, error: 0, trace: 0 }
     };

     // Default olderThanDays to a very small number if 'all' is requested, effectively clearing everything
     // Or if specific days provided.
     // If 'all' is true, we pass 0 days (delete everything older than now)

     const days = request.all ? 0 : request.olderThanDays;

     if (days === undefined) {
         // If neither all nor olderThanDays is specified, we do nothing or need a default?
         // Spec implies bulk delete. Let's return 0 if no criteria.
         return result;
     }

     if (request.type === 'usage' || !request.type) {
         result.deleted.usage = await this.usageStore.deleteOldLogs(days);
     }

     if (request.type === 'error' || !request.type) {
         result.deleted.error = await this.errorStore.deleteOldLogs(days);
     }

     if (request.type === 'trace' || !request.type) {
         result.deleted.trace = await this.debugStore.deleteOldLogs(days);
     }

     return result;
  }

  /**
   * Delete a specific log entry by request ID
   * Deletes from all stores (usage, error, and trace)
   */
  async deleteLogById(requestId: string) {
    const result = {
      success: true,
      deleted: { usage: false, error: false, trace: false }
    };

    // Try to delete from all stores
    result.deleted.usage = await this.usageStore.deleteById(requestId);
    result.deleted.error = await this.errorStore.deleteById(requestId);
    result.deleted.trace = await this.debugStore.deleteById(requestId);

    // Consider it successful if at least one store had the entry
    result.success = result.deleted.usage || result.deleted.error || result.deleted.trace;

    return result;
  }

  /**
   * Force complete a pending request by marking it as failed
   * @param requestId - The unique request ID to force complete
   */
  async forceCompleteLog(requestId: string) {
    const success = await this.usageStore.forceComplete(requestId);
    return { success };
  }
}
