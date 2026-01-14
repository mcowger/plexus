import type { DebugTraceEntry } from "../types/debug";
import { logger } from "../utils/logger";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

/**
 * Storage service for debug traces
 * Stores full request/response captures for debugging
 */
export class DebugStore {
  constructor(private storagePath: string, private retentionDays: number) {}

  /**
   * Helper to format timestamp for directory name
   */
  private getTimestamp(dateStr?: string): string {
    const d = dateStr ? new Date(dateStr) : new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    return [
      d.getFullYear(),
      pad(d.getMonth() + 1),
      pad(d.getDate()),
      pad(d.getHours()),
      pad(d.getMinutes()),
      pad(d.getSeconds()),
    ].join("-");
  }

  /**
   * Helper to reconstruct a trace from individual files
   */
  private async reconstructTraceFromFiles(dirPath: string): Promise<DebugTraceEntry | null> {
    try {
      // Extract request ID and timestamp from directory name
      // Format: YYYY-MM-DD-HH-MM-SS-<request-id>
      const dirName = dirPath.split("/").pop() || "";
      const match = dirName.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(.+)$/);
      
      if (!match) {
        logger.warn("Invalid debug directory name format", { dirName });
        return null;
   }

      const [, year, month, day, hour, minute, second, requestId] = match;
      const timestamp = new Date(
        parseInt(year!),
        parseInt(month!) - 1,
        parseInt(day!),
        parseInt(hour!),
        parseInt(minute!),
        parseInt(second!)
      ).toISOString();

      // Read individual files
      const clientRequestFile = Bun.file(join(dirPath, "client_request.json"));
      const providerRequestFile = Bun.file(join(dirPath, "provider_request.json"));
      const providerResponseFile = Bun.file(join(dirPath, "provider_response.json"));
      const clientResponseFile = Bun.file(join(dirPath, "client_response.json"));
      const providerStreamFile = Bun.file(join(dirPath, "provider_stream.txt"));
      const clientStreamFile = Bun.file(join(dirPath, "client_stream.txt"));

      // Build the trace entry
      const trace: DebugTraceEntry = {
        id: requestId!,
        timestamp,
        clientRequest: (await clientRequestFile.exists()) ? await clientRequestFile.json() : { apiType: "", body: {}, headers: {} },
        providerRequest: (await providerRequestFile.exists()) ? await providerRequestFile.json() : { apiType: "", body: {}, headers: {} },
      };

      // Optional fields
      if (await providerResponseFile.exists()) {
        trace.providerResponse = await providerResponseFile.json();
      }

      if (await clientResponseFile.exists()) {
        trace.clientResponse = await clientResponseFile.json();
      }

      // Stream files are text, not JSON
      if (await providerStreamFile.exists()) {
        const streamContent = await providerStreamFile.text();
        trace.providerStreamChunks = [
          {
         timestamp,
            chunk: streamContent,
          },
        ];
      }

      if (await clientStreamFile.exists()) {
        const streamContent = await clientStreamFile.text();
        trace.clientStreamChunks = [
          {
            timestamp,
            chunk: streamContent,
          },
        ];
      }

      return trace;
    } catch (error) {
      logger.error("Failed to reconstruct trace from files", { dirPath, error });
      return null;
    }
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
      const tasks = [];

      // Client request
      const clientRequestJson = JSON.stringify(entry.clientRequest, null, 2);
      if (typeof clientRequestJson === "string") {
        tasks.push(
          Bun.write(join(dirPath, "client_request.json"), clientRequestJson)
        );
      }

      // Provider request
      const providerRequestJson = JSON.stringify(
        entry.providerRequest,
        null,
        2
      );
      if (typeof providerRequestJson === "string") {
        tasks.push(
          Bun.write(join(dirPath, "provider_request.json"), providerRequestJson)
        );
      }

      if (entry.providerResponse) {
        const providerResponseJson = JSON.stringify(
          entry.providerResponse,
          null,
          2
        );
        if (typeof providerResponseJson === "string") {
          tasks.push(
            Bun.write(
              join(dirPath, "provider_response.json"),
              providerResponseJson
            )
          );
        }
      }

      if (entry.clientResponse) {
        const clientResponseJson = JSON.stringify(
          entry.clientResponse,
          null,
          2
        );
        if (typeof clientResponseJson === "string") {
          tasks.push(
            Bun.write(join(dirPath, "client_response.json"), clientResponseJson)
          );
        }
      }
      
      if (entry.providerStreamChunks && entry.providerStreamChunks.length > 0) {
        // Extract only the raw chunk text and join into one continuous block
        const rawStreamContent = entry.providerStreamChunks
          .map((item) => item.chunk)
          .join("");

        tasks.push(
          Bun.write(join(dirPath, "provider_stream.txt"), rawStreamContent)
        );
      }


      if (entry.clientStreamChunks && entry.clientStreamChunks.length > 0) {
        // Extract only the raw chunk text and join into one continuous block
        const rawStreamContent = entry.clientStreamChunks
          .map((item) => item.chunk)
          .join("");

        tasks.push(
          Bun.write(join(dirPath, "client_stream.txt"), rawStreamContent)
        );
      }

      if (tasks.length === 0) {
        logger.warn("No trace data to write", { requestId: entry.id, dirPath });
        return;
      }

      await Promise.all(tasks);

      logger.debug("Debug trace stored in directory", {
        requestId: entry.id,
        dirPath,
        filesWritten: tasks.length,
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
      const dirs = Array.from(
        glob.scanSync({ cwd: this.storagePath, onlyFiles: false })
      );

      if (dirs.length === 0) return null;

      // Use the first match (there should only be one for a unique request ID)
      const dirPath = join(this.storagePath, dirs[0]!);
      return await this.reconstructTraceFromFiles(dirPath);
    } catch (error) {
      logger.error("Failed to get trace by ID", { requestId, error });
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
      const dirs = Array.from(
        glob.scanSync({ cwd: this.storagePath, onlyFiles: false })
      );

      // Filter by directory name (starts with timestamp)
      const startStr = query.startDate
        ? this.getTimestamp(query.startDate)
        : "0000";
      const endStr = query.endDate ? this.getTimestamp(query.endDate) : "9999";

      const validDirs = dirs
        .map((d) => d.replace(/\/$/, "")) // Remove trailing slash if present
        .filter((name) => name >= startStr && name <= endStr)
        .sort((a, b) => b.localeCompare(a)); // Newest first

      const entries: DebugTraceEntry[] = [];

      // Pagination
      const offset = query.offset || 0;
      const limit = query.limit || 100;
      const pagedDirs = validDirs.slice(offset, offset + limit);

      for (const dirName of pagedDirs) {
        try {
          const dirPath = join(this.storagePath, dirName);
          const trace = await this.reconstructTraceFromFiles(dirPath);
       if (trace) {
        entries.push(trace);
          }
        } catch (e) {
          logger.debug("Failed to reconstruct trace from files", { dirName, error: e });
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

      const glob = new Bun.Glob("*/");
      const dirs = Array.from(
        glob.scanSync({ cwd: this.storagePath, onlyFiles: false })
      );

      let deletedCount = 0;

      for (const dirName of dirs) {
        const name = dirName.replace(/\/$/, "");

        // If days is 0, delete ALL directories
        if (days === 0) {
          try {
            await rm(join(this.storagePath, dirName), {
              recursive: true,
              force: true,
            });
            deletedCount++;
            logger.info("Deleted debug directory", { dirName });
          } catch (e) {
            logger.error("Failed to delete debug directory", {
              dirName,
              error: e instanceof Error ? e.message : String(e),
            });
          }
          continue;
        }

        // Otherwise, check if directory is older than the cutoff time
        const now = Date.now();
        const cutoffTime = now - days * 24 * 60 * 60 * 1000;
        const cutoffStr = this.getTimestamp(new Date(cutoffTime).toISOString());

        if (name < cutoffStr) {
          try {
            await rm(join(this.storagePath, dirName), {
              recursive: true,
              force: true,
            });
            deletedCount++;
            logger.info("Deleted old debug directory", { dirName });
          } catch (e) {
            logger.error("Failed to delete old debug directory", {
              dirName,
              error: e instanceof Error ? e.message : String(e),
            });
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
      const dirs = Array.from(
        glob.scanSync({ cwd: this.storagePath, onlyFiles: false })
      );

      let deletedCount = 0;
      for (const dirName of dirs) {
        const name = dirName.replace(/\/$/, "");

        if (name < cutoffStr) {
          try {
            await rm(join(this.storagePath, dirName), {
              recursive: true,
              force: true,
            });
            deletedCount++;
          } catch (e) {
            logger.warn("Failed to delete old debug directory", {
              dirName,
              error: e,
            });
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
