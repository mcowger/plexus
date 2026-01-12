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
       // DebugStore doesn't strictly have a query method for list yet in the provided code,
       // it scans files. We might need to implement a scan method in DebugStore 
       // or just return empty for now if not implemented.
       // Assuming we can't easily query list of traces without opening all files.
       return {
           type: "trace",
           total: 0,
           limit: query.limit || 100,
           offset: query.offset || 0,
           hasMore: false,
           entries: []
       }
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
    // We don't have a direct "get by ID" in UsageStore, we have to search.
    // Ideally UsageStore should have getById.
    // For now, we'll search recent files or assume we need to index.
    // Optimization: If we have the date, we can narrow it down. But we just have ID here.
    // We'll search last 30 days of usage logs (default retention).
    
    // NOTE: This is inefficient. In a real DB, this is an index lookup.
    // With file logs, we have to grep.
    // Let's assume for this phase we might not find it efficiently without date.
    // However, if the user provides the date in a separate param (not in spec), it would be faster.
    
    // Let's try to find it in the usage store by querying with no filters but... wait UsageQuery needs filters?
    // UsageStore.query iterates files.
    
    const usage = await this.findUsageById(requestId);
    if (!usage) return null;

    // 2. Find traces
    // DebugStore stores by RequestID filename!
    const tracePath = `${this.debugStore['storagePath']}/${requestId}.json`; // Accessing private prop or we need a get method
    let trace = null;
    try {
        const file = Bun.file(tracePath);
        if (await file.exists()) {
            trace = await file.json();
        }
    } catch (e) {
        // ignore
    }

    // 3. Find errors
    // ErrorStore also strictly date based. We'd have to scan.
    // We can assume if it failed, it's in the same date as usage.
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

  private async findUsageById(requestId: string) {
      // Brute force search recent logs (last 7 days for speed?)
      // Or use `grep` via shell command? 
      // Using grep is faster.
      
      try {
        // We assume usage store path is available. 
        // We'll hackily access it or need to pass it in constructor publically.
        // Assuming ./logs/usage for now if not exposed.
        const path = this.usageStore['storagePath']; 
        
        // Use ripgrep or grep
        const proc = Bun.spawn(["grep", "-r", requestId, path], { stdout: "pipe" });
        const output = await new Response(proc.stdout).text();
        
        if (output) {
            const line = output.split('\n')[0];
            // format: filename:json
            const jsonStr = line.substring(line.indexOf(':') + 1);
            return JSON.parse(jsonStr);
        }
      } catch (e) {
          logger.warn("Failed to search usage log by ID", { error: e });
      }
      return null;
  }
}
