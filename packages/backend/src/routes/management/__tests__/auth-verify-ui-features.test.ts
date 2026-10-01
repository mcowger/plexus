import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { setConfigForTesting } from '../../../config';
import { registerManagementRoutes } from '../../management';
import { Dispatcher } from '../../../services/dispatch/dispatcher';
import { UsageStorageService } from '../../../services/observability/usage-storage';
import { ProbeService } from '../../../services/probes/probe-service';

const closeFastify = async (fastify: FastifyInstance | undefined) => {
  if (fastify) await fastify.close();
};

const originalAdminKey = process.env.ADMIN_KEY;
const originalAutoRouting = process.env.PLEXUS_UI_AUTO_ROUTING;

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

beforeEach(() => {
  process.env.ADMIN_KEY = 'correct-admin-key';
  delete process.env.PLEXUS_UI_AUTO_ROUTING;
  setConfigForTesting(BASE_CONFIG);
});

afterEach(() => {
  process.env.ADMIN_KEY = originalAdminKey;
  if (originalAutoRouting === undefined) delete process.env.PLEXUS_UI_AUTO_ROUTING;
  else process.env.PLEXUS_UI_AUTO_ROUTING = originalAutoRouting;
});

afterAll(() => {
  if (originalAdminKey === undefined) delete process.env.ADMIN_KEY;
  else process.env.ADMIN_KEY = originalAdminKey;
  if (originalAutoRouting === undefined) delete process.env.PLEXUS_UI_AUTO_ROUTING;
  else process.env.PLEXUS_UI_AUTO_ROUTING = originalAutoRouting;
});

function makeMockDeps() {
  const mockUsageStorage = {} as unknown as UsageStorageService;
  const mockDispatcher = {} as unknown as Dispatcher;
  const mockProbeService = {} as unknown as ProbeService;
  return { mockUsageStorage, mockDispatcher, mockProbeService };
}

describe('GET /v0/management/auth/verify — uiFeatures', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    fastify = Fastify();
    const { mockUsageStorage, mockDispatcher, mockProbeService } = makeMockDeps();
    await registerManagementRoutes(fastify, mockUsageStorage, mockDispatcher, mockProbeService);
    await fastify.ready();
  });

  afterEach(async () => {
    await closeFastify(fastify);
  });

  const seed = 'correct-admin-key';
  const cases: Array<{
    role: 'admin' | 'limited';
    credential: string;
    env: string | undefined;
    expected: boolean;
  }> = [
    { role: 'admin', credential: seed, env: undefined, expected: false },
    { role: 'admin', credential: seed, env: 'false', expected: false },
    { role: 'admin', credential: seed, env: 'true', expected: true },
    { role: 'limited', credential: 'sk-test-secret', env: undefined, expected: false },
    { role: 'limited', credential: 'sk-test-secret', env: 'false', expected: false },
    { role: 'limited', credential: 'sk-test-secret', env: 'true', expected: true },
  ];

  it.each(cases)(
    'reports autoRouting=$expected for $role principal with env=$env',
    async ({ role, credential, env, expected }) => {
      if (env === undefined) delete process.env.PLEXUS_UI_AUTO_ROUTING;
      else process.env.PLEXUS_UI_AUTO_ROUTING = env;

      const res = await fastify.inject({
        method: 'GET',
        url: '/v0/management/auth/verify',
        headers: { 'x-admin-key': credential },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { role: string; uiFeatures: { autoRouting: boolean } };
      expect(body.role).toBe(role);
      expect(body.uiFeatures).toEqual({ autoRouting: expected });
    }
  );
});
