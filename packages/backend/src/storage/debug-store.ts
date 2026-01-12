import type { DebugTraceEntry } from "../types/usage";
import { logger } from "../utils/logger";
import { mkdir, exists } from "node:fs/promises";
import { join } from "node:path";

/**
 * Storage service for debug traces
 * Stores full request/response captures for debugging
 */
export class DebugStore {
  constructor(
    private storagePath: string,
    private retentionDays: number
  ) {}

  /**
   * Initialize storage (create directories if needed)
   */
  async initialize(): Promise<void> {
    try {
      const storageExists = await exists(this.storagePath);
      if (!storageExists) {
        await mkdir(this.storagePath, { recursive: true });
        logger.info("Debug storage initialized", { path: this.storagePath });
      }
    } catch (error) {
      logger.error("Failed to initialize debug storage", {
        error: error instanceof Error ? error.message : String(error),
        path: this.storagePath,
      });
      throw error;
    }
  }

  /**
   * Store a debug trace
   * @param entry - Debug trace entry
   */
  async store(entry: DebugTraceEntry): Promise<void> {
    try {
      // Create filename based on request ID
      const fileName = `${entry.id}.json`;
      const filePath = join(this.storagePath, fileName);

      // Write debug trace as formatted JSON
      const content = JSON.stringify(entry, null, 2);
      await Bun.write(filePath, content);

      logger.debug("Debug trace stored", {
        requestId: entry.id,
        filePath,
      });
    } catch (error) {
      logger.error("Failed to store debug trace", {
        requestId: entry.id,
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
      const storageExists = await exists(this.storagePath);
      if (!storageExists) {
        return 0;
      }

      const now = Date.now();
      const cutoffTime = now - days * 24 * 60 * 60 * 1000;

      // Read directory
      const entries = await Array.fromAsync(
        new Bun.Glob("*.json").scan({ cwd: this.storagePath })
      );

      let deletedCount = 0;
      for (const entry of entries) {
        const filePath = join(this.storagePath, entry);

        try {
          // Get file stats
          const file = Bun.file(filePath);
          const stat = await file.exists();
          
          if (!stat) continue;

          // Check if file is older than cutoff
          const fileTime = file.lastModified;
          if (fileTime < cutoffTime) {
            await Bun.write(filePath, ""); // Truncate first
            const proc = Bun.spawn(["rm", filePath]);
            await proc.exited;
            deletedCount++;
          }
        } catch (error) {
           // ignore specific file error
        }
      }
      return deletedCount;
    } catch (error) {
      logger.error("Failed to delete debug traces", {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Clean up old debug traces
   */
  async cleanup(): Promise<void> {
    try {
      const storageExists = await exists(this.storagePath);
      if (!storageExists) {
        return;
      }

      const now = Date.now();
      const cutoffTime = now - this.retentionDays * 24 * 60 * 60 * 1000;

      // Read directory
      const entries = await Array.fromAsync(
        new Bun.Glob("*.json").scan({ cwd: this.storagePath })
      );

      let deletedCount = 0;
      for (const entry of entries) {
        const filePath = join(this.storagePath, entry);

        try {
          // Get file stats
          const file = Bun.file(filePath);
          const stat = await file.exists();
          
          if (!stat) continue;

          // Check if file is older than retention period
          const fileTime = file.lastModified;
          if (fileTime < cutoffTime) {
            // Delete the file using Bun's filesystem
            await Bun.write(filePath, ""); // Truncate first
            const proc = Bun.spawn(["rm", filePath]);
            await proc.exited;
            deletedCount++;
          }
        } catch (error) {
          logger.warn("Failed to check/delete debug trace", {
            file: entry,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (deletedCount > 0) {
        logger.info("Debug trace cleanup completed", {
          deleted: deletedCount,
          retentionDays: this.retentionDays,
        });
      }
    } catch (error) {
      logger.error("Debug trace cleanup failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
