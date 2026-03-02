import { describe, expect, test, beforeEach } from 'bun:test';
import { DebugLoggingInspector } from '../inspectors/debug-logging';
import { DebugManager } from '../debug-manager';

describe('DebugLoggingInspector Reconstruction', () => {
  const requestId = 'test-reconstruction-id';

  beforeEach(() => {
    const dm = DebugManager.getInstance();
    dm.setEnabled(true);
    // @ts-ignore - access private for testing
    dm.pendingLogs.clear();
  });

  test('reconstructChatCompletions handles non-streaming JSON', async () => {
    const inspector = new DebugLoggingInspector(requestId, 'raw');
    const stream = inspector.createInspector('chat');

    const jsonResponse = {
      id: 'chatcmpl-123',
      object: 'chat.completion',
      choices: [{ message: { content: 'hello', tool_calls: [{}, {}] }, finish_reason: 'tool_calls' }],
    };

    stream.write(Buffer.from(JSON.stringify(jsonResponse)));
    stream.end();

    // Small delay for the 'finish' event to process
    await new Promise(resolve => setTimeout(resolve, 50));

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
      content: [{ type: 'text', text: 'hi' }, { type: 'tool_use', id: 't1' }],
      stop_reason: 'tool_use',
    };

    stream.write(Buffer.from(JSON.stringify(jsonResponse)));
    stream.end();

    await new Promise(resolve => setTimeout(resolve, 50));

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
        }
      ],
    };

    stream.write(Buffer.from(JSON.stringify(jsonResponse)));
    stream.end();

    await new Promise(resolve => setTimeout(resolve, 50));

    const dm = DebugManager.getInstance();
    const snapshot = dm.getReconstructedRawResponse(requestId);
    expect(snapshot).not.toBeNull();
    expect(snapshot.candidates[0].finishReason).toBe('STOP');
  });
});
