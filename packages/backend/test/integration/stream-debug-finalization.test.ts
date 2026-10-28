import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { finished } from 'node:stream/promises';

import { DebugLoggingInspector } from '../../src/services/inspectors/debug-logging';
import { UsageInspector } from '../../src/services/inspectors/usage-logging';
import { type DebugLogRecord, DebugManager } from '../../src/services/observability/debug-manager';
import { handleResponse } from '../../src/services/responses/response-handler';
import { ResponsesTransformer } from '../../src/transformers/responses';
import type { UnifiedChatResponse } from '../../src/types/unified';
import type { UsageRecord } from '../../src/types/usage';
import { waitFor } from '../test-utils';

const sse = (event: object) => `data: ${JSON.stringify(event)}\n\n`;

const cases = [
  {
    providerApiType: 'messages',
    body:
      sse({
        type: 'message_start',
        message: {
          id: 'msg_test',
          model: 'test-model',
          role: 'assistant',
          content: [],
          usage: { input_tokens: 50, output_tokens: 0 },
        },
      }) +
      sse({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
      sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } }) +
      sse({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 9 },
      }),
    snapshot: {
      id: 'msg_test',
      stop_reason: 'end_turn',
      usage: { input_tokens: 50, output_tokens: 9 },
    },
  },
  {
    providerApiType: 'gemini',
    body: sse({
      responseId: 'gemini_test',
      modelVersion: 'test-model',
      candidates: [{ content: { parts: [{ text: 'Hello' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 9, totalTokenCount: 59 },
    }),
    snapshot: {
      responseId: 'gemini_test',
      usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 9, totalTokenCount: 59 },
    },
  },
];

describe('stream trace finalization', () => {
  let flushedLogs: DebugLogRecord[];
  const dm = DebugManager.getInstance();

  beforeEach(() => {
    dm.resetForTesting();
    dm.setEnabled(true);
    flushedLogs = [];
    const flush = dm.flush.bind(dm);
    spyOn(dm, 'flush').mockImplementation((requestId) => {
      const log = dm.getPendingLog(requestId);
      if (log) flushedLogs.push({ ...log });
      flush(requestId);
    });
  });

  afterEach(() => {
    dm.resetForTesting();
  });

  for (const scenario of cases) {
    it(`persists ${scenario.providerApiType} raw capture before a Responses terminal flush`, async () => {
      const requestId = `early-terminal-${scenario.providerApiType}`;
      let providerController!: ReadableStreamDefaultController<Uint8Array>;
      const providerStream = new ReadableStream<Uint8Array>({
        start(controller) {
          providerController = controller;
          controller.enqueue(new TextEncoder().encode(scenario.body));
          // The client terminal is emitted from the finish reason before this
          // transport is closed, so the raw tap's end event has not fired.
        },
      });
      const response: UnifiedChatResponse = {
        id: 'test-response',
        model: 'test-model',
        content: null,
        stream: providerStream,
        plexus: {
          provider: 'test-provider',
          model: 'test-model',
          apiType: scenario.providerApiType,
        },
      };
      const saved: UsageRecord[] = [];
      const storage = {
        saveRequest: mock(async (record: UsageRecord) => {
          saved.push({ ...record });
        }),
        updatePerformanceMetrics: mock(async () => {}),
        saveError: mock(),
      };
      const reply = {
        header: mock(function (this: any) {
          return this;
        }),
        send: mock((stream: any) => stream),
        code: mock(function (this: any) {
          return this;
        }),
      };

      let pipeline: any;
      try {
        await handleResponse(
          { headers: {}, raw: {} } as any,
          reply as any,
          response,
          new ResponsesTransformer(),
          { requestId },
          storage as any,
          Date.now(),
          'responses'
        );
        pipeline = reply.send.mock.calls.at(-1)![0];
        pipeline.on('data', () => {});
        pipeline.on('error', () => {});
        await waitFor(() => expect(flushedLogs).toHaveLength(1));

        expect(flushedLogs[0]!.rawResponse).toBe(scenario.body);
        expect(flushedLogs[0]!.rawResponseSnapshot).toMatchObject(scenario.snapshot);
        expect(flushedLogs[0]!.transformedResponse).toContain('response.completed');
        expect(flushedLogs[0]!.transformedResponseSnapshot.status).toBe('completed');
        expect(saved).toHaveLength(1);
        expect(saved[0]).toMatchObject({
          responseStatus: 'success',
          tokensInput: 50,
          tokensOutput: 9,
        });
      } finally {
        pipeline?.destroy();
        providerController.close();
      }
    });
  }

  for (const { terminal, captureEnabled } of [
    { terminal: true, captureEnabled: true },
    { terminal: false, captureEnabled: false },
  ]) {
    it(
      terminal
        ? 'finalizes both taps before a chat terminal and does not flush again on teardown'
        : 'finalizes both taps on stream end even when payload capture is disabled',
      async () => {
        const requestId = `usage-finalize-${terminal}`;
        dm.setEnabled(captureEnabled);
        dm.startLog(requestId, {});
        const raw = new DebugLoggingInspector(requestId, 'raw');
        const rawTap = raw.createInspector('messages');
        let usage!: UsageInspector;
        const transformed = new DebugLoggingInspector(requestId, 'transformed', () =>
          usage.finalize()
        );
        const transformedTap = transformed.createInspector('chat');
        const saved: UsageRecord[] = [];
        const storage = {
          saveRequest: mock(async (record: UsageRecord) => {
            saved.push({ ...record });
          }),
          updatePerformanceMetrics: mock(async () => {}),
        };
        usage = new UsageInspector(
          requestId,
          storage as any,
          { requestId, responseStatus: 'success' },
          undefined,
          undefined,
          Date.now(),
          false,
          'messages',
          'chat',
          undefined,
          undefined,
          undefined,
          raw,
          transformed
        );
        usage.resume();
        const transformedBody = sse({
          id: 'chat_test',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 99, completion_tokens: 99 },
        });
        rawTap.write(cases[0]!.body);
        transformedTap.write(transformedBody + (terminal ? 'data: [DONE]\n\n' : ''));
        if (!terminal) usage.end();

        await waitFor(() => expect(flushedLogs).toHaveLength(1));
        expect(flushedLogs[0]!.rawResponseSnapshot).toMatchObject(cases[0]!.snapshot);
        expect(flushedLogs[0]!.transformedResponseSnapshot.usage.prompt_tokens).toBe(99);
        expect(flushedLogs[0]!.rawResponse).toBe(captureEnabled ? cases[0]!.body : undefined);
        expect(saved).toHaveLength(1);
        // Raw provider usage wins over the deliberately different client usage.
        expect(saved[0]).toMatchObject({ tokensInput: 50, tokensOutput: 9 });

        // The taps may end after the log was flushed. Their one-shot finalize
        // must not recreate a pending log or save the usage a second time.
        usage.destroy();
        rawTap.end();
        transformedTap.end();
        await Promise.all([finished(rawTap), finished(transformedTap)]);
        expect(flushedLogs).toHaveLength(1);
        expect(saved).toHaveLength(1);
        expect(dm.getPendingLog(requestId)).toBeUndefined();
      }
    );
  }
});
