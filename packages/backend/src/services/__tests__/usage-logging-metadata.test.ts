import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { registerSpy } from '../../../test/test-utils';
import { PassThrough } from 'stream';
import { UsageInspector } from '../inspectors/usage-logging';
import { DebugManager } from '../observability/debug-manager';
import type { UsageRecord } from '../../types/usage';
import { DEFAULT_GPU_PARAMS, DEFAULT_MODEL } from '@plexus/shared';

describe('UsageInspector Metadata Robustness', () => {
  let mockStorage: any;
  let mockPricing: any;

  beforeEach(() => {
    mockStorage = {
      saveRequest: vi.fn(() => Promise.resolve()),
      updatePerformanceMetrics: vi.fn(() => Promise.resolve()),
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

  describe('Responses API status → finishReason mapping', () => {
    // Mirrors the reconstructed snapshot shape produced by
    // DebugLoggingInspector.updateResponsesSnapshot for the same
    // response.created -> response.output_text.delta -> response.failed
    // stream exercised in debug-logging-reconstruction.test.ts.
    it('should map a failed Responses API stream to finishReason "error" with non-zero usage', async () => {
      const requestId = 'responses-failed-stream';
      const snapshot = {
        id: 'resp_test123',
        object: 'response',
        status: 'failed',
        model: 'gpt-4o',
        output: [
          {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Partial answer before it broke' }],
          },
        ],
        error: { code: 'server_error', message: 'The model response failed to complete.' },
        usage: {
          input_tokens: 42,
          output_tokens: 8,
          total_tokens: 50,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      };

      const record = await runInspector(requestId, 'responses', snapshot);
      expect(record?.finishReason).toBe('error');
      expect(record?.tokensInput).toBe(42);
      expect(record?.tokensOutput).toBe(8);
    });

    // Mirrors the reconstructed snapshot shape produced by
    // DebugLoggingInspector.updateResponsesSnapshot for the same
    // response.created -> response.output_text.delta -> response.incomplete
    // stream exercised in debug-logging-reconstruction.test.ts.
    it('should map an incomplete Responses API stream (max_output_tokens) to finishReason "length" with non-zero usage', async () => {
      const requestId = 'responses-incomplete-max-tokens-stream';
      const snapshot = {
        id: 'resp_test789',
        object: 'response',
        status: 'incomplete',
        model: 'gpt-4o',
        output: [
          {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Truncated answer that ran out of ' }],
          },
        ],
        incomplete_details: { reason: 'max_output_tokens' },
        usage: {
          input_tokens: 30,
          output_tokens: 16,
          total_tokens: 46,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      };

      const record = await runInspector(requestId, 'responses', snapshot);
      expect(record?.finishReason).toBe('length');
      expect(record?.tokensInput).toBe(30);
      expect(record?.tokensOutput).toBe(16);
    });

    it('should map an incomplete Responses API stream (content_filter) to finishReason "content_filter"', async () => {
      const requestId = 'responses-incomplete-content-filter-stream';
      const snapshot = {
        id: 'resp_test999',
        object: 'response',
        status: 'incomplete',
        model: 'gpt-4o',
        output: [
          {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Cut off by the content filter' }],
          },
        ],
        incomplete_details: { reason: 'content_filter' },
        usage: {
          input_tokens: 25,
          output_tokens: 4,
          total_tokens: 29,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      };

      const record = await runInspector(requestId, 'responses', snapshot);
      expect(record?.finishReason).toBe('content_filter');
      expect(record?.tokensInput).toBe(25);
      expect(record?.tokensOutput).toBe(4);
    });

    it('should default an incomplete Responses API stream with an unknown/absent reason to finishReason "length"', async () => {
      const requestId = 'responses-incomplete-unknown-reason-stream';
      const snapshot = {
        id: 'resp_test000',
        object: 'response',
        status: 'incomplete',
        model: 'gpt-4o',
        output: [],
        // No incomplete_details at all — must still default sensibly instead
        // of leaking 'incomplete' or throwing on the optional chain.
        usage: {
          input_tokens: 12,
          output_tokens: 1,
          total_tokens: 13,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      };

      const record = await runInspector(requestId, 'responses', snapshot);
      expect(record?.finishReason).toBe('length');
    });

    it('should still map a completed Responses API stream to finishReason "stop" (regression)', async () => {
      const requestId = 'responses-completed-stream';
      const snapshot = {
        id: 'resp_test456',
        object: 'response',
        status: 'completed',
        model: 'gpt-4o',
        output: [
          {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Full answer' }],
          },
        ],
        usage: {
          input_tokens: 42,
          output_tokens: 20,
          total_tokens: 62,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      };

      const record = await runInspector(requestId, 'responses', snapshot);
      expect(record?.finishReason).toBe('stop');
      expect(record?.tokensInput).toBe(42);
      expect(record?.tokensOutput).toBe(20);
    });
  });
});
