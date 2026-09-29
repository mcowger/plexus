import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { setConfigForTesting } from '../../../config';
import { registerInferenceRoutes } from '../index';
import { Dispatcher } from '../../../services/dispatch/dispatcher';
import { UsageStorageService } from '../../../services/observability/usage-storage';
import { DebugManager } from '../../../services/observability/debug-manager';
import { SelectorFactory } from '../../../services/routing/selectors/factory';
import {
  AnthropicTransformer,
  GeminiTransformer,
  OpenAICompletionTransformer,
  OpenAITransformer,
  ResponsesTransformer,
} from '../../../transformers';
import { registerSpy } from '../../../../test/test-utils';

// Parse failures used to happen before DebugManager.startLog, so enabling
// debug capture never recorded the payload that actually broke parsing.
const CASES = [
  {
    name: 'responses',
    transformer: ResponsesTransformer,
    url: '/v1/responses',
    payload: { model: 'test-model', input: [{ type: 'message', role: 'user', content: [null] }] },
  },
  {
    name: 'chat',
    transformer: OpenAITransformer,
    url: '/v1/chat/completions',
    payload: { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] },
  },
  {
    name: 'messages',
    transformer: AnthropicTransformer,
    url: '/v1/messages',
    payload: { model: 'test-model', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] },
  },
  {
    name: 'completions',
    transformer: OpenAICompletionTransformer,
    url: '/v1/completions',
    payload: { model: 'test-model', prompt: 'hi' },
  },
  {
    name: 'gemini',
    transformer: GeminiTransformer,
    url: '/v1beta/models/test-model:generateContent',
    payload: { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] },
  },
] as const;

describe('Debug capture when request parsing fails', () => {
  let fastify: FastifyInstance;
  let savedDebugLogs: any[];
  let wasDebugEnabled: boolean;

  beforeEach(async () => {
    setConfigForTesting({
      providers: {},
      models: {},
      keys: { 'test-key-1': { secret: 'sk-valid-key', comment: 'Test Key' } },
      failover: {
        enabled: false,
        retryableStatusCodes: [429, 500, 502, 503, 504],
        retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT'],
      },
      quotas: [],
    } as any);

    savedDebugLogs = [];
    const usageStorage = {
      saveRequest: vi.fn(),
      saveError: vi.fn(),
      updatePerformanceMetrics: vi.fn(),
      emitStartedAsync: vi.fn(),
      emitUpdatedAsync: vi.fn(),
      saveDebugLog: vi.fn((log: any) => savedDebugLogs.push(log)),
    } as unknown as UsageStorageService;

    const debugManager = DebugManager.getInstance();
    wasDebugEnabled = debugManager.isEnabled();
    debugManager.setStorage(usageStorage);
    debugManager.setEnabled(true);
    SelectorFactory.setUsageStorage(usageStorage);

    fastify = Fastify();
    await registerInferenceRoutes(fastify, {} as Dispatcher, usageStorage);
    await fastify.ready();
  });

  afterEach(async () => {
    DebugManager.getInstance().setEnabled(wasDebugEnabled);
    await fastify.close();
  });

  it.each(CASES)('$name persists the raw request trace', async ({ transformer, url, payload }) => {
    registerSpy(transformer.prototype, 'parseRequest').mockRejectedValue(
      new Error('boom while parsing')
    );

    const response = await fastify.inject({
      method: 'POST',
      url,
      headers: { authorization: 'Bearer sk-valid-key', 'content-type': 'application/json' },
      payload,
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(savedDebugLogs).toHaveLength(1);
    expect(savedDebugLogs[0].rawRequest).toMatchObject(payload);
  });
});
