import type { DebugTraceEntry } from "../types/usage";
import { logger } from "../utils/logger";
import { mkdir, rm } from "node:fs/promises";
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
   * Helper to format timestamp for directory name
   */
  private getTimestamp(dateStr?: string): string {
    const d = dateStr ? new Date(dateStr) : new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return [
      d.getFullYear(),
      pad(d.getMonth() + 1),
      pad(d.getDate()),
      pad(d.getHours()),
      pad(d.getMinutes()),
      pad(d.getSeconds())
    ].join("-");
  }

  /**
   * Initialize storage (create directories if needed)
   */
  async initialize(): Promise<void> {
    try {
      const storageExists = await Bun.file(this.storagePath).exists();
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
      // Create directory name: strftime(%Y-%m-%d-%H-%M-%S)-<request-id>
      const timestamp = this.getTimestamp(entry.timestamp);
      const dirName = `${timestamp}-${entry.id}`;
      const dirPath = join(this.storagePath, dirName);

      // Create the directory
      await mkdir(dirPath, { recursive: true });

      // Split the trace into multiple files for better visibility
      const tasks = [
        // Full trace for compatibility and easy loading
        Bun.write(join(dirPath, "trace.json"), JSON.stringify(entry, null, 2)),
        // Client request
        Bun.write(join(dirPath, "client_request.json"), JSON.stringify(entry.clientRequest, null, 2)),
        // Unified request
        Bun.write(join(dirPath, "unified_request.json"), JSON.stringify(entry.unifiedRequest, null, 2)),
        // Provider request
        Bun.write(join(dirPath, "provider_request.json"), JSON.stringify(entry.providerRequest, null, 2)),
      ];

      if (entry.providerResponse) {
        tasks.push(Bun.write(join(dirPath, "provider_response.json"), JSON.stringify(entry.providerResponse, null, 2)));
      }

      if (entry.clientResponse) {
        tasks.push(Bun.write(join(dirPath, "client_response.json"), JSON.stringify(entry.clientResponse, null, 2)));
      }

      if (entry.streamSnapshots) {
        tasks.push(Bun.write(join(dirPath, "stream_snapshots.json"), JSON.stringify(entry.streamSnapshots, null, 2)));
      }

      await Promise.all(tasks);

      logger.debug("Debug trace stored in directory", {
        requestId: entry.id,
        dirPath,
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
   * Get a debug trace by request ID
   * @param requestId - Request ID
   */
  async getById(requestId: string): Promise<DebugTraceEntry | null> {
    try {
      // Find directory ending with the request ID
      const glob = new Bun.Glob(`*-${requestId}`);
      const dirs = Array.from(glob.scanSync({ cwd: this.storagePath, onlyFiles: false }));
      
      if (dirs.length === 0) return null;

      // Use the first match (there should only be one for a unique request ID)
      const dirPath = join(this.storagePath, dirs[0]!);
      const traceFile = join(dirPath, "trace.json");
      
      const file = Bun.file(traceFile);
      if (await file.exists()) {
        return await file.json();
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Query debug traces
   * @param query - Filter options
   */
  async query(query: {
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }): Promise<DebugTraceEntry[]> {
    try {
      const glob = new Bun.Glob("*/");
      const dirs = Array.from(glob.scanSync({ cwd: this.storagePath, onlyFiles: false }));
      
      // Filter by directory name (starts with timestamp)
      const startStr = query.startDate ? this.getTimestamp(query.startDate) : "0000";
      const endStr = query.endDate ? this.getTimestamp(query.endDate) : "9999";

      const validDirs = dirs
        .map(d => d.replace(/\/$/, "")) // Remove trailing slash if present
        .filter(name => name >= startStr && name <= endStr)
        .sort((a, b) => b.localeCompare(a)); // Newest first

      const entries: DebugTraceEntry[] = [];
      
      // Pagination
      const offset = query.offset || 0;
      const limit = query.limit || 100;
      const pagedDirs = validDirs.slice(offset, offset + limit);

      for (const dirName of pagedDirs) {
        try {
            const traceFile = join(this.storagePath, dirName, "trace.json");
            const content = await Bun.file(traceFile).json();
            entries.push(content);
        } catch (e) {
            // ignore
        }
      }
      
      return entries;

    } catch (error) {
       logger.error("Failed to query debug traces", { error });
       return [];
    }
  }

  /**
   * Delete logs older than specific days
   */
  async deleteOldLogs(days: number): Promise<number> {
      try {
      const storageExists = await Bun.file(this.storagePath).exists();
      if (!storageExists) {
        return 0;
      }

      const now = Date.now();
      const cutoffTime = now - days * 24 * 60 * 60 * 1000;
      const cutoffStr = this.getTimestamp(new Date(cutoffTime).toISOString());

      // Read directory
      const glob = new Bun.Glob("*/");
      const dirs = Array.from(glob.scanSync({ cwd: this.storagePath, onlyFiles: false }));

      let deletedCount = 0;
      for (const dirName of dirs) {
        const name = dirName.replace(/\/$/, "");

        if (name < cutoffStr) {
          try {
            await rm(join(this.storagePath, dirName), { recursive: true, force: true });
            deletedCount++;
          } catch (e) {
            logger.warn("Failed to delete old debug directory", { dirName, error: e });
          }
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
      const storageExists = await Bun.file(this.storagePath).exists();
      if (!storageExists) {
        return;
      }

      const now = Date.now();
      const cutoffTime = now - this.retentionDays * 24 * 60 * 60 * 1000;
      const cutoffStr = this.getTimestamp(new Date(cutoffTime).toISOString());

      // Read directory
      const glob = new Bun.Glob("*/");
      const dirs = Array.from(glob.scanSync({ cwd: this.storagePath, onlyFiles: false }));

      let deletedCount = 0;
      for (const dirName of dirs) {
        const name = dirName.replace(/\/$/, "");

        if (name < cutoffStr) {
          try {
            await rm(join(this.storagePath, dirName), { recursive: true, force: true });
            deletedCount++;
          } catch (e) {
            logger.warn("Failed to delete old debug directory", { dirName, error: e });
          }
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
