import { describe, expect, test, mock } from "bun:test";
import { Hono } from 'hono';
import fs from 'node:fs';
import { z } from 'zod';

// Mock config module before importing index (which might import it)
// We need to allow the real validateConfig to run or mock it effectively.
// Given the complexity of mocking modules that are internal imports, 
// we'll mock the specific functions we need from './config' via `mock.module`.

const MOCK_CONFIG_PATH = "/tmp/mock_plexus.yaml";
const MOCK_YAML = `
providers:
  test_provider:
    type: chat
    api_base_url: https://api.test.com
    api_key: 123
models:
  test_model:
    targets:
      - provider: test_provider
        model: gpt-test
`;

mock.module("../config", () => {
    return {
        getConfigPath: () => MOCK_CONFIG_PATH,
        loadConfig: () => ({}),
        getConfig: () => ({}),
        validateConfig: (yamlStr: string) => {
            if (yamlStr.includes("INVALID")) throw new Error("Invalid YAML");
            return {};
        }
    };
});

// We also need to mock fs methods used in the route
mock.module("node:fs", () => {
    return {
        default: {
            existsSync: (path: string) => path === MOCK_CONFIG_PATH,
            readFileSync: (path: string) => {
                if (path === MOCK_CONFIG_PATH) return MOCK_YAML;
                throw new Error("File not found");
            },
            writeFileSync: mock(),
            watch: mock()
        }
    };
});


// Now import the app (or the route handler logic if we could isolate it)
// Since index.ts starts the server immediately, importing it is tricky in Bun test if it has side effects.
// Ideally, we should refactor index.ts to export the `app` for testing.
// For now, I will recreate a minimal Hono app with the same route logic for testing purposes
// to avoid the side effects of importing the main entry point which binds to a port.

import { logger } from "../utils/logger";

const app = new Hono();

// Re-implement the routes exactly as they are in index.ts for unit testing logic
import { getConfigPath, validateConfig, loadConfig } from "../config";

app.get('/v0/management/config', (c) => {
    const configPath = getConfigPath();
    if (!configPath || !fs.existsSync(configPath)) {
        return c.json({ error: "Configuration file not found" }, 404);
    }
    const configContent = fs.readFileSync(configPath, 'utf8');
    c.header('Content-Type', 'application/x-yaml');
    return c.body(configContent);
});

app.post('/v0/management/config', async (c) => {
    const configPath = getConfigPath();
    if (!configPath) {
         return c.json({ error: "Configuration path not determined" }, 500);
    }

    try {
        const body = await c.req.text();
        
        // Validate YAML
        try {
            validateConfig(body);
        } catch (e) {
            if (e instanceof z.ZodError) {
                return c.json({ error: "Validation failed", details: e.errors }, 400);
            }
             return c.json({ error: "Invalid YAML or Schema", details: String(e) }, 400);
        }

        // Write to file
        fs.writeFileSync(configPath, body, 'utf8');
        
        // Force reload
        loadConfig(configPath);
        
        return c.body(body, 200, { 'Content-Type': 'application/x-yaml' });
    } catch (e: any) {
        logger.error("Failed to update config", e);
        return c.json({ error: e.message }, 500);
    }
});

describe("Config Management API", () => {

    test("GET /v0/management/config should return raw YAML", async () => {
        const res = await app.request('/v0/management/config');
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('application/x-yaml');
        const text = await res.text();
        expect(text).toBe(MOCK_YAML);
    });

    test("POST /v0/management/config should update config with valid YAML", async () => {
        const newConfig = `
providers:
  new_provider:
    type: messages
    api_base_url: https://api.anthropic.com
models: {}
`;
        const res = await app.request('/v0/management/config', {
            method: 'POST',
            body: newConfig
        });

        expect(res.status).toBe(200);
        expect(fs.writeFileSync).toHaveBeenCalledWith(MOCK_CONFIG_PATH, newConfig, 'utf8');
    });

    test("POST /v0/management/config should reject invalid YAML", async () => {
        const invalidConfig = "INVALID YAML CONTENT";
        const res = await app.request('/v0/management/config', {
            method: 'POST',
            body: invalidConfig
        });

        expect(res.status).toBe(400);
        const json = await res.json() as any;
        expect(json.error).toBe("Invalid YAML or Schema");
    });
});
