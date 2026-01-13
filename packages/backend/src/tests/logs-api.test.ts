import { describe, test, expect, beforeAll } from "bun:test";
import { handleLogs } from "../routes/v0/logs";
import { LogQueryService } from "../services/log-query";
import { UsageStore } from "../storage/usage-store";
import { ErrorStore } from "../storage/error-store";
import { DebugStore } from "../storage/debug-store";

describe("Logs API", () => {
  let logQueryService: LogQueryService;
  let usageStore: UsageStore;

  beforeAll(() => {
    // Mocks
    usageStore = new UsageStore("logs/usage");
    const errorStore = new ErrorStore("logs/errors");
    const debugStore = new DebugStore("logs/debug", 7);

    // Mock query method
    usageStore.query = async (q) => {
      const logs = [
        { id: "req_1", timestamp: "2024-01-01T10:00:00Z", actualProvider: "openai", success: true },
        { id: "req_2", timestamp: "2024-01-01T10:05:00Z", actualProvider: "anthropic", success: true }
      ] as any[];
      
      if (q.provider) {
        return logs.filter(l => l.actualProvider === q.provider);
      }
      return logs;
    };

    logQueryService = new LogQueryService(usageStore, errorStore, debugStore);
  });

  test("GET /v0/logs returns logs list", async () => {
    const req = new Request("http://localhost/v0/logs?limit=10", { method: "GET" });
    const res = await handleLogs(req, logQueryService);
    
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    
    expect(body.type).toBe("usage");
    expect(body.total).toBe(2);
    expect(body.entries).toHaveLength(2);
  });

  test("GET /v0/logs filters by provider", async () => {
    const req = new Request("http://localhost/v0/logs?provider=openai", { method: "GET" });
    const res = await handleLogs(req, logQueryService);
    
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].actualProvider).toBe("openai");
  });
});
