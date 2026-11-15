import { describe, expect, test } from 'bun:test';

import { createParser } from 'eventsource-parser';

import { interceptResponseEvents } from '../response-event-callback';

function byteStream(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
}

async function readText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return text + decoder.decode();
    text += decoder.decode(value, { stream: true });
  }
}

describe('response SSE interception', () => {
  test('preserves framing and fields across byte boundaries while updating multiline response data', async () => {
    const input =
      ': comment\r\nid: 7\r\nevent: response.completed\r\nretry: 42\r\ndata: {"type":"response.completed",\r\ndata: "response":{"id":"résp","output":[{"type":"reasoning","encrypted_content":"secret"}]}}\r\n\r\nevent: other\ndata: [DONE]\n\n';
    const events: string[] = [];
    const result = await readText(
      byteStream(input).pipeThrough(
        interceptResponseEvents(async (response, event) => {
          events.push(event ?? '');
          if (response && typeof response === 'object') Object.assign(response, { store: true });
        })
      )
    );
    expect(events).toEqual(['response.completed']);
    expect(result).toContain(': comment\r\nid: 7\r\nevent: response.completed\r\nretry: 42\r\n');
    expect(result).toEndWith('event: other\ndata: [DONE]\n\n');
    const parsed: string[] = [];
    const parser = createParser({ onEvent: (event) => parsed.push(event.data) });
    parser.feed(result);
    if (!parsed[0]) throw new Error('Missing rewritten event');
    expect(JSON.parse(parsed[0])).toEqual({
      type: 'response.completed',
      response: {
        id: 'résp',
        output: [{ type: 'reasoning', encrypted_content: 'secret' }],
        store: true,
      },
    });
    expect(parsed[1]).toBe('[DONE]');
  });

  test('awaits the callback before delivering a terminal frame and propagates errors', async () => {
    const gate = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const input = 'data: {"type":"response.completed","response":{"id":"r"}}\n\n';
    const reader = byteStream(input)
      .pipeThrough(
        interceptResponseEvents(async () => {
          entered.resolve();
          await gate.promise;
        })
      )
      .getReader();
    let delivered = false;
    const read = reader.read().then((result) => {
      delivered = true;
      return result;
    });
    await entered.promise;
    expect(delivered).toBe(false);
    gate.resolve();
    expect(new TextDecoder().decode((await read).value)).toContain('response.completed');

    const failure = new Error('storage failed');
    const failedReader = byteStream(input)
      .pipeThrough(
        interceptResponseEvents(async () => {
          throw failure;
        })
      )
      .getReader();
    await expect(failedReader.read()).rejects.toThrow('storage failed');
  });
});
