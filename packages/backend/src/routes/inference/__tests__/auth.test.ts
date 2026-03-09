import { describe, it, expect, beforeAll } from 'bun:test';
import Fastify, { FastifyInstance } from 'fastify';
import { createTestConfig } from '../../../../test/test-utils';
import { setConfigForTesting } from '../../../config';
import { registerInferenceRoutes } from '../index';
import { Dispatcher } from '../../../services/dispatcher';
import { UsageStorageService } from '../../../services/usage-storage';
import { mock } from 'bun:test';
import { DebugManager } from '../../../services/debug-manager';
import { SelectorFactory } from '../../../services/selectors/factory';

describe('Auth Middleware', () => {
  let fastify: FastifyInstance;
  let mockUsageStorage: UsageStorageService;

  beforeAll(async () => {
    fastify = Fastify();

    // Mock dependencies
    const mockDispatcher = {
      dispatch: mock(async () => ({
        id: '123',
        model: 'gpt-4',
        created: 123,
        content: 'test content',
        usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
      })),
    } as unknown as Dispatcher;

    mockUsageStorage = {
      saveRequest: mock(),
      saveError: mock(),
      updatePerformanceMetrics: mock(),
      emitStartedAsync: mock(),
      emitUpdatedAsync: mock(),
    } as unknown as UsageStorageService;
    // Initialize singletons to avoid errors
    DebugManager.getInstance().setStorage(mockUsageStorage);
    SelectorFactory.setUsageStorage(mockUsageStorage);

    // Set config
    setConfigForTesting(createTestConfig());

    await registerInferenceRoutes(fastify, mockDispatcher, mockUsageStorage);
    await fastify.ready();
  });

  it('should allow request with valid Bearer token', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: 'Bearer sk-valid-key',
        'content-type': 'application/json',
      },
      payload: {
        model: 'gpt-4',
        messages: [],
      },
    });
    if (response.statusCode !== 200)
      console.error('[AUTH TEST] valid bearer got', response.statusCode, response.body);
    expect(response.statusCode).toBe(200);

    const saveRequestCalls = (mockUsageStorage.saveRequest as any).mock.calls;
    const lastCall = saveRequestCalls[saveRequestCalls.length - 1];
    expect(lastCall[0].apiKey).toBe('test-key-1');
  });

  it('should allow request with x-api-key header', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: {
        'x-api-key': 'sk-valid-key',
        'content-type': 'application/json',
      },
      payload: {
        model: 'gpt-4',
        messages: [],
      },
    });
    if (response.statusCode !== 200)
      console.error('[AUTH TEST] x-api-key got', response.statusCode, response.body);
    expect(response.statusCode).toBe(200);
  });

  it('should allow request with x-goog-api-key header', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        'x-goog-api-key': 'sk-valid-key',
        'content-type': 'application/json',
      },
      payload: {
        model: 'gpt-4',
        messages: [],
      },
    });
    if (response.statusCode !== 200)
      console.error('[AUTH TEST] x-goog-api-key got', response.statusCode, response.body);
    expect(response.statusCode).toBe(200);
  });

  it('should allow Gemini request with key query parameter', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1beta/models/gpt-4:generateContent',
      query: {
        key: 'sk-valid-key',
      },
      headers: {
        'content-type': 'application/json',
      },
      payload: {
        contents: [],
      },
    });
    if (response.statusCode !== 200)
      console.error('[AUTH TEST] gemini key query got', response.statusCode, response.body);
    expect(response.statusCode).toBe(200);
  });

  it('should reject Gemini request with missing key', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1beta/models/gpt-4:generateContent',
      headers: {
        'content-type': 'application/json',
      },
      payload: {
        contents: [],
      },
    });
    expect(response.statusCode).toBe(401);
  });

  it('should reject request with invalid key', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: 'Bearer invalid-key',
        'content-type': 'application/json',
      },
      payload: {
        model: 'gpt-4',
        messages: [],
      },
    });
    expect(response.statusCode).toBe(401);
  });

  it('should reject request with missing key', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        'content-type': 'application/json',
      },
      payload: {
        model: 'gpt-4',
        messages: [],
      },
    });
    expect(response.statusCode).toBe(401);
  });

  it('should allow public access to /v1/models', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/v1/models',
    });
    expect(response.statusCode).toBe(200);
  });
});

describe('Key Attribution', () => {
  let fastify: FastifyInstance;
  let mockUsageStorage: UsageStorageService;

  beforeAll(async () => {
    fastify = Fastify();
    const mockDispatcher = {
      dispatch: mock(async () => ({
        id: '123',
        model: 'gpt-4',
        created: 123,
        content: 'test',
        usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
      })),
    } as unknown as Dispatcher;
    mockUsageStorage = {
      saveRequest: mock(),
      saveError: mock(),
      updatePerformanceMetrics: mock(),
      emitStartedAsync: mock(),
      emitUpdatedAsync: mock(),
    } as unknown as UsageStorageService;
    DebugManager.getInstance().setStorage(mockUsageStorage);
    SelectorFactory.setUsageStorage(mockUsageStorage);
    setConfigForTesting(createTestConfig());
    await registerInferenceRoutes(fastify, mockDispatcher, mockUsageStorage);
    await fastify.ready();
  });

  it('should parse key with attribution and track it', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer sk-valid-key:copilot', 'content-type': 'application/json' },
      payload: { model: 'gpt-4', messages: [] },
    });
    if (response.statusCode !== 200)
      console.error('[ATTR TEST] attribution parse got', response.statusCode, response.body);
    expect(response.statusCode).toBe(200);
    expect((mockUsageStorage.saveRequest as any).mock.calls[0][0].apiKey).toBe('test-key-1');
    expect((mockUsageStorage.saveRequest as any).mock.calls[0][0].attribution).toBe('copilot');
  });

  it('should normalize attribution to lowercase', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer sk-valid-key:CoPilot', 'content-type': 'application/json' },
      payload: { model: 'gpt-4', messages: [] },
    });
    if (response.statusCode !== 200)
      console.error('[ATTR TEST] attribution lowercase got', response.statusCode, response.body);
    expect(response.statusCode).toBe(200);
    expect((mockUsageStorage.saveRequest as any).mock.calls[1][0].attribution).toBe('copilot');
  });

  it('should support attribution with multiple colons', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: 'Bearer sk-valid-key:copilot:dev:v1',
        'content-type': 'application/json',
      },
      payload: { model: 'gpt-4', messages: [] },
    });
    if (response.statusCode !== 200)
      console.error('[ATTR TEST] multi-colon got', response.statusCode, response.body);
    expect(response.statusCode).toBe(200);
    expect((mockUsageStorage.saveRequest as any).mock.calls[2][0].attribution).toBe(
      'copilot:dev:v1'
    );
  });

  it('should set attribution to null when not provided', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer sk-valid-key', 'content-type': 'application/json' },
      payload: { model: 'gpt-4', messages: [] },
    });
    if (response.statusCode !== 200)
      console.error('[ATTR TEST] no attribution got', response.statusCode, response.body);
    expect(response.statusCode).toBe(200);
    expect((mockUsageStorage.saveRequest as any).mock.calls[3][0].attribution).toBe(null);
  });

  it('should authenticate different attributions with same secret', async () => {
    await fastify.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer sk-valid-key:copilot', 'content-type': 'application/json' },
      payload: { model: 'gpt-4', messages: [] },
    });
    await fastify.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer sk-valid-key:claude', 'content-type': 'application/json' },
      payload: { model: 'gpt-4', messages: [] },
    });
    const calls = (mockUsageStorage.saveRequest as any).mock.calls;
    expect(calls[4][0].attribution).toBe('copilot');
    expect(calls[5][0].attribution).toBe('claude');
  });

  it('should reject invalid secret even with attribution', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer invalid-key:copilot', 'content-type': 'application/json' },
      payload: { model: 'gpt-4', messages: [] },
    });
    expect(response.statusCode).toBe(401);
  });
});
