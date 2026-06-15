import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { setConfigForTesting } from '../../../config';
import { registerManagementRoutes } from '../../management';
import { Dispatcher } from '../../../services/dispatcher';
import { UsageStorageService } from '../../../services/usage-storage';
import { ProbeService } from '../../../services/probe-service';

const TEST_CONFIG = {
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
      content: 'acknowledged',
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
        reasoning_tokens: 0,
        cached_tokens: 0,
        cache_creation_tokens: 0,
      },
      plexus: {
        provider: 'test-provider',
        model: 'test-model',
        apiType: 'chat',
        canonicalModel: 'test-model',
        attemptCount: 1,
      },
    })),
    dispatchEmbeddings: vi.fn(async () => ({
      object: 'list',
      data: [{ object: 'embedding', embedding: [0.1, 0.2], index: 0 }],
      model: 'text-embedding-3-small',
      usage: { prompt_tokens: 8, total_tokens: 8 },
      plexus: {
        provider: 'openai',
        model: 'text-embedding-3-small',
        apiType: 'embeddings',
        canonicalModel: 'embeddings-small',
        attemptCount: 1,
      },
    })),
    dispatchImageGenerations: vi.fn(async () => ({
      created: Date.now(),
      data: [{ url: 'https://example.com/image.png' }],
      plexus: {
        provider: 'openai',
        model: 'dall-e-3',
        apiType: 'images',
        canonicalModel: 'dall-e-3',
        attemptCount: 1,
      },
    })),
    dispatchSpeech: vi.fn(async () => ({
      content: Buffer.from('audio-data'),
      plexus: {
        provider: 'openai',
        model: 'tts-1',
        apiType: 'speech',
        canonicalModel: 'tts-1',
        attemptCount: 1,
      },
    })),
  } as unknown as Dispatcher;

  return { mockUsageStorage, mockDispatcher };
}

describe('POST /v0/management/test', () => {
  let fastify: FastifyInstance;
  let mockUsageStorage: UsageStorageService;
  let mockDispatcher: Dispatcher;
  let probeService: ProbeService;

  beforeEach(async () => {
    process.env.ADMIN_KEY = 'test-admin-key';
    setConfigForTesting(TEST_CONFIG);
    fastify = Fastify();
    const deps = makeMockDeps();
    mockUsageStorage = deps.mockUsageStorage;
    mockDispatcher = deps.mockDispatcher;
    probeService = new ProbeService(mockDispatcher, mockUsageStorage);
    await registerManagementRoutes(fastify, mockUsageStorage, mockDispatcher, probeService);
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  it('requires admin key authentication', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/v0/management/test',
      payload: { provider: 'openai', model: 'gpt-4' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('rejects incorrect admin key', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/v0/management/test',
      headers: { 'x-admin-key': 'wrong-key' },
      payload: { provider: 'openai', model: 'gpt-4' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when provider is missing', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/v0/management/test',
      headers: { 'x-admin-key': 'test-admin-key' },
      payload: { model: 'gpt-4' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('provider');
  });

  it('returns 400 when model is missing', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/v0/management/test',
      headers: { 'x-admin-key': 'test-admin-key' },
      payload: { provider: 'openai' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('model');
  });

  it('returns 400 for invalid apiType', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/v0/management/test',
      headers: { 'x-admin-key': 'test-admin-key' },
      payload: { provider: 'openai', model: 'gpt-4', apiType: 'invalid' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Invalid API type');
  });

  it('returns 400 for transcriptions apiType (not supported in test endpoint)', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/v0/management/test',
      headers: { 'x-admin-key': 'test-admin-key' },
      payload: { provider: 'openai', model: 'whisper-1', apiType: 'transcriptions' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/transcriptions/i);
  });

  it('emits started event when a test request begins', async () => {
    await fastify.inject({
      method: 'POST',
      url: '/v0/management/test',
      headers: { 'x-admin-key': 'test-admin-key' },
      payload: { provider: 'openai', model: 'gpt-4' },
    });

    expect(mockUsageStorage.emitStartedAsync).toHaveBeenCalled();
    const startedCall = (mockUsageStorage.emitStartedAsync as any).mock.calls[0][0];
    expect(startedCall.requestId).toBeDefined();
    expect(startedCall.isStreamed).toBe(false);
  });

  it('saves a usage record on successful chat test', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/v0/management/test',
      headers: { 'x-admin-key': 'test-admin-key' },
      payload: { provider: 'openai', model: 'gpt-4' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);

    expect(mockUsageStorage.saveRequest).toHaveBeenCalled();
    const saveCall = (mockUsageStorage.saveRequest as any).mock.calls[0][0];
    expect(saveCall.incomingApiType).toBe('chat');
    expect(saveCall.incomingModelAlias).toBe('direct/openai/gpt-4');
    expect(saveCall.responseStatus).toBe('success');
    expect(saveCall.provider).toBe('test-provider');
    expect(saveCall.selectedModelName).toBe('test-model');
    expect(saveCall.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('captures token usage in the saved record', async () => {
    await fastify.inject({
      method: 'POST',
      url: '/v0/management/test',
      headers: { 'x-admin-key': 'test-admin-key' },
      payload: { provider: 'openai', model: 'gpt-4' },
    });

    const saveCall = (mockUsageStorage.saveRequest as any).mock.calls[0][0];
    expect(saveCall.tokensInput).toBe(10);
    expect(saveCall.tokensOutput).toBe(5);
  });

  it('emits updated event with routing details on success', async () => {
    await fastify.inject({
      method: 'POST',
      url: '/v0/management/test',
      headers: { 'x-admin-key': 'test-admin-key' },
      payload: { provider: 'openai', model: 'gpt-4' },
    });

    expect(mockUsageStorage.emitUpdatedAsync).toHaveBeenCalled();
    const updatedCall = (mockUsageStorage.emitUpdatedAsync as any).mock.calls[0][0];
    expect(updatedCall.provider).toBe('test-provider');
    expect(updatedCall.selectedModelName).toBe('test-model');
    expect(updatedCall.canonicalModelName).toBe('test-model');
  });

  it('saves error usage record when dispatch fails', async () => {
    (mockDispatcher.dispatch as any).mockRejectedValueOnce(new Error('Provider unavailable'));

    const res = await fastify.inject({
      method: 'POST',
      url: '/v0/management/test',
      headers: { 'x-admin-key': 'test-admin-key' },
      payload: { provider: 'openai', model: 'gpt-4' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Provider unavailable');

    expect(mockUsageStorage.saveRequest).toHaveBeenCalled();
    const saveCall = (mockUsageStorage.saveRequest as any).mock.calls[0][0];
    expect(saveCall.responseStatus).toBe('error');

    expect(mockUsageStorage.saveError).toHaveBeenCalled();
  });

  it('saves error record with routing context when available', async () => {
    const routingError = new Error('All retries failed');
    (routingError as any).routingContext = {
      attemptCount: 3,
      retryHistory: ['openai', 'anthropic'],
    };
    (mockDispatcher.dispatch as any).mockRejectedValueOnce(routingError);

    await fastify.inject({
      method: 'POST',
      url: '/v0/management/test',
      headers: { 'x-admin-key': 'test-admin-key' },
      payload: { provider: 'openai', model: 'gpt-4' },
    });

    const saveCall = (mockUsageStorage.saveRequest as any).mock.calls[0][0];
    expect(saveCall.attemptCount).toBe(3);
    expect(saveCall.retryHistory).toEqual(['openai', 'anthropic']);
  });

  it('handles embeddings apiType with usage tracking', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/v0/management/test',
      headers: { 'x-admin-key': 'test-admin-key' },
      payload: { provider: 'openai', model: 'text-embedding-3-small', apiType: 'embeddings' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);

    const saveCall = (mockUsageStorage.saveRequest as any).mock.calls[0][0];
    expect(saveCall.incomingApiType).toBe('embeddings');
    expect(saveCall.responseStatus).toBe('success');
  });

  it('handles images apiType with usage tracking', async () => {
    await fastify.inject({
      method: 'POST',
      url: '/v0/management/test',
      headers: { 'x-admin-key': 'test-admin-key' },
      payload: { provider: 'openai', model: 'dall-e-3', apiType: 'images' },
    });

    const saveCall = (mockUsageStorage.saveRequest as any).mock.calls[0][0];
    expect(saveCall.incomingApiType).toBe('images');
    expect(saveCall.responseStatus).toBe('success');
  });

  it('handles speech apiType with usage tracking', async () => {
    await fastify.inject({
      method: 'POST',
      url: '/v0/management/test',
      headers: { 'x-admin-key': 'test-admin-key' },
      payload: { provider: 'openai', model: 'tts-1', apiType: 'speech' },
    });

    const saveCall = (mockUsageStorage.saveRequest as any).mock.calls[0][0];
    expect(saveCall.incomingApiType).toBe('speech');
    expect(saveCall.responseStatus).toBe('success');
  });

  it('defaults to chat apiType when not specified', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/v0/management/test',
      headers: { 'x-admin-key': 'test-admin-key' },
      payload: { provider: 'openai', model: 'gpt-4' },
    });

    const body = res.json();
    expect(body.apiType).toBe('chat');
  });

  it('records sourceIp in the started event', async () => {
    await fastify.inject({
      method: 'POST',
      url: '/v0/management/test',
      headers: { 'x-admin-key': 'test-admin-key' },
      payload: { provider: 'openai', model: 'gpt-4' },
    });

    // The usageRecord object is mutated in-place, so check the saved record
    const saveCall = (mockUsageStorage.saveRequest as any).mock.calls[0][0];
    expect(saveCall.sourceIp).toBeDefined();
  });

  it('records isStreamed as false in the usage record', async () => {
    await fastify.inject({
      method: 'POST',
      url: '/v0/management/test',
      headers: { 'x-admin-key': 'test-admin-key' },
      payload: { provider: 'openai', model: 'gpt-4' },
    });

    const saveCall = (mockUsageStorage.saveRequest as any).mock.calls[0][0];
    expect(saveCall.isStreamed).toBe(false);
  });

  it('calculateCosts is called for successful requests', async () => {
    (mockDispatcher.dispatch as any).mockImplementationOnce(async () => ({
      id: 'test-id',
      model: 'test-model',
      created: Date.now(),
      content: 'acknowledged',
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
        reasoning_tokens: 0,
        cached_tokens: 0,
        cache_creation_tokens: 0,
      },
      plexus: {
        provider: 'openai',
        model: 'gpt-4',
        apiType: 'chat',
        canonicalModel: 'gpt-4',
        attemptCount: 1,
        pricing: { source: 'simple', input: 0.03, output: 0.06 },
      },
    }));

    await fastify.inject({
      method: 'POST',
      url: '/v0/management/test',
      headers: { 'x-admin-key': 'test-admin-key' },
      payload: { provider: 'openai', model: 'gpt-4' },
    });

    const saveCall = (mockUsageStorage.saveRequest as any).mock.calls[0][0];
    expect(saveCall.costTotal).toBeDefined();
    expect(saveCall.costTotal).toBeGreaterThan(0);
  });
});
