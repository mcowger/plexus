import { describe, expect, test, afterAll, beforeEach } from "bun:test";
import { Hono } from 'hono';
import fs from 'node:fs';
import { z } from 'zod';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Setup Temp Config
const TEMP_CONFIG_PATH = join(tmpdir(), `plexus-test-api-${Date.now()}.yaml`);
const MOCK_YAML = `
providers:
  test_provider:
    type: chat
    api_base_url: https://api.test.com
    api_key: "123"
models:
  test_model:
    targets:
      - provider: test_provider
        model: gpt-test
keys: {}
adminKey: secret
`;

// Write the initial file
fs.writeFileSync(TEMP_CONFIG_PATH, MOCK_YAML);

// Set env var to point to temp file
process.env.CONFIG_FILE = TEMP_CONFIG_PATH;

// Cleanup
afterAll(() => {
    try {
        fs.unlinkSync(TEMP_CONFIG_PATH);
    } catch (e) {
        // ignore
    }
});

import { logger } from "../utils/logger";
import { getConfigPath, validateConfig, loadConfig } from "../config";

// Initialize config
beforeEach(async () => {
    await loadConfig(TEMP_CONFIG_PATH);
});

const app = new Hono();

// Re-implement the routes exactly as they are in index.ts for unit testing logic
// Note: We use the REAL functions now, so they will access the real TEMP_CONFIG_PATH

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
        await loadConfig(configPath);
        
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
    type: chat
    api_base_url: https://api.anthropic.com
models: {}
keys: {}
adminKey: secret
`;
        const res = await app.request('/v0/management/config', {
            method: 'POST',
            body: newConfig
        });

        expect(res.status).toBe(200);
        
        // Verify file content was updated
        const content = fs.readFileSync(TEMP_CONFIG_PATH, 'utf8');
        expect(content).toBe(newConfig);
    });

    test("POST /v0/management/config should reject invalid YAML", async () => {
        const invalidConfig = "INVALID YAML CONTENT"; // validateConfig will throw ZodError or generic error
        const res = await app.request('/v0/management/config', {
            method: 'POST',
            body: invalidConfig
        });

        expect(res.status).toBe(400);
        const json = await res.json() as any;
        expect(json.error).toBe("Validation failed");
    });
});