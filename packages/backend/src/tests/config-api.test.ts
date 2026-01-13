import { describe, test, expect, beforeAll, afterAll, spyOn } from "bun:test";
import { ConfigManager } from "../services/config-manager";
import { EventEmitter } from "../services/event-emitter";
import { handleConfig } from "../routes/v0/config";
import { unlink } from "node:fs/promises";
import { join } from "path";

describe("Config API", () => {
  const tempConfigPath = join(process.cwd(), "temp-config.yaml");
  const initialConfig = `
server:
  port: 3000
  host: "0.0.0.0"
providers: []
logging:
  level: info
`;
  
  let configManager: ConfigManager;
  let eventEmitter: EventEmitter;

  beforeAll(async () => {
    await Bun.write(tempConfigPath, initialConfig);
    eventEmitter = new EventEmitter();
    // Mocking current config object - strict type matching isn't needed for this unit test of the route/manager logic
    const mockConfig: any = { server: { port: 3000 } }; 
    configManager = new ConfigManager(tempConfigPath, mockConfig, eventEmitter);
  });

  afterAll(async () => {
    if (await Bun.file(tempConfigPath).exists()) {
      await unlink(tempConfigPath);
    }
    eventEmitter.shutdown();
  });

  test("GET /v0/config returns config and metadata", async () => {
    const req = new Request("http://localhost/v0/config", { method: "GET" });
    const res = await handleConfig(req, configManager);
    
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.config).toContain("port: 3000");
    expect(body.checksum).toBeDefined();
    expect(body.lastModified).toBeDefined();
  });

  test("POST /v0/config updates config", async () => {
    const newConfig = `
server:
  port: 4000
  host: "0.0.0.0"
logging:
  level: debug
  usage:
    enabled: true
    storagePath: "./data/logs/usage"
    retentionDays: 30
  errors:
    storagePath: "./data/logs/errors"
    retentionDays: 90
  debug:
    enabled: false
    captureRequests: true
    captureResponses: true
    storagePath: "./data/logs/debug"
    retentionDays: 7
providers: []
models: []
apiKeys: []
resilience:
  cooldown:
    defaults:
      rate_limit: 60
      auth_error: 3600
      timeout: 30
      server_error: 120
      connection_error: 60
    maxDuration: 3600
    minDuration: 5
    storagePath: "./data/cooldowns.json"
  health:
    degradedThreshold: 0.5
    unhealthyThreshold: 0.9
`;
    
    const req = new Request("http://localhost/v0/config", {
      method: "POST",
      body: JSON.stringify({ config: newConfig }),
      headers: { "Content-Type": "application/json" }
    });

    const emitSpy = spyOn(eventEmitter, "emitEvent");
    
    const res = await handleConfig(req, configManager);
    expect(res.status).toBe(200);
    
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.newChecksum).not.toBe(body.previousChecksum);

    // Verify file written
    const savedConfig = Bun.file(tempConfigPath);
    expect(await savedConfig.text()).toBe(newConfig);

    // Verify event emitted
    expect(emitSpy).toHaveBeenCalledWith("config_change", expect.any(Object));
  });

  test("POST /v0/config validates invalid yaml", async () => {
    const invalidConfig = `
server:
  port: "not a number"
    indentation error
`;
    
    const req = new Request("http://localhost/v0/config", {
      method: "POST",
      body: JSON.stringify({ config: invalidConfig }),
      headers: { "Content-Type": "application/json" }
    });

    const res = await handleConfig(req, configManager);
    expect(res.status).toBe(400); // Or 500 depending on parser error
    const body = await res.json() as any;
    expect(body.success).toBe(false);
  });
});
