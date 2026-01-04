import { describe, it, expect, mock, afterAll, beforeEach } from "bun:test";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../config";

// Setup Temp Config
const TEMP_CONFIG_PATH = join(tmpdir(), `plexus-test-models-${Date.now()}.yaml`);
const MOCK_CONFIG_CONTENT = `
providers: {}
models:
  gpt-4:
    targets: []
  claude-3:
    targets: []
keys: {}
adminKey: admin-secret
`;

// Write the file
writeFileSync(TEMP_CONFIG_PATH, MOCK_CONFIG_CONTENT);

// Set env var BEFORE importing index
process.env.CONFIG_FILE = TEMP_CONFIG_PATH;
process.env.PLEXUS_DB_URL = ':memory:';

// Cleanup after tests
afterAll(() => {
    try {
        unlinkSync(TEMP_CONFIG_PATH);
    } catch (e) {
        // ignore
    }
    delete process.env.CONFIG_FILE;
});

// Mock PricingManager
mock.module('../services/pricing-manager', () => ({
    PricingManager: {
        getInstance: () => ({
            loadPricing: () => Promise.resolve()
        })
    }
}));

// Mock Logger
mock.module('../utils/logger', () => ({
    logger: {
        info: () => {},
        error: () => {},
        debug: () => {},
        warn: () => {},
        silly: () => {}
    },
    logEmitter: {
        on: () => {},
        off: () => {},
        once: () => {},
        emit: () => {}
    },
    StreamTransport: class {}
}));

// Mock serveStatic from hono/bun
mock.module('hono/bun', () => ({
    serveStatic: () => (c: any) => c.text('Mock Static', 200),
    getConnInfo: () => ({ remote: { address: '127.0.0.1' } })
}));

// Ensure config is loaded correctly
await loadConfig(TEMP_CONFIG_PATH);

// Dynamic import to apply mocks
const serverModule = await import('../index');
const server = serverModule.default;

describe('Models API', () => {
    it('GET /v1/models should return models with created field in seconds', async () => {
        const req = new Request('http://localhost/v1/models', {
            method: 'GET'
        });
        const res = await server.fetch(req);
        expect(res.status).toBe(200);
        
        const body = await res.json() as any;
        expect(body.object).toBe('list');
        expect(Array.isArray(body.data)).toBe(true);
        expect(body.data.length).toBe(2);
        
        const model = body.data[0];
        expect(model.id).toBeDefined();
        expect(model.object).toBe('model');
        expect(model.owned_by).toBe('plexus');
        
        // Verify created is in seconds (not milliseconds)
        // Current timestamp in seconds is around 1.7e9
        // Milliseconds would be around 1.7e12
        expect(model.created).toBeLessThan(10000000000); // Definitely less than 10 billion (seconds)
        expect(model.created).toBeGreaterThan(1000000000); // Greater than 1 billion (seconds)
        
        const nowInSeconds = Math.floor(Date.now() / 1000);
        expect(model.created).toBeCloseTo(nowInSeconds, 1);
    });
});
