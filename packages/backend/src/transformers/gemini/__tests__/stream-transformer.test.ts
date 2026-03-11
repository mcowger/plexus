import { test, expect, describe } from 'bun:test';
import { transformGeminiStream } from '../stream-transformer';
import type { UnifiedChatStreamChunk } from '../../../types/unified';

/**
 * Helper to convert array of SSE data strings (raw data lines) into a ReadableStream
 * The transformer receives data in the format: "data: {...json...}"
 */
function createSSEStream(sseData: string[]): ReadableStream {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const data of sseData) {
        // Send as proper SSE format
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      }
      controller.close();
    },
  });
}

/**
 * Reads all chunks from a transformed stream using direct reader
 */
async function readAllChunks(stream: ReadableStream): Promise<UnifiedChatStreamChunk[]> {
  const reader = stream.getReader();
  const chunks: UnifiedChatStreamChunk[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    // The transformer enqueues objects directly
    if (value && typeof value === 'object') {
      chunks.push(value as UnifiedChatStreamChunk);
    }
  }

  return chunks;
}

describe('transformGeminiStream', () => {
  test('should emit message_start event on first content', async () => {
    const sseData = [
      '{"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]},"finishReason":null,"index":0}],"responseId":"resp_123","modelVersion":"gemini-2.0-flash"}',
    ];

    const inputStream = createSSEStream(sseData);
    const transformedStream = transformGeminiStream(inputStream);
    const reader = transformedStream.getReader();

    const chunks: UnifiedChatStreamChunk[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && typeof value === 'object') {
        chunks.push(value as UnifiedChatStreamChunk);
      }
    }

    // Should have message_start event
    const messageStart = chunks.find((c) => c.event === 'message_start');
    expect(messageStart).toBeDefined();
    expect(messageStart?.delta?.role).toBe('assistant');
  });

  test('should emit text_start, text_delta, text_end events for text content', async () => {
    const sseData = [
      '{"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]},"finishReason":"STOP","index":0}],"responseId":"resp_123","modelVersion":"gemini-2.0-flash"}',
    ];

    const inputStream = createSSEStream(sseData);
    const transformedStream = transformGeminiStream(inputStream);
    const reader = transformedStream.getReader();

    const chunks: UnifiedChatStreamChunk[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && typeof value === 'object') {
        chunks.push(value as UnifiedChatStreamChunk);
      }
    }

    // Should have text_start event
    const textStart = chunks.find((c) => c.event === 'text_start');
    expect(textStart).toBeDefined();

    // Should have text_delta with content
    const textDelta = chunks.find((c) => c.event === 'text_delta');
    expect(textDelta).toBeDefined();
    expect(textDelta?.delta?.content).toBe('Hello');

    // Should have text_end event
    const textEnd = chunks.find((c) => c.event === 'text_end');
    expect(textEnd).toBeDefined();
  });

  test('should emit thinking_start, thinking_delta, thinking_end events for thought content', async () => {
    const sseData = [
      '{"candidates":[{"content":{"role":"model","parts":[{"text":"Let me think about this","thought":true}]},"finishReason":"STOP","index":0}],"responseId":"resp_123","modelVersion":"gemini-2.0-flash-exp-1219"}',
    ];

    const inputStream = createSSEStream(sseData);
    const transformedStream = transformGeminiStream(inputStream);
    const reader = transformedStream.getReader();

    const chunks: UnifiedChatStreamChunk[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && typeof value === 'object') {
        chunks.push(value as UnifiedChatStreamChunk);
      }
    }

    // Should have thinking_start event
    const thinkingStart = chunks.find((c) => c.event === 'thinking_start');
    expect(thinkingStart).toBeDefined();

    // Should have thinking_delta with reasoning_content
    const thinkingDelta = chunks.find((c) => c.event === 'thinking_delta');
    expect(thinkingDelta).toBeDefined();
    expect(thinkingDelta?.delta?.reasoning_content).toBe('Let me think about this');

    // Should have thinking_end event
    const thinkingEnd = chunks.find((c) => c.event === 'thinking_end');
    expect(thinkingEnd).toBeDefined();
  });

  test('should emit toolcall_start, toolcall_delta, toolcall_end events for function calls', async () => {
    const sseData = [
      '{"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"get_weather","args":{"city":"San Francisco"}}}]},"finishReason":"STOP","index":0}],"responseId":"resp_123","modelVersion":"gemini-2.0-flash"}',
    ];

    const inputStream = createSSEStream(sseData);
    const transformedStream = transformGeminiStream(inputStream);
    const reader = transformedStream.getReader();

    const chunks: UnifiedChatStreamChunk[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && typeof value === 'object') {
        chunks.push(value as UnifiedChatStreamChunk);
      }
    }

    // Should have toolcall_start event
    const toolcallStart = chunks.find((c) => c.event === 'toolcall_start');
    expect(toolcallStart).toBeDefined();

    // Should have toolcall_delta with function call
    const toolcallDelta = chunks.find((c) => c.event === 'toolcall_delta');
    expect(toolcallDelta).toBeDefined();
    expect(toolcallDelta?.delta?.tool_calls).toBeDefined();
    expect(toolcallDelta?.delta?.tool_calls?.[0]?.function?.name).toBe('get_weather');

    // Should have toolcall_end event
    const toolcallEnd = chunks.find((c) => c.event === 'toolcall_end');
    expect(toolcallEnd).toBeDefined();
  });

  test('should emit done event when stream ends with [DONE]', async () => {
    const sseData = [
      '{"candidates":[{"content":{"role":"model","parts":[{"text":"Final response"}]},"finishReason":"STOP","index":0}],"responseId":"resp_123","modelVersion":"gemini-2.0-flash"}',
      '[DONE]',
    ];

    const inputStream = createSSEStream(sseData);
    const transformedStream = transformGeminiStream(inputStream);
    const reader = transformedStream.getReader();

    const chunks: UnifiedChatStreamChunk[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && typeof value === 'object') {
        chunks.push(value as UnifiedChatStreamChunk);
      }
    }

    // Should have done event
    const done = chunks.find((c) => c.event === 'done');
    expect(done).toBeDefined();
  });

  test('should handle mixed content with text and thinking', async () => {
    const sseData = [
      // First chunk: thinking
      '{"candidates":[{"content":{"role":"model","parts":[{"text":"Thinking process","thought":true}]},"finishReason":null,"index":0}],"responseId":"resp_123","modelVersion":"gemini-2.0-flash-exp-1219"}',
      // Second chunk: text
      '{"candidates":[{"content":{"role":"model","parts":[{"text":"Final answer"}]},"finishReason":"STOP","index":0}],"responseId":"resp_123","modelVersion":"gemini-2.0-flash-exp-1219"}',
    ];

    const inputStream = createSSEStream(sseData);
    const transformedStream = transformGeminiStream(inputStream);
    const reader = transformedStream.getReader();

    const chunks: UnifiedChatStreamChunk[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && typeof value === 'object') {
        chunks.push(value as UnifiedChatStreamChunk);
      }
    }

    // Should transition from thinking to text
    const thinkingEnd = chunks.find((c) => c.event === 'thinking_end');
    expect(thinkingEnd).toBeDefined();

    const textStart = chunks.find((c) => c.event === 'text_start');
    expect(textStart).toBeDefined();
  });

  test('should emit usage in finish chunk', async () => {
    const sseData = [
      '{"candidates":[{"content":{"role":"model","parts":[{"text":"Response"}]},"finishReason":"STOP","index":0}],"responseId":"resp_123","modelVersion":"gemini-2.0-flash","usageMetadata":{"promptTokenCount":100,"candidatesTokenCount":50,"totalTokenCount":150,"thoughtsTokenCount":25}}',
    ];

    const inputStream = createSSEStream(sseData);
    const transformedStream = transformGeminiStream(inputStream);
    const reader = transformedStream.getReader();

    const chunks: UnifiedChatStreamChunk[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && typeof value === 'object') {
        chunks.push(value as UnifiedChatStreamChunk);
      }
    }

    // Find chunk with usage
    const usageChunk = chunks.find((c) => c.usage !== undefined);
    expect(usageChunk).toBeDefined();
    expect(usageChunk?.usage?.input_tokens).toBe(100);
    expect(usageChunk?.usage?.output_tokens).toBe(50);
    expect(usageChunk?.usage?.total_tokens).toBe(150);
    expect(usageChunk?.usage?.reasoning_tokens).toBe(25);
  });

  test('should close active block before finishing when finishReason is present', async () => {
    const sseData = [
      '{"candidates":[{"content":{"role":"model","parts":[{"text":"Response"}]},"finishReason":"STOP","index":0}],"responseId":"resp_123","modelVersion":"gemini-2.0-flash"}',
    ];

    const inputStream = createSSEStream(sseData);
    const transformedStream = transformGeminiStream(inputStream);
    const reader = transformedStream.getReader();

    const chunks: UnifiedChatStreamChunk[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && typeof value === 'object') {
        chunks.push(value as UnifiedChatStreamChunk);
      }
    }

    // Should have text_end before finish
    const textEnd = chunks.find((c) => c.event === 'text_end');
    expect(textEnd).toBeDefined();

    // Should have finish_reason in a chunk
    const finishChunk = chunks.find((c) => c.finish_reason !== undefined);
    expect(finishChunk).toBeDefined();
    expect(finishChunk?.finish_reason).toBe('stop');
  });

  test('should handle empty parts array gracefully', async () => {
    const sseData = [
      '{"candidates":[{"content":{"role":"model","parts":[]},"finishReason":"STOP","index":0}],"responseId":"resp_123","modelVersion":"gemini-2.0-flash"}',
    ];

    const inputStream = createSSEStream(sseData);
    const transformedStream = transformGeminiStream(inputStream);
    const reader = transformedStream.getReader();

    const chunks: UnifiedChatStreamChunk[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && typeof value === 'object') {
        chunks.push(value as UnifiedChatStreamChunk);
      }
    }

    // Should still emit message_start and message_end (done)
    const messageStart = chunks.find((c) => c.event === 'message_start');
    expect(messageStart).toBeDefined();
  });

  test('should emit tool_calls finish reason when function calls are present', async () => {
    const sseData = [
      // Response with function call and STOP should become tool_calls
      '{"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"get_weather","args":{"city":"San Francisco"}}}]},"finishReason":"STOP","index":0}],"responseId":"resp_123","modelVersion":"gemini-2.0-flash"}',
    ];

    const inputStream = createSSEStream(sseData);
    const transformedStream = transformGeminiStream(inputStream);
    const reader = transformedStream.getReader();

    const chunks: UnifiedChatStreamChunk[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && typeof value === 'object') {
        chunks.push(value as UnifiedChatStreamChunk);
      }
    }

    // Should have tool_calls finish_reason (not stop) when function calls present
    const finishChunk = chunks.find((c) => c.finish_reason !== undefined);
    expect(finishChunk).toBeDefined();
    expect(finishChunk?.finish_reason).toBe('tool_calls');
  });

  test('should keep tool_calls finish reason across trailing empty text stop chunk', async () => {
    const sseData = [
      '{"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"search_web","args":{"query":"top news headlines today"},"id":"zq87ju01"},"thoughtSignature":"EjQKMgG+Pvb7ME8szPqAOVlwQJYFaO1QyD5KDab+zM9yFbEAeuWVq+pKsOwk3Q9g/kTjh0El"}],"role":"model"},"index":0}],"usageMetadata":{"promptTokenCount":1385,"candidatesTokenCount":19,"totalTokenCount":1404,"promptTokensDetails":[{"modality":"TEXT","tokenCount":1385}]},"modelVersion":"gemini-3.1-flash-lite-preview","responseId":"QdKxaevHCemM_PUPgefn8A8"}',
      '{"candidates":[{"content":{"parts":[{"text":""}],"role":"model"},"finishReason":"STOP","index":0}],"usageMetadata":{"promptTokenCount":1385,"candidatesTokenCount":19,"totalTokenCount":1404,"promptTokensDetails":[{"modality":"TEXT","tokenCount":1385}]},"modelVersion":"gemini-3.1-flash-lite-preview","responseId":"QdKxaevHCemM_PUPgefn8A8"}',
    ];

    const inputStream = createSSEStream(sseData);
    const transformedStream = transformGeminiStream(inputStream);
    const reader = transformedStream.getReader();

    const chunks: UnifiedChatStreamChunk[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && typeof value === 'object') {
        chunks.push(value as UnifiedChatStreamChunk);
      }
    }

    const toolcallDelta = chunks.find((c) => c.event === 'toolcall_delta');
    expect(toolcallDelta?.delta?.tool_calls?.[0]?.function?.name).toBe('search_web');

    const finishChunk = chunks.findLast((c) => c.finish_reason !== undefined);
    expect(finishChunk).toBeDefined();
    expect(finishChunk?.finish_reason).toBe('tool_calls');
  });

  test('should keep stop finish reason when no function calls', async () => {
    const sseData = [
      // Response with text and STOP should stay as stop
      '{"candidates":[{"content":{"role":"model","parts":[{"text":"Hello world"}]},"finishReason":"STOP","index":0}],"responseId":"resp_123","modelVersion":"gemini-2.0-flash"}',
    ];

    const inputStream = createSSEStream(sseData);
    const transformedStream = transformGeminiStream(inputStream);
    const reader = transformedStream.getReader();

    const chunks: UnifiedChatStreamChunk[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && typeof value === 'object') {
        chunks.push(value as UnifiedChatStreamChunk);
      }
    }

    // Should have stop finish_reason (not tooluse) when no function calls
    const finishChunk = chunks.find((c) => c.finish_reason !== undefined);
    expect(finishChunk).toBeDefined();
    expect(finishChunk?.finish_reason).toBe('stop');
  });

  test('should handle RECITATION finish reason', async () => {
    const sseData = [
      // Response with RECITATION should stay as recitation
      '{"candidates":[{"content":{"role":"model","parts":[{"text":"Citation text"}]},"finishReason":"RECITATION","index":0}],"responseId":"resp_123","modelVersion":"gemini-2.0-flash"}',
    ];

    const inputStream = createSSEStream(sseData);
    const transformedStream = transformGeminiStream(inputStream);
    const reader = transformedStream.getReader();

    const chunks: UnifiedChatStreamChunk[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && typeof value === 'object') {
        chunks.push(value as UnifiedChatStreamChunk);
      }
    }

    // Should have recitation finish_reason
    const finishChunk = chunks.find((c) => c.finish_reason !== undefined);
    expect(finishChunk).toBeDefined();
    expect(finishChunk?.finish_reason).toBe('recitation');
  });

  test('should handle usage-only chunk (no candidate)', async () => {
    const sseData = [
      '{"usageMetadata":{"promptTokenCount":123,"candidatesTokenCount":456,"totalTokenCount":579},"responseId":"resp_123","modelVersion":"gemini-1.5-flash"}',
    ];

    const inputStream = createSSEStream(sseData);
    const transformedStream = transformGeminiStream(inputStream);
    const reader = transformedStream.getReader();

    const chunks: UnifiedChatStreamChunk[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && typeof value === 'object') {
        chunks.push(value as UnifiedChatStreamChunk);
      }
    }

    // Should have usage event
    const usageEvent = chunks.find((c) => c.event === 'usage');
    expect(usageEvent).toBeDefined();
    expect(usageEvent?.usage?.input_tokens).toBe(123);
    expect(usageEvent?.usage?.output_tokens).toBe(456);
  });
});
