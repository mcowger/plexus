import { once } from 'node:events';
import { describe, expect, test, beforeEach } from 'vitest';
import { registerSpy } from '../../../test/test-utils';
import { DebugLoggingInspector } from '../inspectors/debug-logging';
import { DebugManager } from '../observability/debug-manager';
import { logger } from '../../utils/logger';

describe('DebugLoggingInspector Reconstruction', () => {
  const requestId = 'test-reconstruction-id';

  beforeEach(() => {
    const dm = DebugManager.getInstance();
    dm.resetForTesting();
    dm.setEnabled(true);
  });

  test('does not warn for non-inference responses', async () => {
    const warnSpy = registerSpy(logger, 'warn');
    warnSpy.mockClear();
    const stream = new DebugLoggingInspector(requestId, 'raw').createInspector('unknown');
    const ended = once(stream, 'end');

    stream.end(Buffer.from('{}'));
    await ended;

    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('warns for unsupported provider API types', async () => {
    const warnSpy = registerSpy(logger, 'warn');
    warnSpy.mockClear();
    const stream = new DebugLoggingInspector(requestId, 'raw').createInspector('unsupported');
    const ended = once(stream, 'end');

    stream.end(Buffer.from('{}'));
    await ended;

    expect(warnSpy).toHaveBeenCalledWith('Unknown providerApiType: unsupported');
  });

  test('reconstructChatCompletions handles non-streaming JSON', async () => {
    const inspector = new DebugLoggingInspector(requestId, 'raw');
    const stream = inspector.createInspector('chat');

    const jsonResponse = {
      id: 'chatcmpl-123',
      object: 'chat.completion',
      choices: [
        { message: { content: 'hello', tool_calls: [{}, {}] }, finish_reason: 'tool_calls' },
      ],
    };

    stream.write(Buffer.from(JSON.stringify(jsonResponse)));
    stream.end();

    // Small delay for the 'finish' event to process
    await new Promise((resolve) => setTimeout(resolve, 50));

    const dm = DebugManager.getInstance();
    const snapshot = dm.getReconstructedRawResponse(requestId);
    expect(snapshot).not.toBeNull();
    expect(snapshot.id).toBe('chatcmpl-123');
    expect(snapshot.choices[0].message.tool_calls).toHaveLength(2);
  });

  test('reconstructMessages handles non-streaming JSON (Anthropic style)', async () => {
    const inspector = new DebugLoggingInspector(requestId, 'raw');
    const stream = inspector.createInspector('messages');

    const jsonResponse = {
      id: 'msg_123',
      role: 'assistant',
      content: [
        { type: 'text', text: 'hi' },
        { type: 'tool_use', id: 't1' },
      ],
      stop_reason: 'tool_use',
    };

    stream.write(Buffer.from(JSON.stringify(jsonResponse)));
    stream.end();

    await new Promise((resolve) => setTimeout(resolve, 50));

    const dm = DebugManager.getInstance();
    const snapshot = dm.getReconstructedRawResponse(requestId);
    expect(snapshot).not.toBeNull();
    expect(snapshot.id).toBe('msg_123');
    expect(snapshot.stop_reason).toBe('tool_use');
  });

  test('reconstructGemini handles non-streaming JSON', async () => {
    const inspector = new DebugLoggingInspector(requestId, 'raw');
    const stream = inspector.createInspector('gemini');

    const jsonResponse = {
      candidates: [
        {
          content: { parts: [{ text: 'thinking' }, { functionCall: { name: 'fn' } }] },
          finishReason: 'STOP',
        },
      ],
    };

    stream.write(Buffer.from(JSON.stringify(jsonResponse)));
    stream.end();

    await new Promise((resolve) => setTimeout(resolve, 50));

    const dm = DebugManager.getInstance();
    const snapshot = dm.getReconstructedRawResponse(requestId);
    expect(snapshot).not.toBeNull();
    expect(snapshot.candidates[0].finishReason).toBe('STOP');
  });

  describe('reconstructResponses streaming (Responses API)', () => {
    const writeEvents = (stream: any, events: any[]) => {
      for (const event of events) {
        stream.write(Buffer.from(`data: ${JSON.stringify(event)}\n\n`));
      }
      stream.end();
    };

    test('response.failed captures status, error, and usage (mid-stream failure)', async () => {
      const failedRequestId = 'test-responses-failed';
      const inspector = new DebugLoggingInspector(failedRequestId, 'raw');
      const stream = inspector.createInspector('responses');

      writeEvents(stream, [
        {
          type: 'response.created',
          response: {
            id: 'resp_test123',
            object: 'response',
            created_at: 1700000000,
            status: 'in_progress',
            model: 'gpt-4o',
            output: [],
          },
        },
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '' }],
          },
        },
        {
          type: 'response.output_text.delta',
          output_index: 0,
          content_index: 0,
          delta: 'Partial answer before it broke',
        },
        {
          type: 'response.failed',
          response: {
            id: 'resp_test123',
            object: 'response',
            created_at: 1700000000,
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
          },
        },
      ]);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const dm = DebugManager.getInstance();
      const snapshot = dm.getReconstructedRawResponse(failedRequestId);
      expect(snapshot).not.toBeNull();
      expect(snapshot.status).toBe('failed');
      expect(snapshot.error).toEqual({
        code: 'server_error',
        message: 'The model response failed to complete.',
      });
      expect(snapshot.usage).toEqual({
        input_tokens: 42,
        output_tokens: 8,
        total_tokens: 50,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      });
    });

    test('response.failed with NO usage captures status and error, and absent usage stays absent', async () => {
      const failedNoUsageRequestId = 'test-responses-failed-no-usage';
      const inspector = new DebugLoggingInspector(failedNoUsageRequestId, 'raw');
      const stream = inspector.createInspector('responses');

      writeEvents(stream, [
        {
          type: 'response.created',
          response: {
            id: 'resp_nousage_1',
            object: 'response',
            created_at: 1700000000,
            status: 'in_progress',
            model: 'gpt-4o',
            output: [],
          },
        },
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '' }],
          },
        },
        {
          type: 'response.output_text.delta',
          output_index: 0,
          content_index: 0,
          delta: 'Partial answer before it broke',
        },
        {
          type: 'response.failed',
          response: {
            id: 'resp_nousage_1',
            object: 'response',
            created_at: 1700000000,
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
            // No usage at all — the upstream failed before reporting any.
          },
        },
      ]);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const dm = DebugManager.getInstance();
      const snapshot = dm.getReconstructedRawResponse(failedNoUsageRequestId);
      expect(snapshot).not.toBeNull();
      expect(snapshot.status).toBe('failed');
      expect(snapshot.error).toEqual({
        code: 'server_error',
        message: 'The model response failed to complete.',
      });
      // Usage was never reported anywhere in the stream: it must stay
      // ABSENT on the snapshot (no phantom `usage` own property either),
      // locking in the optional-usage contract downstream consumers
      // (usage-logging) rely on.
      expect(snapshot.usage).toBeUndefined();
      expect(snapshot).not.toHaveProperty('usage');
    });

    test('response.incomplete captures status, incomplete_details, and usage (max_output_tokens truncation)', async () => {
      const incompleteRequestId = 'test-responses-incomplete';
      const inspector = new DebugLoggingInspector(incompleteRequestId, 'raw');
      const stream = inspector.createInspector('responses');

      writeEvents(stream, [
        {
          type: 'response.created',
          response: {
            id: 'resp_test789',
            object: 'response',
            created_at: 1700000000,
            status: 'in_progress',
            model: 'gpt-4o',
            output: [],
          },
        },
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '' }],
          },
        },
        {
          type: 'response.output_text.delta',
          output_index: 0,
          content_index: 0,
          delta: 'Truncated answer that ran out of ',
        },
        {
          type: 'response.incomplete',
          response: {
            id: 'resp_test789',
            object: 'response',
            created_at: 1700000000,
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
          },
        },
      ]);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const dm = DebugManager.getInstance();
      const snapshot = dm.getReconstructedRawResponse(incompleteRequestId);
      expect(snapshot).not.toBeNull();
      expect(snapshot.status).toBe('incomplete');
      expect(snapshot.incomplete_details).toEqual({ reason: 'max_output_tokens' });
      expect(snapshot.usage).toEqual({
        input_tokens: 30,
        output_tokens: 16,
        total_tokens: 46,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      });
    });

    test('response.completed still captures status and usage (regression)', async () => {
      const completedRequestId = 'test-responses-completed';
      const inspector = new DebugLoggingInspector(completedRequestId, 'raw');
      const stream = inspector.createInspector('responses');

      writeEvents(stream, [
        {
          type: 'response.created',
          response: {
            id: 'resp_test456',
            object: 'response',
            created_at: 1700000000,
            status: 'in_progress',
            model: 'gpt-4o',
            output: [],
          },
        },
        {
          type: 'response.completed',
          response: {
            id: 'resp_test456',
            object: 'response',
            created_at: 1700000000,
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
          },
        },
      ]);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const dm = DebugManager.getInstance();
      const snapshot = dm.getReconstructedRawResponse(completedRequestId);
      expect(snapshot).not.toBeNull();
      expect(snapshot.status).toBe('completed');
      expect(snapshot.error).toBeUndefined();
      expect(snapshot.usage).toEqual({
        input_tokens: 42,
        output_tokens: 20,
        total_tokens: 62,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      });
    });
  });
});
