import { test, expect, describe } from 'bun:test';
import { AnthropicTransformer } from '../anthropic';
import { transformAnthropicStream } from '../anthropic/stream-transformer';
import { UnifiedChatStreamChunk } from '../../types/unified';

describe('AnthropicTransformer Stream Formatting', () => {
  test('should include usage when it arrives after finish_reason', async () => {
    const transformer = new AnthropicTransformer();
    const stream = new ReadableStream<UnifiedChatStreamChunk>({
      start(controller) {
        // Chunk 1: Stop reason
        controller.enqueue({
          id: 'msg_1',
          model: 'claude',
          created: 1234567890,
          delta: { role: 'assistant', content: 'Hello' },
          finish_reason: 'stop',
        });

        // Chunk 2: Usage (after stop)
        controller.enqueue({
          id: 'msg_1',
          model: 'claude',
          created: 1234567890,
          delta: {},
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            total_tokens: 30,
            reasoning_tokens: 0,
            cached_tokens: 0,
            cache_creation_tokens: 0,
          },
        });

        controller.close();
      },
    });

    const formattedStream = transformer.formatStream(stream);
    const reader = formattedStream.getReader();
    const decoder = new TextDecoder();

    let output = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output += decoder.decode(value);
    }

    // Check for message_delta with usage
    const events = output.split('\n\n').filter(Boolean);
    const messageDeltaEvent = events.find((e) => e.includes('message_delta'));

    expect(messageDeltaEvent).toBeDefined();

    const jsonStr = messageDeltaEvent?.split('data: ')[1];
    expect(jsonStr).toBeDefined();
    const data = JSON.parse(jsonStr!);

    expect(data.type).toBe('message_delta');
    expect(data.usage).toBeDefined();
    expect(data.usage.output_tokens).toBe(20);
    expect(data.delta.stop_reason).toBe('end_turn');
  });

  test('should include thinkingTokens in message_delta usage', async () => {
    const transformer = new AnthropicTransformer();
    const stream = new ReadableStream<UnifiedChatStreamChunk>({
      start(controller) {
        // Chunk 1: Content
        controller.enqueue({
          id: 'msg_2',
          model: 'claude',
          created: 1234567890,
          delta: { role: 'assistant', content: 'Response with thinking' },
        });

        // Chunk 2: Finish with usage including reasoning tokens
        controller.enqueue({
          id: 'msg_2',
          model: 'claude',
          created: 1234567890,
          delta: {},
          finish_reason: 'stop',
          usage: {
            input_tokens: 7,
            output_tokens: 325,
            total_tokens: 1027,
            reasoning_tokens: 695,
            cached_tokens: 0,
            cache_creation_tokens: 0,
          },
        });

        controller.close();
      },
    });

    const formattedStream = transformer.formatStream(stream);
    const reader = formattedStream.getReader();
    const decoder = new TextDecoder();

    let output = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output += decoder.decode(value);
    }

    // Check for message_delta with thinkingTokens
    const events = output.split('\n\n').filter(Boolean);
    const messageDeltaEvent = events.find((e) => e.includes('message_delta'));

    expect(messageDeltaEvent).toBeDefined();

    const jsonStr = messageDeltaEvent?.split('data: ')[1];
    expect(jsonStr).toBeDefined();
    const data = JSON.parse(jsonStr!);

    expect(data.type).toBe('message_delta');
    expect(data.usage).toBeDefined();
    expect(data.usage.input_tokens).toBe(7);
    expect(data.usage.output_tokens).toBe(325);
    expect(data.usage.thinkingTokens).toBe(695);
    expect(data.delta.stop_reason).toBe('end_turn');
  });

  test('should handle zero thinkingTokens', async () => {
    const transformer = new AnthropicTransformer();
    const stream = new ReadableStream<UnifiedChatStreamChunk>({
      start(controller) {
        controller.enqueue({
          id: 'msg_3',
          model: 'claude',
          created: 1234567890,
          delta: { role: 'assistant', content: 'Simple response' },
          finish_reason: 'stop',
          usage: {
            input_tokens: 5,
            output_tokens: 10,
            total_tokens: 15,
            reasoning_tokens: 0,
            cached_tokens: 0,
            cache_creation_tokens: 0,
          },
        });

        controller.close();
      },
    });

    const formattedStream = transformer.formatStream(stream);
    const reader = formattedStream.getReader();
    const decoder = new TextDecoder();

    let output = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output += decoder.decode(value);
    }

    const events = output.split('\n\n').filter(Boolean);
    const messageDeltaEvent = events.find((e) => e.includes('message_delta'));

    expect(messageDeltaEvent).toBeDefined();

    const jsonStr = messageDeltaEvent?.split('data: ')[1];
    expect(jsonStr).toBeDefined();
    const data = JSON.parse(jsonStr!);

    expect(data.usage).toBeDefined();
    expect(data.usage.thinkingTokens).toBe(0);
  });
});

describe('transformAnthropicStream tool call index remapping', () => {
  /**
   * Helper: create a raw Anthropic SSE stream from an array of event objects.
   */
  function makeAnthropicSSE(events: Array<{ event: string; data: any }>): ReadableStream {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        for (const e of events) {
          const line = `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`;
          controller.enqueue(encoder.encode(line));
        }
        controller.close();
      },
    });
  }

  /**
   * Helper: drain a unified stream into an array of chunks.
   */
  async function drainUnifiedStream(stream: ReadableStream): Promise<any[]> {
    const reader = stream.getReader();
    const chunks: any[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    return chunks;
  }

  test('tool_use at Anthropic block index 1 (after text) should become tool call index 0', async () => {
    // Reproduces the bug from log request c7d1efc4:
    // Anthropic sends text at block 0, then tool_use at block 1.
    // The tool call index in unified format must be 0, not 1.
    const sseEvents = [
      {
        event: 'message_start',
        data: {
          type: 'message_start',
          message: {
            id: 'msg_1',
            model: 'claude-sonnet-4-6',
            role: 'assistant',
            content: [],
            usage: { input_tokens: 100, output_tokens: 10 },
          },
        },
      },
      {
        event: 'content_block_start',
        data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'I will search for that.' },
        },
      },
      {
        event: 'content_block_stop',
        data: { type: 'content_block_stop', index: 0 },
      },
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: 1,
          content_block: {
            type: 'tool_use',
            id: 'toolu_01Ay3P3veAArWBgLjc4RipN2',
            name: 'search_web',
            input: {},
          },
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"query": "' },
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: 'fun things' },
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '"}' },
        },
      },
      {
        event: 'content_block_stop',
        data: { type: 'content_block_stop', index: 1 },
      },
      {
        event: 'message_delta',
        data: {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use' },
          usage: { output_tokens: 50 },
        },
      },
    ];

    const rawStream = makeAnthropicSSE(sseEvents);
    const unifiedStream = transformAnthropicStream(rawStream);
    const chunks = await drainUnifiedStream(unifiedStream);

    // Find tool_call start chunk (has id and name)
    const toolStartChunk = chunks.find((c) => c.delta?.tool_calls?.[0]?.id !== undefined);
    expect(toolStartChunk).toBeDefined();
    expect(toolStartChunk.delta.tool_calls[0].index).toBe(0); // MUST be 0, not 1
    expect(toolStartChunk.delta.tool_calls[0].function.name).toBe('search_web');

    // Find all argument delta chunks
    const argChunks = chunks.filter(
      (c) =>
        c.delta?.tool_calls?.[0]?.function?.arguments !== undefined &&
        c.delta?.tool_calls?.[0]?.id === undefined
    );
    for (const ac of argChunks) {
      expect(ac.delta.tool_calls[0].index).toBe(0); // All deltas must also be index 0
    }
  });

  test('two tool_use blocks at Anthropic indices 0 and 1 should map to tool call indices 0 and 1', async () => {
    // Reproduces request 3545367d: two consecutive tool_use blocks
    const sseEvents = [
      {
        event: 'message_start',
        data: {
          type: 'message_start',
          message: {
            id: 'msg_2',
            model: 'claude-sonnet-4-6',
            role: 'assistant',
            content: [],
            usage: { input_tokens: 100, output_tokens: 10 },
          },
        },
      },
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'toolu_A', name: 'search_web', input: {} },
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"query":"a"}' },
        },
      },
      {
        event: 'content_block_stop',
        data: { type: 'content_block_stop', index: 0 },
      },
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 'toolu_B', name: 'search_web', input: {} },
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"query":"b"}' },
        },
      },
      {
        event: 'content_block_stop',
        data: { type: 'content_block_stop', index: 1 },
      },
      {
        event: 'message_delta',
        data: {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use' },
          usage: { output_tokens: 80 },
        },
      },
    ];

    const rawStream = makeAnthropicSSE(sseEvents);
    const unifiedStream = transformAnthropicStream(rawStream);
    const chunks = await drainUnifiedStream(unifiedStream);

    const toolStartChunks = chunks.filter((c) => c.delta?.tool_calls?.[0]?.id !== undefined);
    expect(toolStartChunks).toHaveLength(2);
    expect(toolStartChunks[0].delta.tool_calls[0].index).toBe(0);
    expect(toolStartChunks[0].delta.tool_calls[0].id).toBe('toolu_A');
    expect(toolStartChunks[1].delta.tool_calls[0].index).toBe(1);
    expect(toolStartChunks[1].delta.tool_calls[0].id).toBe('toolu_B');
  });

  test('thinking block + tool_use should remap tool call to index 0', async () => {
    // thinking at block 0, tool_use at block 1
    const sseEvents = [
      {
        event: 'message_start',
        data: {
          type: 'message_start',
          message: {
            id: 'msg_3',
            model: 'claude-sonnet-4-6',
            role: 'assistant',
            content: [],
            usage: { input_tokens: 50, output_tokens: 5 },
          },
        },
      },
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'Let me search...' },
        },
      },
      {
        event: 'content_block_stop',
        data: { type: 'content_block_stop', index: 0 },
      },
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 'toolu_C', name: 'search_web', input: {} },
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"q":"x"}' },
        },
      },
      {
        event: 'content_block_stop',
        data: { type: 'content_block_stop', index: 1 },
      },
      {
        event: 'message_delta',
        data: {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use' },
          usage: { output_tokens: 30 },
        },
      },
    ];

    const rawStream = makeAnthropicSSE(sseEvents);
    const unifiedStream = transformAnthropicStream(rawStream);
    const chunks = await drainUnifiedStream(unifiedStream);

    const toolStartChunk = chunks.find((c) => c.delta?.tool_calls?.[0]?.id !== undefined);
    expect(toolStartChunk).toBeDefined();
    expect(toolStartChunk.delta.tool_calls[0].index).toBe(0);
    expect(toolStartChunk.delta.tool_calls[0].id).toBe('toolu_C');

    const argChunks = chunks.filter(
      (c) =>
        c.delta?.tool_calls?.[0]?.function?.arguments !== undefined &&
        c.delta?.tool_calls?.[0]?.id === undefined
    );
    for (const ac of argChunks) {
      expect(ac.delta.tool_calls[0].index).toBe(0);
    }
  });

  test('text + two tool_use blocks should remap to indices 0 and 1', async () => {
    // text at block 0, tool_use at blocks 1 and 2
    const sseEvents = [
      {
        event: 'message_start',
        data: {
          type: 'message_start',
          message: {
            id: 'msg_4',
            model: 'claude-sonnet-4-6',
            role: 'assistant',
            content: [],
            usage: { input_tokens: 50, output_tokens: 5 },
          },
        },
      },
      {
        event: 'content_block_start',
        data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Searching...' },
        },
      },
      {
        event: 'content_block_stop',
        data: { type: 'content_block_stop', index: 0 },
      },
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 'toolu_D', name: 'search_web', input: {} },
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"q":"a"}' },
        },
      },
      {
        event: 'content_block_stop',
        data: { type: 'content_block_stop', index: 1 },
      },
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: 2,
          content_block: { type: 'tool_use', id: 'toolu_E', name: 'fetch_url', input: {} },
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 2,
          delta: { type: 'input_json_delta', partial_json: '{"url":"x"}' },
        },
      },
      {
        event: 'content_block_stop',
        data: { type: 'content_block_stop', index: 2 },
      },
      {
        event: 'message_delta',
        data: {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use' },
          usage: { output_tokens: 80 },
        },
      },
    ];

    const rawStream = makeAnthropicSSE(sseEvents);
    const unifiedStream = transformAnthropicStream(rawStream);
    const chunks = await drainUnifiedStream(unifiedStream);

    const toolStartChunks = chunks.filter((c) => c.delta?.tool_calls?.[0]?.id !== undefined);
    expect(toolStartChunks).toHaveLength(2);
    // First tool_use (Anthropic block 1) → tool call index 0
    expect(toolStartChunks[0].delta.tool_calls[0].index).toBe(0);
    expect(toolStartChunks[0].delta.tool_calls[0].id).toBe('toolu_D');
    // Second tool_use (Anthropic block 2) → tool call index 1
    expect(toolStartChunks[1].delta.tool_calls[0].index).toBe(1);
    expect(toolStartChunks[1].delta.tool_calls[0].id).toBe('toolu_E');

    // Verify argument deltas also use remapped indices
    const argChunksForBlock1 = chunks.filter(
      (c) => c.delta?.tool_calls?.[0]?.function?.arguments === '{"q":"a"}'
    );
    expect(argChunksForBlock1[0].delta.tool_calls[0].index).toBe(0);

    const argChunksForBlock2 = chunks.filter(
      (c) => c.delta?.tool_calls?.[0]?.function?.arguments === '{"url":"x"}'
    );
    expect(argChunksForBlock2[0].delta.tool_calls[0].index).toBe(1);
  });
});
