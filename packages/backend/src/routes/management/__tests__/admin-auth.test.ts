import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { setConfigForTesting } from '../../../config';
import { registerManagementRoutes } from '../../management';
import { registerInferenceRoutes } from '../../inference';
import { Dispatcher } from '../../../services/dispatcher';
import { UsageStorageService } from '../../../services/usage-storage';
import { DebugManager } from '../../../services/debug-manager';
import { SelectorFactory } from '../../../services/selectors/factory';

// Helper to close Fastify instances after tests
const closeFastify = async (fastify: FastifyInstance | undefined) => {
  if (fastify) {
    await fastify.close();
  }
};

const BASE_CONFIG = {
  providers: {},
  models: {},
  keys: {
    'test-key': { secret: 'sk-test-secret', comment: 'Test Key' },
  },
  failover: {
    enabled: false,
    retryableStatusCodes: [429, 500, 502, 503, 504],
    retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT'],
  },
  quotas: [],
};

// Admin key is now read from process.env.ADMIN_KEY
const originalAdminKey = process.env.ADMIN_KEY;

beforeEach(() => {
  process.env.ADMIN_KEY = originalAdminKey;
});

afterEach(() => {
  process.env.ADMIN_KEY = originalAdminKey;
});

afterAll(() => {
  if (originalAdminKey === undefined) {
    delete process.env.ADMIN_KEY;
  } else {
    process.env.ADMIN_KEY = originalAdminKey;
  }
});

// ---------------------------------------------------------------------------
// Shared minimal mocks
// ---------------------------------------------------------------------------

function makeMockDeps() {
  const mockUsageStorage = {
    saveRequest: vi.fn(),
    saveError: vi.fn(),
    updatePerformanceMetrics: vi.fn(),
    emitStartedAsync: vi.fn(),
    emitUpdatedAsync: vi.fn(),
  } as unknown as UsageStorageService;

  const mockDispatcher = {
    dispatch: vi.fn(async () => ({
      id: 'test-id',
      model: 'test-model',
      created: Date.now(),
      content: 'ok',
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    })),
  } as unknown as Dispatcher;

  return { mockUsageStorage, mockDispatcher };
}

// ---------------------------------------------------------------------------
// Suite: /v0/management/auth/verify
// ---------------------------------------------------------------------------

describe('GET /v0/management/auth/verify', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    process.env.ADMIN_KEY = 'correct-admin-key';
    setConfigForTesting(BASE_CONFIG);
    fastify = Fastify();
    const { mockUsageStorage, mockDispatcher } = makeMockDeps();
    await registerManagementRoutes(fastify, mockUsageStorage, mockDispatcher);
    await fastify.ready();
  });

  afterEach(async () => {
    await closeFastify(fastify);
  });

  it('returns 200 with admin principal info when the correct admin key is provided', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/v0/management/auth/verify',
      headers: { 'x-admin-key': 'correct-admin-key' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; role: string };
    expect(body.ok).toBe(true);
    expect(body.role).toBe('admin');
  });

  it('returns 200 with limited principal info when an api_keys secret is provided', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/v0/management/auth/verify',
      headers: { 'x-admin-key': 'sk-test-secret' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      ok: boolean;
      role: string;
      keyName: string;
      allowedProviders: string[];
      allowedModels: string[];
    };
    expect(body.ok).toBe(true);
    expect(body.role).toBe('limited');
    expect(body.keyName).toBe('test-key');
  });

  it('returns 401 when an incorrect admin key is provided', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/v0/management/auth/verify',
      headers: { 'x-admin-key': 'wrong-key' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when no x-admin-key header is present', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/v0/management/auth/verify',
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns a well-formed error body on rejection', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/v0/management/auth/verify',
      headers: { 'x-admin-key': 'bad-key' },
    });

    const body = res.json();
    expect(body.error).toBeDefined();
    expect(body.error.message).toBe('Unauthorized');
    expect(body.error.type).toBe('auth_error');
    expect(body.error.code).toBe(401);
  });

  it('returns 401 when x-admin-key is an empty string', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/v0/management/auth/verify',
      headers: { 'x-admin-key': '' },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Suite: Protected management routes enforce admin key
// ---------------------------------------------------------------------------

describe('Management route protection', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    process.env.ADMIN_KEY = 'correct-admin-key';
    setConfigForTesting(BASE_CONFIG);
    fastify = Fastify();
    const { mockUsageStorage, mockDispatcher } = makeMockDeps();
    await registerManagementRoutes(fastify, mockUsageStorage, mockDispatcher);
    await fastify.ready();
  });

  afterEach(async () => {
    await closeFastify(fastify);
  });

  it('rejects GET /v0/management/cooldowns without admin key', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/v0/management/cooldowns',
    });

    expect(res.statusCode).toBe(401);
  });

  it('rejects GET /v0/management/cooldowns with wrong admin key', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/v0/management/cooldowns',
      headers: { 'x-admin-key': 'not-the-right-key' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('allows GET /v0/management/cooldowns with correct admin key', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/v0/management/cooldowns',
      headers: { 'x-admin-key': 'correct-admin-key' },
    });

    expect(res.statusCode).toBe(200);
  });

  it('rejects DELETE /v0/management/cooldowns without admin key', async () => {
    const res = await fastify.inject({
      method: 'DELETE',
      url: '/v0/management/cooldowns',
    });

    expect(res.statusCode).toBe(401);
  });

  it('allows DELETE /v0/management/cooldowns with correct admin key', async () => {
    const res = await fastify.inject({
      method: 'DELETE',
      url: '/v0/management/cooldowns',
      headers: { 'x-admin-key': 'correct-admin-key' },
    });

    expect(res.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Suite: Admin key change via env var is reflected immediately
// ---------------------------------------------------------------------------

describe('Admin key env var change', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    process.env.ADMIN_KEY = 'original-key';
    setConfigForTesting(BASE_CONFIG);
    fastify = Fastify();
    const { mockUsageStorage, mockDispatcher } = makeMockDeps();
    await registerManagementRoutes(fastify, mockUsageStorage, mockDispatcher);
    await fastify.ready();
  });

  afterEach(async () => {
    await closeFastify(fastify);
  });

  it('accepts original key initially', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/v0/management/auth/verify',
      headers: { 'x-admin-key': 'original-key' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects the old key and accepts new key after env var update', async () => {
    process.env.ADMIN_KEY = 'rotated-key';

    const oldKeyRes = await fastify.inject({
      method: 'GET',
      url: '/v0/management/auth/verify',
      headers: { 'x-admin-key': 'original-key' },
    });
    expect(oldKeyRes.statusCode).toBe(401);

    const newKeyRes = await fastify.inject({
      method: 'GET',
      url: '/v0/management/auth/verify',
      headers: { 'x-admin-key': 'rotated-key' },
    });
    expect(newKeyRes.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Suite: v1 inference routes are unaffected by admin key middleware
// ---------------------------------------------------------------------------

describe('v1 inference routes are unaffected by admin key auth', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    process.env.ADMIN_KEY = 'correct-admin-key';
    setConfigForTesting(BASE_CONFIG);
    fastify = Fastify();
    const { mockUsageStorage, mockDispatcher } = makeMockDeps();

    DebugManager.getInstance().setStorage(mockUsageStorage);
    SelectorFactory.setUsageStorage(mockUsageStorage);

    await registerInferenceRoutes(fastify, mockDispatcher, mockUsageStorage);
    await registerManagementRoutes(fastify, mockUsageStorage, mockDispatcher);
    await fastify.ready();
  });

  afterEach(async () => {
    await closeFastify(fastify);
    // Clean up singletons to prevent test hangs
    SelectorFactory.setUsageStorage(null as any);
    DebugManager.getInstance().setStorage(null as any);
  });

  it('accepts a v1 request using a valid API key (no admin key needed)', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: 'Bearer sk-test-secret',
        'content-type': 'application/json',
      },
      payload: { model: 'test-model', messages: [] },
    });

    // 200 or a downstream error (404/500) are both fine — what matters is it
    // is NOT a 401 due to missing admin key.
    expect(res.statusCode).not.toBe(401);
  });

  it('rejects a v1 request that sends only an admin key (no API key)', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        'x-admin-key': 'correct-admin-key',
        'content-type': 'application/json',
      },
      payload: { model: 'test-model', messages: [] },
    });

    // Bearer auth should reject it — admin key alone is not valid for v1
    expect(res.statusCode).toBe(401);
  });

  it('management verify still requires admin key on combined server', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/v0/management/auth/verify',
      headers: { authorization: 'Bearer sk-test-secret' },
    });

    // A valid API key must not grant access to management endpoints
    expect(res.statusCode).toBe(401);
  });
});
