import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { setConfigForTesting } from '../../../config';
import { registerInferenceRoutes } from '../index';
import { Dispatcher } from '../../../services/dispatcher';
import { UsageStorageService } from '../../../services/usage-storage';
import { DebugManager } from '../../../services/debug-manager';
import { SelectorFactory } from '../../../services/selectors/factory';
import { runPiAiExecutor } from '../../../inference-v2/shared/pi-ai-executor';

vi.mock('../../../inference-v2/shared/pi-ai-executor', () => ({
  runPiAiExecutor: vi.fn(async (input: any) => ({
    response: {
      id: `beta-${input.incomingApiType}`,
      model: input.modelAlias,
      beta: true,
      apiType: input.incomingApiType,
    },
  })),
}));

function createUsageStorage(): UsageStorageService {
  return {
    saveRequest: vi.fn(async () => undefined),
    saveError: vi.fn(async () => undefined),
    saveDebugLog: vi.fn(),
    updatePerformanceMetrics: vi.fn(),
    emitStartedAsync: vi.fn(),
    emitUpdatedAsync: vi.fn(),
    registerInFlight: vi.fn(),
    deregisterInFlight: vi.fn(),
  } as unknown as UsageStorageService;
}

async function createApp(): Promise<{
  fastify: FastifyInstance;
  dispatch: ReturnType<typeof vi.fn>;
  usageStorage: UsageStorageService;
}> {
  const fastify = Fastify();
  const dispatch = vi.fn(async () => ({
    id: 'legacy-response',
    model: 'test-model',
    created: 123,
    content: 'legacy content',
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  }));
  const usageStorage = createUsageStorage();

  DebugManager.getInstance().setStorage(usageStorage);
  SelectorFactory.setUsageStorage(usageStorage);

  setConfigForTesting({
    providers: {},
    models: {
      'test-model': {
        priority: 'selector',
        sticky_session: false,
        targets: [{ provider: 'test-provider', model: 'test-model' }],
      },
    },
    keys: {
      stable: { secret: 'sk-stable' },
      beta: { secret: 'sk-beta', beta: true },
    },
    failover: {
      enabled: false,
      retryableStatusCodes: [429, 500, 502, 503, 504],
      retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT'],
    },
    quotas: [],
  });

  await registerInferenceRoutes(fastify, { dispatch } as unknown as Dispatcher, usageStorage);
  await fastify.ready();
  return { fastify, dispatch, usageStorage };
}

describe('beta key stable route routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps normal keys on the legacy chat route', async () => {
    const { fastify, dispatch } = await createApp();

    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer sk-stable', 'content-type': 'application/json' },
      payload: { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(runPiAiExecutor).not.toHaveBeenCalled();
    await fastify.close();
  });

  it.each([
    {
      name: 'chat completions',
      url: '/v1/chat/completions',
      expectedApiType: 'chat',
      payload: { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] },
    },
    {
      name: 'messages',
      url: '/v1/messages',
      expectedApiType: 'messages',
      payload: { model: 'test-model', max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] },
    },
    {
      name: 'responses',
      url: '/v1/responses',
      expectedApiType: 'responses',
      payload: { model: 'test-model', input: 'hi' },
    },
    {
      name: 'gemini generateContent',
      url: '/v1beta/models/test-model:generateContent',
      expectedApiType: 'gemini',
      payload: { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] },
    },
    {
      name: 'gemini streamGenerateContent',
      url: '/v1beta/models/test-model:streamGenerateContent',
      expectedApiType: 'gemini',
      payload: { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] },
    },
  ])('routes beta keys on stable $name path through pi-ai beta handler', async (testCase) => {
    const { fastify, dispatch } = await createApp();

    const response = await fastify.inject({
      method: 'POST',
      url: testCase.url,
      headers: { authorization: 'Bearer sk-beta', 'content-type': 'application/json' },
      payload: testCase.payload,
    });

    expect(response.statusCode).toBe(200);
    expect(dispatch).not.toHaveBeenCalled();
    expect(runPiAiExecutor).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runPiAiExecutor).mock.calls[0]![0]).toMatchObject({
      incomingApiType: testCase.expectedApiType,
      modelAlias: 'test-model',
    });
    await fastify.close();
  });

  it.each([
    {
      name: 'gemini generateContent',
      url: '/beta/v1beta/models/test-model:generateContent',
      payload: { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] },
    },
    {
      name: 'gemini streamGenerateContent',
      url: '/beta/v1beta/models/test-model:streamGenerateContent',
      payload: { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] },
    },
  ])('routes explicit beta $name path through pi-ai beta handler', async (testCase) => {
    const { fastify, dispatch } = await createApp();

    const response = await fastify.inject({
      method: 'POST',
      url: testCase.url,
      headers: { authorization: 'Bearer sk-stable', 'content-type': 'application/json' },
      payload: testCase.payload,
    });

    expect(response.statusCode).toBe(200);
    expect(dispatch).not.toHaveBeenCalled();
    expect(runPiAiExecutor).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runPiAiExecutor).mock.calls[0]![0]).toMatchObject({
      incomingApiType: 'gemini',
      modelAlias: 'test-model',
    });
    await fastify.close();
  });

  it('saves terminal error usage when beta executor fails before completion', async () => {
    const error = new Error('No beta-compatible candidate found') as Error & {
      routingContext?: Record<string, unknown>;
    };
    error.routingContext = { statusCode: 400, code: 'no_beta_compatible_candidate' };
    vi.mocked(runPiAiExecutor).mockRejectedValueOnce(error);
    const { fastify, usageStorage } = await createApp();

    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer sk-beta', 'content-type': 'application/json' },
      payload: { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] },
    });

    expect(response.statusCode, response.body).toBe(400);
    expect(usageStorage.saveRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'beta',
        incomingApiType: 'chat',
        incomingModelAlias: 'test-model',
        responseStatus: 'error',
      })
    );
    await fastify.close();
  });
});
