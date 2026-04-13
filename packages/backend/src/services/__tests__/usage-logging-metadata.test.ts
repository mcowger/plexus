import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { registerSpy } from '../../../test/test-utils';
import { PassThrough } from 'stream';
import { UsageInspector } from '../inspectors/usage-logging';
import { DebugManager } from '../debug-manager';
import type { UsageRecord } from '../../types/usage';
import { DEFAULT_GPU_PARAMS, DEFAULT_MODEL } from '@plexus/shared';

describe('UsageInspector Metadata Robustness', () => {
  let mockStorage: any;
  let mockPricing: any;

  beforeEach(() => {
    mockStorage = {
      saveRequest: mock(() => Promise.resolve()),
      updatePerformanceMetrics: mock(() => Promise.resolve()),
    };
    mockPricing = {
      inputCostPerToken: 0,
      outputCostPerToken: 0,
    };
    const dm = DebugManager.getInstance();
    dm.setEnabled(true);
  });

  afterEach(() => {
    const dm = DebugManager.getInstance();
    dm.setEnabled(false);
  });

  const runInspector = async (
    requestId: string,
    apiType: string,
    snapshot: any
  ): Promise<UsageRecord | null> => {
    const inspector = new UsageInspector(
      requestId,
      mockStorage,
      { requestId } as Partial<UsageRecord>,
      mockPricing,
      undefined,
      Date.now(),
      false,
      apiType,
      undefined,
      undefined,
      DEFAULT_GPU_PARAMS,
      DEFAULT_MODEL
    );

    const dm = DebugManager.getInstance();
    dm.startLog(requestId, {});
    dm.addReconstructedRawResponse(requestId, snapshot);

    let capturedRecord: UsageRecord | null = null;
    registerSpy(mockStorage, 'saveRequest').mockImplementation(async (record: UsageRecord) => {
      capturedRecord = record;
      return Promise.resolve();
    });

    const mockStream = new PassThrough();
    mockStream.pipe(inspector);
    mockStream.end();

    await new Promise((resolve) => setTimeout(resolve, 50));
    return capturedRecord;
  };

  it('should extract tool call count from OpenAI non-streaming choices[0].message.tool_calls', async () => {
    const requestId = 'openai-nonstream-tools';
    const snapshot = {
      choices: [
        { message: { content: '...', tool_calls: [{}, {}, {}] }, finish_reason: 'tool_calls' },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    };

    const record = await runInspector(requestId, 'chat', snapshot);
    expect(record?.toolCallsCount).toBe(3);
    expect(record?.finishReason).toBe('tool_calls');
  });

  it('should extract tool call count from Gemini-in-OpenAI mixed format', async () => {
    const requestId = 'gemini-mixed-format';
    // This snapshot looks like chat (apiType='chat') but contains gemini 'candidates'
    const snapshot = {
      candidates: [
        {
          content: { parts: [{ text: 'thinking' }, { functionCall: { name: 'f1' } }] },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
    };

    const record = await runInspector(requestId, 'chat', snapshot);
    expect(record?.toolCallsCount).toBe(1);
    expect(record?.finishReason).toBe('tool_calls');
  });

  it('should normalize Gemini "STOP" finish reason to "tool_calls" when tools are present', async () => {
    const requestId = 'gemini-stop-with-tools';
    const snapshot = {
      candidates: [
        {
          content: { parts: [{ text: 'thinking' }, { functionCall: { name: 'f1' } }] },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
    };

    const record = await runInspector(requestId, 'gemini', snapshot);
    expect(record?.toolCallsCount).toBe(1);
    expect(record?.finishReason).toBe('tool_calls');
  });

  it('should normalize Gemini "STOP" to "tool_use" when incoming API is Anthropic messages', async () => {
    const requestId = 'gemini-to-anthropic-tools';
    const snapshot = {
      candidates: [
        {
          content: { parts: [{ text: 'thinking' }, { functionCall: { name: 'f1' } }] },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
    };

    // runInspector(requestId, apiType, snapshot)
    // apiType here is the provider API type ('gemini')
    // We need to simulate the inspector being initialized with incomingApiType='messages'
    const inspector = new UsageInspector(
      requestId,
      mockStorage,
      { requestId } as Partial<UsageRecord>,
      mockPricing,
      undefined,
      Date.now(),
      false,
      'gemini', // providerApiType
      'messages', // incomingApiType
      undefined, // originalRequest
      DEFAULT_GPU_PARAMS,
      DEFAULT_MODEL
    );

    const dm = DebugManager.getInstance();
    dm.startLog(requestId, {});
    dm.addReconstructedRawResponse(requestId, snapshot);

    let capturedRecord: any = null;
    registerSpy(mockStorage, 'saveRequest').mockImplementation(async (record: any) => {
      capturedRecord = record;
      return Promise.resolve();
    });

    const mockStream = new PassThrough();
    mockStream.pipe(inspector);
    mockStream.end();

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(capturedRecord?.toolCallsCount).toBe(1);
    expect(capturedRecord?.finishReason).toBe('tool_use');
  });

  it('should extract tool call count from Anthropic messages format', async () => {
    const requestId = 'anthropic-metadata';
    const snapshot = {
      content: [
        { type: 'text', text: 'using tool' },
        { type: 'tool_use', id: 't1' },
        { type: 'tool_use', id: 't2' },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 20 },
    };

    const record = await runInspector(requestId, 'messages', snapshot);
    expect(record?.toolCallsCount).toBe(2);
    expect(record?.finishReason).toBe('tool_use');
  });

  it('should handle generic fallback for unknown formats', async () => {
    const requestId = 'generic-fallback';
    const snapshot = {
      tool_calls: [{}, {}],
      finish_reason: 'something_else',
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    };

    const record = await runInspector(requestId, 'unknown-api', snapshot);
    expect(record?.toolCallsCount).toBe(2);
    expect(record?.finishReason).toBe('something_else');
  });
});
