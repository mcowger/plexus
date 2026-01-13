import { describe, test, expect, beforeAll, mock, spyOn } from "bun:test";
import { handleState } from "../routes/v0/state";
import { CooldownManager } from "../services/cooldown-manager";
import { HealthMonitor } from "../services/health-monitor";
import { MetricsCollector } from "../services/metrics-collector";
import type { ServerContext } from "../types/server";

describe("State API", () => {
  let context: ServerContext;
  let updateConfigSpy: any;
  let metricsCollector: MetricsCollector;

  beforeAll(() => {
    const mockConfig: any = {
      providers: [
        { name: "openai", enabled: true, models: ["gpt-4"] },
        { name: "anthropic", enabled: true, models: ["claude-3"] }
      ],
      logging: { debug: { enabled: false } },
      resilience: {
        cooldown: { defaults: {}, storagePath: "temp_cooldowns.json" },
        health: {}
      }
    };

    const cooldownManager = new CooldownManager(mockConfig);
    const healthMonitor = new HealthMonitor(mockConfig, cooldownManager);
    metricsCollector = new MetricsCollector();

    // Seed some metrics
    metricsCollector.recordRequest({
        provider: "openai",
        latencyMs: 100,
        success: true,
        timestamp: Date.now(),
        ttftMs: 50,
        tokensPerSecond: 10,
        costPer1M: 5
    });
    metricsCollector.recordRequest({
        provider: "openai",
        latencyMs: 200,
        success: true,
        timestamp: Date.now(),
        ttftMs: 60,
        tokensPerSecond: 10,
        costPer1M: 5
    });

    
    // Mock ConfigManager
    updateConfigSpy = mock(async () => ({ previousChecksum: "old", newChecksum: "new" }));
    const mockConfigManager: any = {
        getConfig: () => ({ config: JSON.stringify(mockConfig), lastModified: "", checksum: "old" }),
        updateConfig: updateConfigSpy
    };

    context = {
      config: mockConfig,
      cooldownManager,
      healthMonitor,
      metricsCollector,
      configManager: mockConfigManager
    };
  });

  test("GET /v0/state returns system state with metrics", async () => {
    const req = new Request("http://localhost/v0/state", { method: "GET" });
    const res = await handleState(req, context);
    
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    
    expect(body.uptime).toBeDefined();
    expect(body.providers).toHaveLength(2);
    expect(body.providers[0].name).toBe("openai");
    
    // Verify real metrics
    const openai = body.providers[0];
    expect(openai.metrics.requestsLast5Min).toBe(2);
    expect(openai.metrics.avgLatency).toBe(150); // (100 + 200) / 2
    expect(openai.metrics.successRate).toBe(1.0);
    
    expect(body.debug.enabled).toBe(false);
  });

  test("POST /v0/state set-debug action", async () => {
    const req = new Request("http://localhost/v0/state", {
      method: "POST",
      body: JSON.stringify({ 
        action: "set-debug", 
        payload: { enabled: true } 
      }),
      headers: { "Content-Type": "application/json" }
    });

    const res = await handleState(req, context);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    
    expect(body.success).toBe(true);
    expect(body.message).toContain("Debug mode set to true");
  });

  test("POST /v0/state disable-provider persists changes", async () => {
    const req = new Request("http://localhost/v0/state", {
      method: "POST",
      body: JSON.stringify({ 
        action: "disable-provider", 
        payload: { provider: "openai" } 
      }),
      headers: { "Content-Type": "application/json" }
    });

    const res = await handleState(req, context);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    
    expect(body.message).toContain("disabled (persisted)");
    expect(updateConfigSpy).toHaveBeenCalled();
    // Verify runtime update
    expect(context.config.providers.find(p => p.name === "openai")?.enabled).toBe(false);
  });

  test("POST /v0/state unknown action", async () => {
    const req = new Request("http://localhost/v0/state", {
      method: "POST",
      body: JSON.stringify({ 
        action: "invalid-action", 
        payload: {} 
      }),
      headers: { "Content-Type": "application/json" }
    });

    const res = await handleState(req, context);
    expect(res.status).toBe(400);
  });
});
