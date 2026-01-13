import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { LogQueryService } from "../services/log-query";
import { UsageStore } from "../storage/usage-store";
import { ErrorStore } from "../storage/error-store";
import { DebugStore } from "../storage/debug-store";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

describe("Log Details Integration", () => {
  const TEST_LOG_DIR = "test-logs-details";
  let logQueryService: LogQueryService;
  let usageStore: UsageStore;
  let errorStore: ErrorStore;
  let debugStore: DebugStore;

  beforeAll(async () => {
    await mkdir(TEST_LOG_DIR, { recursive: true });
    await mkdir(join(TEST_LOG_DIR, "usage"), { recursive: true });
    await mkdir(join(TEST_LOG_DIR, "errors"), { recursive: true });
    await mkdir(join(TEST_LOG_DIR, "debug"), { recursive: true });

    usageStore = new UsageStore(join(TEST_LOG_DIR, "usage"));
    errorStore = new ErrorStore(join(TEST_LOG_DIR, "errors"));
    debugStore = new DebugStore(join(TEST_LOG_DIR, "debug"), 7);

    // Write a mock usage log
    const today = new Date().toISOString().split('T')[0];
    const requestId = "test-req-123";
    const usageEntry = {
      id: requestId,
      timestamp: new Date().toISOString(),
      actualProvider: "openai",
      actualModel: "gpt-4",
      success: true,
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      cost: { totalCost: 0.001 },
      metrics: { durationMs: 100, ttftMs: 50 }
    };
    await Bun.write(join(TEST_LOG_DIR, "usage", `${today}.jsonl`), JSON.stringify(usageEntry) + "\n");

    // Write a mock debug trace using the store method
    const debugEntry = {
      id: requestId,
      timestamp: new Date().toISOString(),
      clientRequest: {
          apiType: "chat" as any,
          body: { model: "gpt-4" },
          headers: {}
      },
      unifiedRequest: { model: "gpt-4" },
      providerRequest: {
          apiType: "chat" as any,
          body: { model: "gpt-4" },
          headers: {}
      }
    };
    await debugStore.store(debugEntry);

    logQueryService = new LogQueryService(usageStore, errorStore, debugStore);
  });

  afterAll(async () => {
    await rm(TEST_LOG_DIR, { recursive: true, force: true });
  });

  test("getLogDetails finds entry by ID", async () => {
    const details = await logQueryService.getLogDetails("test-req-123");
    
    expect(details).not.toBeNull();
    expect(details?.usage.id).toBe("test-req-123");
    expect(details?.traces).toHaveLength(1);
    expect(details!.traces![0]!.id).toBe("test-req-123");
  });

  test("getLogDetails returns null for non-existent ID", async () => {
    const details = await logQueryService.getLogDetails("non-existent");
    expect(details).toBeNull();
  });
});
