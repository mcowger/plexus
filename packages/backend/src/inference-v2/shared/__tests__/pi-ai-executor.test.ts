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
