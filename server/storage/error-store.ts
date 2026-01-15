import { join } from "path";
import { unlink } from "node:fs/promises";
import type { ErrorLogEntry } from "../types/usage";
import { logger } from "../utils/logger";

/**
 * Storage service for persisting error logs
 * Stores errors in date-partitioned JSONL files
 */
export class ErrorStore {
  private storagePath: string;
  private retentionDays: number;

  constructor(storagePath: string, retentionDays: number = 90) {
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
        logger.info("Error store initialized", { path: this.storagePath });
      }
    } catch (error) {
      logger.error("Failed to initialize error store", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Log an error entry
   * @param entry - Error log entry to store
   */
  async log(entry: ErrorLogEntry): Promise<void> {
    try {
      const date = new Date(entry.timestamp).toISOString().split("T")[0];
      const filePath = join(this.storagePath, `${date}.jsonl`);

      // Append entry as JSONL
      const line = JSON.stringify(entry) + "\n";
      const file = Bun.file(filePath);
      
      // Append to file
      const existingContent = (await file.exists()) ? await file.text() : "";
      await Bun.write(filePath, existingContent + line);

      logger.debug("Error log entry written", {
        requestId: entry.id,
        errorType: entry.errorType,
        date,
      });
    } catch (error) {
      logger.error("Failed to write error log", {
        requestId: entry.id,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - we don't want logging failures to break the request
    }
  }

  /**
   * Get a specific error log by request ID
   * @param requestId - The unique request ID
   * @returns The error log entry or null if not found
   */
  async getById(requestId: string): Promise<ErrorLogEntry | null> {
    try {
      const entries = await this.query();
      return entries.find(e => e.id === requestId) || null;
    } catch (error) {
      logger.error("Failed to query error log by ID", {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Query error logs for a date range
   * @param startDate - Start date (ISO string)
   * @param endDate - End date (ISO string)
   * @returns Array of error log entries
   */
  async query(startDate?: string, endDate?: string): Promise<ErrorLogEntry[]> {
    try {
      const entries: ErrorLogEntry[] = [];
      const files = await this.getFilesInRange(startDate, endDate);

      for (const fileName of files) {
        const filePath = join(this.storagePath, fileName);
        const file = Bun.file(filePath);
        const content = await file.text();
        const lines = content.trim().split("\n");

        for (const line of lines) {
          if (!line) continue;

          try {
            const entry: ErrorLogEntry = JSON.parse(line);
            entries.push(entry);
          } catch (parseError) {
            logger.warn("Failed to parse error log line", {
              file: fileName,
              error: parseError instanceof Error ? parseError.message : String(parseError),
            });
          }
        }
      }

      return entries;
    } catch (error) {
      logger.error("Failed to query error logs", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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
            logger.info("Deleted error log file", { file });
          } catch (e) {
            logger.error("Failed to delete error log file", { file, error: e instanceof Error ? e.message : String(e) });
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
            logger.info("Deleted error log file", { file, date: fileDate });
          } catch (e) {
            logger.error("Failed to delete error log file", { file, date: fileDate, error: e instanceof Error ? e.message : String(e) });
          }
        }
      }
      return deletedCount;
    } catch (error) {
      logger.error("Failed to delete error logs", {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Delete a specific error log entry by request ID
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
              const entry: ErrorLogEntry = JSON.parse(line);
              if (entry.id === requestId) {
                // Skip this line (delete it)
                deleted = true;
                logger.info("Deleted error log entry", {
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
            logger.info("Deleted empty error log file", { file: fileName });
          }
          return true;
        }
      }

      logger.warn("Error log entry not found for deletion", { requestId });
      return false;
    } catch (error) {
      logger.error("Failed to delete error log entry", {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Clean up old error log files based on retention policy
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
          logger.info("Would delete old error log file", { file, date: fileDate });
        }
      }
    } catch (error) {
      logger.error("Failed to cleanup error logs", {
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
      logger.warn("Failed to read error log directory", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}
