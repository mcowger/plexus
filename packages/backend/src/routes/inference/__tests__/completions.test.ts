import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { setConfigForTesting } from '../../../config';
import { registerInferenceRoutes } from '../index';
import { Dispatcher } from '../../../services/dispatch/dispatcher';
import { UsageStorageService } from '../../../services/observability/usage-storage';
import { DebugManager } from '../../../services/observability/debug-manager';
import { SelectorFactory } from '../../../services/routing/selectors/factory';

const COMPLETIONS_TEST_CONFIG = {
  providers: {
    openai: {
      api_key: 'sk-test',
      api_base_url: 'https://api.openai.com/v1',
      estimateTokens: false,
      disable_cooldown: false,
      stall_cooldown: false,
      useClaudeMasking: false,
      models: {
        'gpt-3.5-turbo-instruct': {
          pricing: { source: 'simple' as const, input: 0.0015, output: 0.002 },
        },
      },
    },
  },
  models: {
    'code-completion': {
      priority: 'selector' as const,
      sticky_session: false,
      targets: [{ provider: 'openai', model: 'gpt-3.5-turbo-instruct' }],
    },
  },
  keys: {
    'test-key-1': { secret: 'sk-valid-key', comment: 'Test Key' },
  },
  failover: {
    enabled: false,
    retryableStatusCodes: [429, 500, 502, 503, 504],
    retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT'],
  },
  quotas: [],
};

describe('Completions Endpoint', () => {
  let fastify: FastifyInstance;
  let mockUsageStorage: UsageStorageService;
  let mockDispatcher: Dispatcher;

  beforeEach(async () => {
    setConfigForTesting(COMPLETIONS_TEST_CONFIG);

    fastify = Fastify();

    mockDispatcher = {
      dispatch: vi.fn(async () => ({
        id: 'cmpl-test-uuid',
        model: 'gpt-3.5-turbo-instruct',
        created: 1700000000,
        content: 'return a + b;',
        usage: {
          input_tokens: 10,
          output_tokens: 4,
          total_tokens: 14,
          reasoning_tokens: 0,
          cached_tokens: 0,
          cache_creation_tokens: 0,
        },
        plexus: {
          provider: 'openai',
          model: 'gpt-3.5-turbo-instruct',
          apiType: 'completions',
          canonicalModel: 'code-completion',
        },
      })),
    } as unknown as Dispatcher;

    mockUsageStorage = {
      saveRequest: vi.fn(),
      saveError: vi.fn(),
      saveDebugLog: vi.fn(),
      updatePerformanceMetrics: vi.fn(),
      emitStartedAsync: vi.fn(),
      emitUpdatedAsync: vi.fn(),
    } as unknown as UsageStorageService;

    DebugManager.getInstance().setStorage(mockUsageStorage);
    SelectorFactory.setUsageStorage(mockUsageStorage);

    await registerInferenceRoutes(fastify, mockDispatcher, mockUsageStorage);
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  it('should accept non-streaming POST /v1/completions request', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/completions',
      headers: {
        authorization: 'Bearer sk-valid-key',
        'content-type': 'application/json',
      },
      payload: {
        model: 'code-completion',
        prompt: 'function add(a, b) {\n  ',
        max_tokens: 30,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.object).toBe('text_completion');
    expect(body.id).toBe('cmpl-test-uuid');
    expect(body.model).toBe('gpt-3.5-turbo-instruct');
    expect(body.choices).toHaveLength(1);
    expect(body.choices[0].text).toBe('return a + b;');
    expect(body.usage.prompt_tokens).toBe(10);
    expect(body.usage.completion_tokens).toBe(4);
  });

  it('should accept non-streaming POST /completions alias request', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/completions',
      headers: {
        authorization: 'Bearer sk-valid-key',
        'content-type': 'application/json',
      },
      payload: {
        model: 'code-completion',
        prompt: 'def hello():\n    ',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.object).toBe('text_completion');
    expect(body.choices[0].text).toBe('return a + b;');
  });

  it('should reject request without valid auth token', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/completions',
      headers: {
        authorization: 'Bearer invalid-token',
        'content-type': 'application/json',
      },
      payload: {
        model: 'code-completion',
        prompt: 'test',
      },
    });

    expect(response.statusCode).toBe(401);
  });
});
