import { join, dirname } from "path";
import { unlink } from "node:fs/promises";
import type { UsageLogEntry, UsageQuery, UsageSummary } from "../types/usage";
import { logger } from "../utils/logger";

/**
 * Storage service for persisting usage logs
 * Stores logs in date-partitioned JSONL files
 */
export class UsageStore {
  private storagePath: string;
  private retentionDays: number;

  constructor(storagePath: string, retentionDays: number = 30) {
    this.storagePath = storagePath;
    this.retentionDays = retentionDays;
  }

  /**
   * Initialize storage directory
   */
  async initialize(): Promise<void> {
    try {
      const exists = await Bun.file(this.storagePath).exists();
      if (!exists) {
        await Bun.write(join(this.storagePath, ".gitkeep"), "");
        logger.info("Usage store initialized", { path: this.storagePath });
      }
    } catch (error) {
      logger.error("Failed to initialize usage store", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Append a usage log entry
   * @param entry - Usage log entry to store
   */
  async log(entry: UsageLogEntry): Promise<void> {
    try {
      const date = new Date(entry.timestamp).toISOString().split("T")[0];
      const filePath = join(this.storagePath, `${date}.jsonl`);

      // Append entry as JSONL (JSON Lines format)
      const line = JSON.stringify(entry) + "\n";
      const file = Bun.file(filePath);
      
      // Append to file
      const existingContent = (await file.exists()) ? await file.text() : "";
      await Bun.write(filePath, existingContent + line);

      logger.debug("Usage log entry written", {
        requestId: entry.id,
        date,
      });
    } catch (error) {
      logger.error("Failed to write usage log", {
        requestId: entry.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Query usage logs with filters
   * @param query - Query parameters
   * @returns Array of matching usage log entries
   */
  async query(query: UsageQuery): Promise<UsageLogEntry[]> {
    try {
      const entries: UsageLogEntry[] = [];
      const files = await this.getFilesInRange(query.startDate, query.endDate);

      for (const fileName of files) {
        const filePath = join(this.storagePath, fileName);
        const file = Bun.file(filePath);
        const content = await file.text();
        const lines = content.trim().split("\n");

        for (const line of lines) {
          if (!line) continue;

          try {
            const entry: UsageLogEntry = JSON.parse(line);

            // Apply filters
            if (query.provider && entry.actualProvider !== query.provider) continue;
            if (query.model && entry.actualModel !== query.model) continue;
            if (query.apiKey && entry.apiKey !== query.apiKey) continue;
            if (query.success !== undefined && entry.success !== query.success) continue;

            entries.push(entry);
          } catch (parseError) {
            logger.warn("Failed to parse usage log line", {
              file: fileName,
              error: parseError instanceof Error ? parseError.message : String(parseError),
            });
          }
        }
      }

      // Sort by timestamp in descending order (newest first)
      entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // Apply pagination
      const offset = query.offset || 0;
      const limit = query.limit || entries.length;

      return entries.slice(offset, offset + limit);
    } catch (error) {
      logger.error("Failed to query usage logs", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Generate a usage summary for a time period
   * @param startDate - Start date (ISO string)
   * @param endDate - End date (ISO string)
   * @returns Usage summary with aggregated stats
   */
  async getSummary(startDate?: string, endDate?: string): Promise<UsageSummary> {
    const entries = await this.query({ startDate, endDate });

    const summary: UsageSummary = {
      period: {
        start: startDate || entries[0]?.timestamp || new Date().toISOString(),
        end: endDate || entries[entries.length - 1]?.timestamp || new Date().toISOString(),
      },
      requests: {
        total: entries.length,
        successful: entries.filter((e) => e.success).length,
        failed: entries.filter((e) => !e.success).length,
      },
      tokens: {
        input: 0,
        output: 0,
        cachedRead: 0,
        cacheCreation: 0,
        reasoning: 0,
        total: 0,
      },
      cost: {
        total: 0,
        byProvider: {},
        byModel: {},
      },
      performance: {
        avgDuration: 0,
        avgTtft: 0,
        p50Duration: 0,
        p95Duration: 0,
      },
    };

    // Aggregate tokens and costs
    for (const entry of entries) {
      summary.tokens.input += entry.usage.inputTokens;
      summary.tokens.output += entry.usage.outputTokens;
      summary.tokens.cachedRead += entry.usage.cacheReadTokens;
      summary.tokens.cacheCreation += entry.usage.cacheCreationTokens;
      summary.tokens.reasoning += entry.usage.reasoningTokens;
      summary.tokens.total += entry.usage.totalTokens;

      summary.cost.total += entry.cost.totalCost;
      summary.cost.byProvider[entry.actualProvider] =
        (summary.cost.byProvider[entry.actualProvider] || 0) + entry.cost.totalCost;
      summary.cost.byModel[entry.actualModel] =
        (summary.cost.byModel[entry.actualModel] || 0) + entry.cost.totalCost;
    }

    // Calculate performance metrics
    const durations = entries.map((e) => e.metrics.durationMs);
    const ttfts = entries.filter((e) => e.metrics.providerTtftMs !== null).map((e) => e.metrics.providerTtftMs!);

    if (durations.length > 0) {
      summary.performance.avgDuration =
        durations.reduce((a, b) => a + b, 0) / durations.length;

      const sortedDurations = [...durations].sort((a, b) => a - b);
      summary.performance.p50Duration =
        sortedDurations[Math.floor(sortedDurations.length * 0.5)] ?? 0;
      summary.performance.p95Duration =
        sortedDurations[Math.floor(sortedDurations.length * 0.95)] ?? 0;
    }

    if (ttfts.length > 0) {
      summary.performance.avgTtft = ttfts.reduce((a, b) => a + b, 0) / ttfts.length;
    }

    return summary;
  }

  /**
   * Delete logs older than specific days
   * @param days - Number of days to keep
   * @returns Number of files deleted
   */
  async deleteOldLogs(days: number): Promise<number> {
    try {
      const glob = new Bun.Glob("*.jsonl");
      const files = Array.from(glob.scanSync(this.storagePath));
      
      let deletedCount = 0;

      // If days is 0, delete ALL logs (including today)
      if (days === 0) {
        for (const file of files) {
          const filePath = join(this.storagePath, file);
          try {
            await unlink(filePath);
            deletedCount++;
            logger.info("Deleted usage log file", { file });
          } catch (e) {
            logger.error("Failed to delete usage log file", { file, error: e instanceof Error ? e.message : String(e) });
          }
        }
        return deletedCount;
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const cutoffString = cutoffDate.toISOString().split("T")[0];

      for (const file of files) {
        const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/);
        if (!dateMatch) continue;

        const fileDate = dateMatch[1]!;
        if (fileDate < cutoffString!) {
          const filePath = join(this.storagePath, file);
          try {
            await unlink(filePath);
            deletedCount++;
            logger.info("Deleted usage log file", { file, date: fileDate });
          } catch (e) {
            logger.error("Failed to delete usage log file", { file, date: fileDate, error: e instanceof Error ? e.message : String(e) });
          }
        }
      }
      return deletedCount;
    } catch (error) {
      logger.error("Failed to delete usage logs", {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Find a specific log entry by request ID
   * @param requestId - The unique request ID to search for
   */
  async getById(requestId: string): Promise<UsageLogEntry | null> {
    try {
      const glob = new Bun.Glob("*.jsonl");
      const files = Array.from(glob.scanSync(this.storagePath)).sort().reverse();

      for (const fileName of files) {
        const filePath = join(this.storagePath, fileName);
        const file = Bun.file(filePath);
        const content = await file.text();
        const lines = content.trim().split("\n");

        // Scan backwards in file as newer logs are at the bottom
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i];
          if (!line) continue;

          try {
            if (line.includes(requestId)) {
              const entry: UsageLogEntry = JSON.parse(line);
              if (entry.id === requestId) {
                return entry;
              }
            }
          } catch (e) {
            // Ignore parse errors for individual lines
          }
        }
      }
      return null;
    } catch (error) {
      logger.error("Failed to find log by ID", { requestId, error });
      return null;
    }
  }

  /**
   * Update usage information for an existing log entry
   * This is used to backfill usage data for streaming requests after reconstruction
   * @param requestId - The unique request ID to update
   * @param usage - Updated usage information
   * @param cost - Updated cost information
   */
  async updateUsage(
    requestId: string,
    usage: UsageLogEntry["usage"],
    cost: UsageLogEntry["cost"]
  ): Promise<boolean> {
    try {
      const glob = new Bun.Glob("*.jsonl");
      const files = Array.from(glob.scanSync(this.storagePath)).sort().reverse();

      for (const fileName of files) {
        const filePath = join(this.storagePath, fileName);
        const file = Bun.file(filePath);
        const content = await file.text();
        const lines = content.trim().split("\n");

        let updated = false;
        const updatedLines: string[] = [];

        for (const line of lines) {
          if (!line) {
            updatedLines.push(line);
            continue;
          }

          try {
            if (line.includes(requestId)) {
              const entry: UsageLogEntry = JSON.parse(line);
              if (entry.id === requestId) {
                // Update the entry
                entry.usage = usage;
                entry.cost = cost;
                entry.pending = false; // Mark as complete when updating from stream reconstruction
                updatedLines.push(JSON.stringify(entry));
                updated = true;
                logger.debug("Updated usage log entry", {
                  requestId,
                  file: fileName,
                });
                continue;
              }
            }
          } catch (e) {
            // If parse fails, keep original line
            logger.warn("Failed to parse line during update", {
              file: fileName,
              error: e instanceof Error ? e.message : String(e),
            });
          }

          updatedLines.push(line);
        }

        if (updated) {
          // Write updated content back to file
          await Bun.write(filePath, updatedLines.join("\n") + "\n");
          logger.info("Updated usage log file", {
            requestId,
            file: fileName,
          });
          return true;
        }
      }

      logger.warn("Usage log entry not found for update", { requestId });
      return false;
    } catch (error) {
      logger.error("Failed to update usage log", {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Update usage, cost, and metrics for a specific request (for streaming updates)
   * @param requestId - Request ID to update
   * @param usage - Updated usage information
   * @param cost - Updated cost information
   * @param metrics - Updated metrics information
   */
  async updateUsageWithMetrics(
    requestId: string,
    usage: UsageLogEntry["usage"],
    cost: UsageLogEntry["cost"],
    metrics: UsageLogEntry["metrics"]
  ): Promise<boolean> {
    try {
      const glob = new Bun.Glob("*.jsonl");
      const files = Array.from(glob.scanSync(this.storagePath)).sort().reverse();

      for (const fileName of files) {
        const filePath = join(this.storagePath, fileName);
        const file = Bun.file(filePath);
        const content = await file.text();
        const lines = content.trim().split("\n");

        let updated = false;
        const updatedLines: string[] = [];

        for (const line of lines) {
          if (!line) {
            updatedLines.push(line);
            continue;
          }

          try {
            if (line.includes(requestId)) {
              const entry: UsageLogEntry = JSON.parse(line);
              if (entry.id === requestId) {
                // Update the entry with usage, cost, AND metrics
                entry.usage = usage;
                entry.cost = cost;
                entry.metrics = metrics;
                entry.pending = false; // Mark as complete when updating from stream reconstruction
                updatedLines.push(JSON.stringify(entry));
                updated = true;
                logger.debug("Updated usage log entry with metrics", {
                  requestId,
                  file: fileName,
                });
                continue;
              }
            }
          } catch (e) {
            // If parse fails, keep original line
            logger.warn("Failed to parse line during update", {
              file: fileName,
              error: e instanceof Error ? e.message : String(e),
            });
          }

          updatedLines.push(line);
        }

        if (updated) {
          // Write updated content back to file
          await Bun.write(filePath, updatedLines.join("\n") + "\n");
          return true;
        }
      }

      logger.warn("Usage log entry not found for update", { requestId });
      return false;
    } catch (error) {
      logger.error("Failed to update usage log with metrics", {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Delete a specific log entry by request ID
   * @param requestId - The unique request ID to delete
   * @returns True if the entry was found and deleted, false otherwise
   */
  async deleteById(requestId: string): Promise<boolean> {
    try {
      const glob = new Bun.Glob("*.jsonl");
      const files = Array.from(glob.scanSync(this.storagePath)).sort().reverse();

      for (const fileName of files) {
        const filePath = join(this.storagePath, fileName);
        const file = Bun.file(filePath);
        const content = await file.text();
        const lines = content.trim().split("\n");

        let deleted = false;
        const updatedLines: string[] = [];

        for (const line of lines) {
          if (!line) {
            updatedLines.push(line);
            continue;
          }

          try {
            if (line.includes(requestId)) {
              const entry: UsageLogEntry = JSON.parse(line);
              if (entry.id === requestId) {
                // Skip this line (delete it)
                deleted = true;
                logger.info("Deleted usage log entry", {
                  requestId,
                  file: fileName,
                });
                continue;
              }
            }
          } catch (e) {
            // If parse fails, keep original line
            logger.warn("Failed to parse line during delete", {
              file: fileName,
              error: e instanceof Error ? e.message : String(e),
            });
          }

          updatedLines.push(line);
        }

        if (deleted) {
          // Write updated content back to file
          const newContent = updatedLines.filter(l => l.trim()).join("\n");
          if (newContent) {
            await Bun.write(filePath, newContent + "\n");
          } else {
            // If file is now empty, delete it
            await unlink(filePath);
            logger.info("Deleted empty usage log file", { file: fileName });
          }
          return true;
        }
      }

      logger.warn("Usage log entry not found for deletion", { requestId });
      return false;
    } catch (error) {
      logger.error("Failed to delete usage log entry", {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Clean up old log files based on retention policy
   */
  async cleanup(): Promise<void> {
    try {
      const glob = new Bun.Glob("*.jsonl");
      const files = Array.from(glob.scanSync(this.storagePath));
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);
      const cutoffString = cutoffDate.toISOString().split("T")[0];

      for (const file of files) {
        const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/);
        if (!dateMatch) continue;

        const fileDate = dateMatch[1]!;
        if (fileDate < cutoffString!) {
          const filePath = join(this.storagePath, file);
          await Bun.file(filePath).writer().end();
          // Note: Bun doesn't have a direct unlink, we'd use fs.unlinkSync if needed
          // For now, we'll leave this as a note that cleanup needs filesystem access
          logger.info("Would delete old usage log file", { file, date: fileDate });
        }
      }
    } catch (error) {
      logger.error("Failed to cleanup usage logs", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get list of log files within a date range
   */
  private async getFilesInRange(startDate?: string, endDate?: string): Promise<string[]> {
    try {
      const glob = new Bun.Glob("*.jsonl");
      const files = Array.from(glob.scanSync(this.storagePath));
      const logFiles = files.filter((f) => f.endsWith(".jsonl"));

      if (!startDate && !endDate) {
        return logFiles.sort();
      }

      return logFiles
        .filter((file) => {
          const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/);
          if (!dateMatch) return false;

          const fileDate = dateMatch[1]!;
          if (startDate && fileDate < startDate.split("T")[0]!) return false;
          if (endDate && fileDate > endDate.split("T")[0]!) return false;

          return true;
        })
        .sort();
    } catch (error) {
      logger.warn("Failed to read usage log directory", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}
