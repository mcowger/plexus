import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { loadConfig } from "../config";
import { join } from "path";

describe("DEBUG_MODE Configuration", () => {
  const originalEnv = process.env;

  beforeAll(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("should enable debug mode when DEBUG_MODE env var is set", async () => {
    process.env.DEBUG_MODE = "true";
    
    // We need a valid config file for loadConfig to work without throwing ENOENT
    // We can point to the example config or rely on the default if it exists.
    // The default is ./config/plexus.yaml relative to CWD.
    // The user's context shows config/plexus.example-phase6.yaml
    
    // Let's create a dummy config file for this test
    const dummyConfigPath = join(process.cwd(), "config", "debug_test_config.yaml");
    const dummyConfigContent = `
server:
  port: 8080
  host: "localhost"
logging:
  level: "info"
providers: []
apiKeys: []
`;
    await Bun.write(dummyConfigPath, dummyConfigContent);

    try {
        const config = await loadConfig(dummyConfigPath);

        expect(config.logging.level).toBe("debug");
        expect(config.logging.debug).toBeDefined();
        expect(config.logging.debug?.enabled).toBe(true);
        expect(config.logging.debug?.captureRequests).toBe(true);
        expect(config.logging.debug?.captureResponses).toBe(true);
    } finally {
        await Bun.file(dummyConfigPath).delete();
    }
  });

  it("should respect explicit config when DEBUG_MODE is NOT set", async () => {
    delete process.env.DEBUG_MODE;
    
    const dummyConfigPath = join(process.cwd(), "config", "debug_test_config_off.yaml");
    const dummyConfigContent = `
server:
  port: 8080
  host: "localhost"
logging:
  level: "info"
  debug:
    enabled: false
providers: []
apiKeys: []
`;
    await Bun.write(dummyConfigPath, dummyConfigContent);

    try {
        const config = await loadConfig(dummyConfigPath);

        expect(config.logging.level).toBe("info");
        expect(config.logging.debug?.enabled).toBe(false);
    } finally {
        await Bun.file(dummyConfigPath).delete();
    }
  });
});
