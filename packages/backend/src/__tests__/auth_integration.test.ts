import { describe, it, expect, mock } from "bun:test";

// Mock Config
const mockConfig = {
    providers: {},
    models: {},
    keys: {
        'test-key': {
            secret: 'valid-secret',
            comment: 'Test Key'
        }
    }
};

mock.module('../config', () => ({
    loadConfig: () => Promise.resolve(mockConfig),
    getConfig: () => mockConfig,
    getConfigPath: () => '/tmp/test.yaml',
    validateConfig: () => mockConfig,
    setConfigForTesting: () => {}
}));

// Mock PricingManager
mock.module('../services/pricing-manager', () => ({
    PricingManager: {
        getInstance: () => ({
            loadPricing: () => Promise.resolve()
        })
    }
}));

// Mock Logger to silence output during tests
mock.module('../utils/logger', () => ({
    logger: {
        info: () => {},
        error: () => {},
        debug: () => {},
        warn: () => {}
    },
    logEmitter: {
        on: () => {},
        off: () => {},
        once: () => {},
        emit: () => {}
    },
    StreamTransport: class {}
}));

// Mock serveStatic from hono/bun to avoid depending on frontend build
mock.module('hono/bun', () => ({
    serveStatic: () => (c: any) => c.text('Mock Static', 200),
    getConnInfo: () => ({ remote: { address: '127.0.0.1' } })
}));

process.env.PLEXUS_DB_URL = ':memory:';

// Dynamic import to apply mocks
const serverModule = await import('../index');
const server = serverModule.default;

describe('Auth Middleware Integration', () => {
    
    it('should block /v1/chat/completions without api key', async () => {
        const req = new Request('http://localhost/v1/chat/completions', {
            method: 'POST',
            body: JSON.stringify({ model: 'gpt-4' })
        });
        const res = await server.fetch(req);
        expect(res.status).toBe(401);
        const text = await res.text();
        expect(text).toContain('Unauthorized'); // or whatever bearerAuth returns by default ("Unauthorized" usually)
    });

    it('should block /v1/chat/completions with invalid api key', async () => {
        const req = new Request('http://localhost/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer invalid-secret'
            },
            body: JSON.stringify({ model: 'gpt-4' })
        });
        const res = await server.fetch(req);
        expect(res.status).toBe(401);
    });

    it('should allow /v1/chat/completions with valid api key', async () => {
        const req = new Request('http://localhost/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer valid-secret'
            },
            body: JSON.stringify({ model: 'gpt-4' })
        });
        const res = await server.fetch(req);
        // Should NOT be 401. It might be 500 because providers are empty, or 200 if it handles empty config gracefully
        expect(res.status).not.toBe(401);
    });

    it('should allow /v1/models without api key (bypass auth)', async () => {
        const req = new Request('http://localhost/v1/models', {
            method: 'GET'
        });
        const res = await server.fetch(req);
        // Should NOT be 401. Since it's a bypass route, it hits the static server or other routes.
        // In our case, app.get('*', serveStatic(...)) will return 200.
        expect(res.status).toBe(200);
    });

    it('should block /v1/messages without api key', async () => {
        const req = new Request('http://localhost/v1/messages', {
            method: 'POST',
             body: JSON.stringify({ model: 'claude' })
        });
        const res = await server.fetch(req);
        expect(res.status).toBe(401);
    });
});
