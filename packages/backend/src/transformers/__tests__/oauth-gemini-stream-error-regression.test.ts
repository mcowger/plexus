import { describe, expect, test } from 'vitest';
import { piAiEventToChunk } from '../oauth/type-mappers';
import { formatGeminiStream } from '../gemini/stream-formatter';

function createUnifiedChunkStream(chunks: any[]): ReadableStream<any> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

async function readUtf8(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value);
  }

  return output;
}

describe('OAuth -> Gemini stream error regression', () => {
  test('piAiEventToChunk maps oauth error message into chunk content', () => {
    const chunk = piAiEventToChunk(
      {
        type: 'error',
        reason: 'error',
        error: {
          message: 'upstream quota exceeded',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        },
      } as any,
      'gemini-3-flash-preview',
      'github-copilot'
    );

    expect(chunk).toBeDefined();
    expect(chunk?.finish_reason).toBe('error');
    expect(chunk?.delta?.content).toBe('upstream quota exceeded');
  });

  test('formatGeminiStream does not throw when tool call args are partial JSON', async () => {
    const stream = createUnifiedChunkStream([
      {
        id: 'oauth-1',
        model: 'gemini-3-flash-preview',
        created: Math.floor(Date.now() / 1000),
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call_1',
              type: 'function',
              function: {
                name: 'manage_todo_list',
                arguments: '{"items":[',
              },
            },
          ],
        },
        finish_reason: null,
      },
      {
        id: 'oauth-1',
        model: 'gemini-3-flash-preview',
        created: Math.floor(Date.now() / 1000),
        delta: {
          content: 'done',
        },
        finish_reason: 'stop',
      },
    ]);

    const formatted = formatGeminiStream(stream);
    const output = await readUtf8(formatted as ReadableStream<Uint8Array>);

    expect(output).toContain('functionCall');
    expect(output).toContain('"args":{}');
    expect(output).toContain('"finishReason":"STOP"');
  });
});
