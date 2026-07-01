import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as piAi from '@earendil-works/pi-ai/compat';
import { setConfigForTesting } from '../../../config';
import { DebugManager } from '../../../services/debug-manager';
import { enterRequestContext } from '../../../services/request-context';
import { runPiAiExecutor } from '../pi-ai-executor';
import type { UsageStorageService } from '../../../services/usage-storage';

function createUsageStorage(): UsageStorageService {
  return {
    saveRequest: vi.fn(async () => undefined),
    saveError: vi.fn(async () => undefined),
    saveDebugLog: vi.fn(async () => undefined),
    updatePerformanceMetrics: vi.fn(async () => undefined),
    emitStartedAsync: vi.fn(),
    emitUpdatedAsync: vi.fn(),
  } as unknown as UsageStorageService;
}

async function* errorStream() {
  yield {
    type: 'error',
    error: {
      errorMessage:
        'OpenAI API error (400): 400 One of "input" or "previous_response_id" or \'prompt\' or \'conversation_id\' must be provided.',
    },
  } as any;
}

async function* successStream() {
  const partial = {
    role: 'assistant',
    content: [{ type: 'text', text: 'hello' }],
    api: 'google-generative-ai',
    provider: 'google',
    model: 'gemini-3.5-flash',
    usage: { input: 2, output: 1, cacheRead: 0, cacheWrite: 0 },
    stopReason: 'stop',
    timestamp: Date.now(),
  };
  yield { type: 'text_delta', delta: 'hello', partial } as any;
  yield { type: 'done', message: partial, reason: 'stop' } as any;
}

describe('runPiAiExecutor streaming errors', () => {
  beforeEach(() => {
    DebugManager.getInstance().resetForTesting();
    setConfigForTesting({
      providers: {
        'openai-s': {
          api_base_url: 'https://api.openai.com/v1',
          api_key: 'sk-test',
          pi_ai_provider: 'openai-codex',
          models: {
            'gpt-5.4': {
              pricing: { source: 'simple', input: 0, output: 0 },
              pi_ai_model_id: 'gpt-5.4',
            },
          },
        },
      },
      models: {
        'gpt-5.4': {
          priority: 'selector',
          targets: [{ provider: 'openai-s', model: 'gpt-5.4' }],
        },
      },
      keys: {},
      failover: { enabled: false, retryableStatusCodes: [], retryableErrors: [] },
      quotas: [],
    } as any);
  });

  it('saves terminal usage and error records for streamed error events', async () => {
    vi.mocked(piAi.stream).mockResolvedValue(errorStream() as any);
    const usageStorage = createUsageStorage();
    DebugManager.getInstance().setStorage(usageStorage);
    DebugManager.getInstance().enableForKey('beta-key');
    enterRequestContext({ keyName: 'beta-key' });

    const result = await runPiAiExecutor({
      requestId: 'req-stream-error',
      incomingApiType: 'responses',
      modelAlias: 'gpt-5.4',
      context: { messages: [] } as any,
      generationIntent: { reasoning: { source: 'client' } } as any,
      streaming: true,
      request: {
        body: {},
        keyName: 'beta-key',
        attribution: 'opencode',
        ip: '127.0.0.1',
      } as any,
      usageStorage,
      serializeMessage: (msg) => msg as any,
      serializeChunks: () => ['event: response.completed\ndata: {}\n\n'],
    });

    const frames: string[] = [];
    for await (const frame of result.stream!) {
      frames.push(frame);
    }

    expect(frames).toHaveLength(1);
    expect(usageStorage.saveRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-stream-error',
        apiKey: 'beta-key',
        incomingApiType: 'responses',
        incomingModelAlias: 'gpt-5.4',
        provider: 'openai-s',
        responseStatus: 'error',
        finishReason: 'error',
      })
    );
    expect(usageStorage.saveError).toHaveBeenCalledWith(
      'req-stream-error',
      expect.any(Error),
      expect.objectContaining({
        apiType: 'responses',
        provider: 'openai-s',
        targetModel: 'gpt-5.4',
      })
    );
    expect(usageStorage.saveDebugLog).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req-stream-error' })
    );
  });

  it('saves serialized stream frames as the transformed response snapshot', async () => {
    vi.mocked(piAi.stream).mockResolvedValue(successStream() as any);
    const usageStorage = createUsageStorage();
    DebugManager.getInstance().setStorage(usageStorage);
    DebugManager.getInstance().enableForKey('beta-key');
    enterRequestContext({ keyName: 'beta-key' });

    const result = await runPiAiExecutor({
      requestId: 'req-stream-success',
      incomingApiType: 'gemini',
      modelAlias: 'gpt-5.4',
      context: { messages: [] } as any,
      generationIntent: { reasoning: { source: 'client' } } as any,
      streaming: true,
      request: {
        body: {},
        keyName: 'beta-key',
        attribution: 'opencode',
        ip: '127.0.0.1',
      } as any,
      usageStorage,
      serializeMessage: (msg) => msg as any,
      serializeChunks: (event) => {
        if (event.type === 'text_delta') {
          return [
            `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: event.delta }] } }] })}\n\n`,
          ];
        }
        if (event.type === 'done') {
          return [`data: ${JSON.stringify({ candidates: [{ finishReason: 'STOP' }] })}\n\n`];
        }
        return [];
      },
    });

    const frames: string[] = [];
    for await (const frame of result.stream!) {
      frames.push(frame);
    }

    const expectedSnapshot = frames.join('');
    expect(expectedSnapshot).toMatch(/^data: /);
    expect(expectedSnapshot).toMatch(/\n\n$/);
    expect(expectedSnapshot).toContain('"candidates"');
    expect(expectedSnapshot).not.toContain('"role":"assistant"');
    expect(usageStorage.saveDebugLog).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-stream-success',
        transformedResponse: expectedSnapshot,
        transformedResponseSnapshot: expectedSnapshot,
      })
    );
  });
});

describe('runPiAiExecutor vision fallthrough', () => {
  beforeEach(() => {
    DebugManager.getInstance().resetForTesting();
    setConfigForTesting({
      providers: {
        'text-only': {
          api_base_url: 'https://api.openai.com/v1',
          api_key: 'sk-test',
          pi_ai_provider: 'openai-codex',
          models: {
            'text-model': {
              pricing: { source: 'simple', input: 0, output: 0 },
              pi_ai_model_id: 'text-model',
            },
          },
        },
        descriptor: {
          api_base_url: 'https://api.openai.com/v1',
          api_key: 'sk-test',
          pi_ai_provider: 'openai-codex',
          models: {
            'gpt-4o': {
              pricing: { source: 'simple', input: 0, output: 0 },
              pi_ai_model_id: 'gpt-4o',
            },
          },
        },
      },
      models: {
        'text-model': {
          priority: 'selector',
          use_image_fallthrough: true,
          targets: [{ provider: 'text-only', model: 'text-model' }],
        },
        'gpt-4o': {
          priority: 'selector',
          targets: [{ provider: 'descriptor', model: 'gpt-4o' }],
        },
      },
      vision_fallthrough: { descriptor_model: 'gpt-4o' },
      keys: {},
      failover: { enabled: false, retryableStatusCodes: [], retryableErrors: [] },
      quotas: [],
    } as any);
  });

  it('describes images before dispatching to an alias with use_image_fallthrough', async () => {
    vi.mocked(piAi.complete)
      .mockResolvedValueOnce({
        role: 'assistant',
        content: [{ type: 'text', text: 'A blue circle.' }],
        api: 'openai-codex-responses',
        provider: 'openai-codex',
        model: 'gpt-4o',
        usage: { input: 20, output: 8, cacheRead: 0, cacheWrite: 0 },
        stopReason: 'stop',
        timestamp: Date.now(),
      } as any)
      .mockResolvedValueOnce({
        role: 'assistant',
        content: [{ type: 'text', text: 'That is a blue circle.' }],
        api: 'openai-codex-responses',
        provider: 'openai-codex',
        model: 'text-model',
        usage: { input: 15, output: 6, cacheRead: 0, cacheWrite: 0 },
        stopReason: 'stop',
        timestamp: Date.now(),
      } as any);

    const usageStorage = createUsageStorage();
    DebugManager.getInstance().setStorage(usageStorage);

    const context = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is this?' },
            {
              type: 'image',
              mimeType: 'image/png',
              data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
            },
          ],
          timestamp: Date.now(),
        },
      ],
    };

    const result = await runPiAiExecutor({
      requestId: 'req-vision-fallthrough',
      incomingApiType: 'chat',
      modelAlias: 'text-model',
      context: context as any,
      generationIntent: { reasoning: { source: 'client' } } as any,
      streaming: false,
      request: {
        body: {},
        keyName: 'beta-key',
        attribution: 'opencode',
        ip: '127.0.0.1',
      } as any,
      usageStorage,
      serializeMessage: (msg) => msg as any,
      serializeChunks: () => [],
    });

    // First call describes the image (descriptor model), second call is the
    // actual text-only target dispatch — never receiving image content.
    expect(vi.mocked(piAi.complete)).toHaveBeenCalledTimes(2);
    const [, targetContext] = vi.mocked(piAi.complete).mock.calls[1]!;
    const targetMessage = (targetContext as any).messages[0];
    expect(targetMessage.content).toEqual([
      { type: 'text', text: 'What is this?' },
      { type: 'text', text: '[Image Description: A blue circle.]' },
    ]);

    expect(result.response).toEqual(
      expect.objectContaining({ content: [{ type: 'text', text: 'That is a blue circle.' }] })
    );

    // Target dispatch usage record reflects the fallthrough having occurred.
    expect(usageStorage.saveRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-vision-fallthrough',
        provider: 'text-only',
        isVisionFallthrough: true,
        visionFallthroughModel: 'gpt-4o',
      })
    );
    // Descriptor sub-call gets its own usage record.
    expect(usageStorage.saveRequest).toHaveBeenCalledWith(
      expect.objectContaining({ isDescriptorRequest: true, isVisionFallthrough: false })
    );
  });

  it('does not trigger fallthrough for aliases without use_image_fallthrough', async () => {
    setConfigForTesting({
      providers: {
        'text-only': {
          api_base_url: 'https://api.openai.com/v1',
          api_key: 'sk-test',
          pi_ai_provider: 'openai-codex',
          models: {
            'text-model': {
              pricing: { source: 'simple', input: 0, output: 0 },
              pi_ai_model_id: 'text-model',
            },
          },
        },
      },
      models: {
        'text-model': {
          priority: 'selector',
          targets: [{ provider: 'text-only', model: 'text-model' }],
        },
      },
      keys: {},
      failover: { enabled: false, retryableStatusCodes: [], retryableErrors: [] },
      quotas: [],
    } as any);

    vi.mocked(piAi.complete).mockResolvedValueOnce({
      role: 'assistant',
      content: [{ type: 'text', text: 'response' }],
      api: 'openai-codex-responses',
      provider: 'openai-codex',
      model: 'text-model',
      usage: { input: 15, output: 6, cacheRead: 0, cacheWrite: 0 },
      stopReason: 'stop',
      timestamp: Date.now(),
    } as any);

    const usageStorage = createUsageStorage();
    DebugManager.getInstance().setStorage(usageStorage);

    const context = {
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              mimeType: 'image/png',
              data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
            },
          ],
          timestamp: Date.now(),
        },
      ],
    };

    await runPiAiExecutor({
      requestId: 'req-no-fallthrough',
      incomingApiType: 'chat',
      modelAlias: 'text-model',
      context: context as any,
      generationIntent: { reasoning: { source: 'client' } } as any,
      streaming: false,
      request: { body: {}, keyName: 'beta-key', attribution: 'opencode', ip: '127.0.0.1' } as any,
      usageStorage,
      serializeMessage: (msg) => msg as any,
      serializeChunks: () => [],
    });

    // Only one call — the target dispatch — image content was forwarded verbatim.
    expect(vi.mocked(piAi.complete)).toHaveBeenCalledTimes(1);
    const [, sentContext] = vi.mocked(piAi.complete).mock.calls[0]!;
    expect((sentContext as any).messages[0].content[0].type).toBe('image');
  });
});
