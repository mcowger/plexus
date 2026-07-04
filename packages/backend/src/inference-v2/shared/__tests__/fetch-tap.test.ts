import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// @earendil-works/pi-ai and utils/logger are globally mocked in test/vitest.setup.ts

// fetch-tap.ts captures `globalThis.fetch` as `originalFetch` at module-load
// time, so each test stubs the global first, then re-imports the module
// fresh (via resetModules) so the stub is what gets captured.
async function loadFetchTapWithMockedFetch(mockFetch: typeof fetch) {
  vi.stubGlobal('fetch', mockFetch);
  vi.resetModules();
  const fetchTap = await import('../fetch-tap');
  const executor = await import('../pi-ai-executor');
  fetchTap.installFetchTap();
  return { fetchTap, debugRequestIdStorage: executor.debugRequestIdStorage };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('fetch-tap server-tool block capture', () => {
  describe('non-streaming', () => {
    it('captures server_tool_use and web_search_tool_result blocks from a JSON response', async () => {
      const body = JSON.stringify({
        type: 'message',
        content: [
          { type: 'text', text: 'Here is what I found.' },
          { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'q' } },
          {
            type: 'web_search_tool_result',
            tool_use_id: 'srvtoolu_1',
            content: [{ type: 'web_search_result', title: 't', url: 'https://example.com' }],
          },
        ],
      });
      const mockFetch = vi.fn(
        async () =>
          new Response(body, {
            status: 200,
            headers: { 'content-type': 'application/json', 'content-length': String(body.length) },
          })
      );
      const { fetchTap, debugRequestIdStorage } = await loadFetchTapWithMockedFetch(
        mockFetch as any
      );

      const requestId = 'req-1';
      fetchTap.watchForServerToolBlocks(requestId);

      await debugRequestIdStorage.run(requestId, () => fetch('https://upstream.example/x'));

      const blocks = fetchTap.consumeServerToolBlocks(requestId);
      expect(blocks).toHaveLength(2);
      expect(blocks[0]).toMatchObject({ type: 'server_tool_use', id: 'srvtoolu_1' });
      expect(blocks[1]).toMatchObject({
        type: 'web_search_tool_result',
        tool_use_id: 'srvtoolu_1',
      });
    });

    it('consumeServerToolBlocks clears captured state (one-shot)', async () => {
      const body = JSON.stringify({
        content: [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: {} }],
      });
      const mockFetch = vi.fn(
        async () =>
          new Response(body, {
            status: 200,
            headers: { 'content-type': 'application/json', 'content-length': String(body.length) },
          })
      );
      const { fetchTap, debugRequestIdStorage } = await loadFetchTapWithMockedFetch(
        mockFetch as any
      );

      const requestId = 'req-2';
      fetchTap.watchForServerToolBlocks(requestId);
      await debugRequestIdStorage.run(requestId, () => fetch('https://upstream.example/x'));

      expect(fetchTap.consumeServerToolBlocks(requestId)).toHaveLength(1);
      expect(fetchTap.consumeServerToolBlocks(requestId)).toHaveLength(0);
    });

    it('does not capture anything when the request was never armed via watchForServerToolBlocks', async () => {
      const body = JSON.stringify({
        content: [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: {} }],
      });
      const mockFetch = vi.fn(
        async () =>
          new Response(body, {
            status: 200,
            headers: { 'content-type': 'application/json', 'content-length': String(body.length) },
          })
      );
      const { fetchTap, debugRequestIdStorage } = await loadFetchTapWithMockedFetch(
        mockFetch as any
      );

      const requestId = 'req-3';
      await debugRequestIdStorage.run(requestId, () => fetch('https://upstream.example/x'));

      expect(fetchTap.consumeServerToolBlocks(requestId)).toHaveLength(0);
    });
  });

  describe('streaming', () => {
    function sseStreamFromEvents(events: Array<{ event: string; data: unknown }>): ReadableStream {
      const encoder = new TextEncoder();
      return new ReadableStream({
        start(controller) {
          for (const { event, data } of events) {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
            );
          }
          controller.close();
        },
      });
    }

    it('reconstructs a server_tool_use block from content_block_start/delta/stop SSE events', async () => {
      const stream = sseStreamFromEvents([
        {
          event: 'content_block_start',
          data: {
            type: 'content_block_start',
            index: 0,
            content_block: {
              type: 'server_tool_use',
              id: 'srvtoolu_1',
              name: 'web_search',
              input: {},
            },
          },
        },
        {
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: '{"query":' },
          },
        },
        {
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: '"weather today"}' },
          },
        },
        { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
      ]);
      const mockFetch = vi.fn(
        async () =>
          new Response(stream, {
            status: 200,
            headers: { 'content-type': 'text/event-stream', 'transfer-encoding': 'chunked' },
          })
      );
      const { fetchTap, debugRequestIdStorage } = await loadFetchTapWithMockedFetch(
        mockFetch as any
      );

      const requestId = 'req-stream-1';
      fetchTap.watchForServerToolBlocks(requestId);

      const response = await debugRequestIdStorage.run(requestId, () =>
        fetch('https://upstream.example/x')
      );
      // Drain the (tapped) body so transform()/flush() actually run — mirrors
      // pi-ai reading the stream downstream.
      const reader = response.body!.getReader();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      const blocks = fetchTap.consumeServerToolBlocks(requestId);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toMatchObject({
        type: 'server_tool_use',
        id: 'srvtoolu_1',
        name: 'web_search',
      });
      expect(blocks[0]!.input).toEqual({ query: 'weather today' });
    });

    it('handles CRLF-framed events split across chunk boundaries', async () => {
      // Real Anthropic uses LF, but an intermediary proxy may re-frame with
      // CRLF; eventsource-parser must still recognize event boundaries. Also
      // split each event mid-way across two chunks to exercise cross-chunk
      // buffering.
      const encoder = new TextEncoder();
      const rawEvents = [
        `event: content_block_start\r\ndata: ${JSON.stringify({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'web_search_tool_result', tool_use_id: 's1', content: [] },
        })}\r\n\r\n`,
        `event: content_block_stop\r\ndata: ${JSON.stringify({
          type: 'content_block_stop',
          index: 0,
        })}\r\n\r\n`,
      ];
      const joined = rawEvents.join('');
      const mid = Math.floor(joined.length / 2);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(joined.slice(0, mid)));
          controller.enqueue(encoder.encode(joined.slice(mid)));
          controller.close();
        },
      });
      const mockFetch = vi.fn(
        async () =>
          new Response(stream, {
            status: 200,
            headers: { 'content-type': 'text/event-stream', 'transfer-encoding': 'chunked' },
          })
      );
      const { fetchTap, debugRequestIdStorage } = await loadFetchTapWithMockedFetch(
        mockFetch as any
      );

      const requestId = 'req-stream-crlf';
      fetchTap.watchForServerToolBlocks(requestId);

      const response = await debugRequestIdStorage.run(requestId, () =>
        fetch('https://upstream.example/x')
      );
      const reader = response.body!.getReader();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      const blocks = fetchTap.consumeServerToolBlocks(requestId);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toMatchObject({ type: 'web_search_tool_result', tool_use_id: 's1' });
    });

    it('finalizes a block left open by a truncated stream via the defensive flush path', async () => {
      const stream = sseStreamFromEvents([
        {
          event: 'content_block_start',
          data: {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'web_search_tool_result', tool_use_id: 's1', content: [] },
          },
        },
        // Stream ends (EOF) without a content_block_stop for index 0.
      ]);
      const mockFetch = vi.fn(
        async () =>
          new Response(stream, {
            status: 200,
            headers: { 'content-type': 'text/event-stream', 'transfer-encoding': 'chunked' },
          })
      );
      const { fetchTap, debugRequestIdStorage } = await loadFetchTapWithMockedFetch(
        mockFetch as any
      );

      const requestId = 'req-stream-2';
      fetchTap.watchForServerToolBlocks(requestId);

      const response = await debugRequestIdStorage.run(requestId, () =>
        fetch('https://upstream.example/x')
      );
      const reader = response.body!.getReader();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      const blocks = fetchTap.consumeServerToolBlocks(requestId);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toMatchObject({ type: 'web_search_tool_result', tool_use_id: 's1' });
    });

    it('does not enqueue extra bytes into the passed-through body', async () => {
      const stream = sseStreamFromEvents([
        {
          event: 'content_block_start',
          data: {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          },
        },
        {
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'hi' },
          },
        },
      ]);
      const mockFetch = vi.fn(
        async () =>
          new Response(stream, {
            status: 200,
            headers: { 'content-type': 'text/event-stream', 'transfer-encoding': 'chunked' },
          })
      );
      const { fetchTap, debugRequestIdStorage } = await loadFetchTapWithMockedFetch(
        mockFetch as any
      );

      const requestId = 'req-stream-3';
      fetchTap.watchForServerToolBlocks(requestId);

      const response = await debugRequestIdStorage.run(requestId, () =>
        fetch('https://upstream.example/x')
      );
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let full = '';
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value);
      }

      expect(full).toContain('text_delta');
      expect(full).toContain('hi');
      // No server-tool blocks were present, so nothing captured, and the
      // pass-through body is untouched (not duplicated/corrupted).
      expect(fetchTap.consumeServerToolBlocks(requestId)).toHaveLength(0);
    });
  });
});
