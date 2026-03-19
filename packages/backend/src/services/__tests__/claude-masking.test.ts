import { describe, expect, test } from 'bun:test';
import {
  CLAUDE_CODE_MASKING_HEADERS,
  proxyToolName,
  deproxyToolName,
  applyRequestMasking,
  deproxyResponse,
  createDeproxyTransformStream,
} from '../claude-masking';
import type { UnifiedChatRequest, UnifiedChatResponse, UnifiedChatStreamChunk } from '../../types/unified';

// ─── proxyToolName ────────────────────────────────────────────────────────────

describe('proxyToolName', () => {
  test('prefixes an external tool name', () => {
    expect(proxyToolName('my_tool')).toBe('proxy_my_tool');
  });

  test('does not double-prefix an already-proxied name', () => {
    expect(proxyToolName('proxy_my_tool')).toBe('proxy_my_tool');
  });

  test('does not prefix built-in Claude Code tool names (case-insensitive)', () => {
    expect(proxyToolName('Read')).toBe('Read');
    expect(proxyToolName('read')).toBe('read');
    expect(proxyToolName('Write')).toBe('Write');
    expect(proxyToolName('Bash')).toBe('Bash');
    expect(proxyToolName('Grep')).toBe('Grep');
    expect(proxyToolName('Glob')).toBe('Glob');
    expect(proxyToolName('WebFetch')).toBe('WebFetch');
    expect(proxyToolName('WebSearch')).toBe('WebSearch');
    expect(proxyToolName('Task')).toBe('Task');
    expect(proxyToolName('TodoWrite')).toBe('TodoWrite');
  });

  test('does not prefix toolChoice keywords', () => {
    expect(proxyToolName('auto')).toBe('auto');
    expect(proxyToolName('any')).toBe('any');
    expect(proxyToolName('none')).toBe('none');
    expect(proxyToolName('required')).toBe('required');
    expect(proxyToolName('AUTO')).toBe('AUTO');
  });

  test('returns an empty string unchanged', () => {
    expect(proxyToolName('')).toBe('');
  });
});

// ─── deproxyToolName ─────────────────────────────────────────────────────────

describe('deproxyToolName', () => {
  test('strips proxy_ prefix', () => {
    expect(deproxyToolName('proxy_my_tool')).toBe('my_tool');
  });

  test('leaves names without the prefix unchanged', () => {
    expect(deproxyToolName('my_tool')).toBe('my_tool');
  });

  test('returns undefined for undefined input', () => {
    expect(deproxyToolName(undefined)).toBeUndefined();
  });

  test('returns empty string unchanged', () => {
    expect(deproxyToolName('')).toBe('');
  });

  test('does not strip a nested proxy_ prefix (only leading)', () => {
    expect(deproxyToolName('proxy_proxy_tool')).toBe('proxy_tool');
  });
});

// ─── CLAUDE_CODE_MASKING_HEADERS ─────────────────────────────────────────────

describe('CLAUDE_CODE_MASKING_HEADERS', () => {
  test('contains the expected anthropic-beta header', () => {
    expect(CLAUDE_CODE_MASKING_HEADERS['anthropic-beta']).toContain('claude-code-20250219');
  });

  test('contains user-agent referencing claude-cli', () => {
    expect(CLAUDE_CODE_MASKING_HEADERS['user-agent']).toContain('claude-cli');
  });

  test('sets x-app to cli', () => {
    expect(CLAUDE_CODE_MASKING_HEADERS['x-app']).toBe('cli');
  });
});

// ─── applyRequestMasking ─────────────────────────────────────────────────────

describe('applyRequestMasking', () => {
  test('proxies tool definition function names', () => {
    const request: UnifiedChatRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [],
      tools: [
        { type: 'function', function: { name: 'get_weather', description: 'Gets weather' } },
        { type: 'function', function: { name: 'send_email' } },
      ],
    };

    applyRequestMasking(request);

    expect(request.tools![0]!.function!.name).toBe('proxy_get_weather');
    expect(request.tools![1]!.function!.name).toBe('proxy_send_email');
  });

  test('does not proxy built-in Claude Code tool definitions', () => {
    const request: UnifiedChatRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [],
      tools: [
        { type: 'function', function: { name: 'Read' } },
        { type: 'function', function: { name: 'Bash' } },
        { type: 'function', function: { name: 'get_weather' } },
      ],
    };

    applyRequestMasking(request);

    expect(request.tools![0]!.function!.name).toBe('Read');
    expect(request.tools![1]!.function!.name).toBe('Bash');
    expect(request.tools![2]!.function!.name).toBe('proxy_get_weather');
  });

  test('proxies tool_calls in assistant messages', () => {
    const request: UnifiedChatRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'tc1', type: 'function', function: { name: 'search_db', arguments: '{}' } },
            { id: 'tc2', type: 'function', function: { name: 'Bash', arguments: '{}' } },
          ],
        },
      ],
    };

    applyRequestMasking(request);

    expect(request.messages[0]!.tool_calls![0]!.function.name).toBe('proxy_search_db');
    expect(request.messages[0]!.tool_calls![1]!.function.name).toBe('Bash');
  });

  test('proxies tool_choice function name when specified', () => {
    const request: UnifiedChatRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [],
      tool_choice: { type: 'function', function: { name: 'search_db' } },
    };

    applyRequestMasking(request);

    const tc = request.tool_choice as { type: 'function'; function: { name: string } };
    expect(tc.function.name).toBe('proxy_search_db');
  });

  test('leaves string tool_choice values (auto/none/required) unchanged', () => {
    const request: UnifiedChatRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [],
      tool_choice: 'auto',
    };

    applyRequestMasking(request);

    expect(request.tool_choice).toBe('auto');
  });

  test('is idempotent — proxying an already-proxied request is safe', () => {
    const request: UnifiedChatRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [],
      tools: [{ type: 'function', function: { name: 'proxy_get_weather' } }],
    };

    applyRequestMasking(request);
    applyRequestMasking(request);

    expect(request.tools![0]!.function!.name).toBe('proxy_get_weather');
  });

  test('does nothing when there are no tools or tool_calls', () => {
    const request: UnifiedChatRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ],
    };

    expect(() => applyRequestMasking(request)).not.toThrow();
  });
});

// ─── deproxyResponse ─────────────────────────────────────────────────────────

describe('deproxyResponse', () => {
  test('strips proxy_ prefix from tool_calls in the response', () => {
    const response: UnifiedChatResponse = {
      id: 'msg_1',
      model: 'claude-3-5-sonnet-20241022',
      content: null,
      tool_calls: [
        { id: 'tc1', type: 'function', function: { name: 'proxy_get_weather', arguments: '{}' } },
        { id: 'tc2', type: 'function', function: { name: 'proxy_search_db', arguments: '{}' } },
      ],
    };

    deproxyResponse(response);

    expect(response.tool_calls![0]!.function.name).toBe('get_weather');
    expect(response.tool_calls![1]!.function.name).toBe('search_db');
  });

  test('leaves non-prefixed names unchanged', () => {
    const response: UnifiedChatResponse = {
      id: 'msg_1',
      model: 'claude-3-5-sonnet-20241022',
      content: 'Hello',
      tool_calls: [
        { id: 'tc1', type: 'function', function: { name: 'get_weather', arguments: '{}' } },
      ],
    };

    deproxyResponse(response);

    expect(response.tool_calls![0]!.function.name).toBe('get_weather');
  });

  test('does nothing when there are no tool_calls', () => {
    const response: UnifiedChatResponse = {
      id: 'msg_1',
      model: 'claude-3-5-sonnet-20241022',
      content: 'Hello',
    };

    expect(() => deproxyResponse(response)).not.toThrow();
  });

  test('is a round-trip inverse of applyRequestMasking for tool names', () => {
    const originalName = 'my_custom_tool';
    const request: UnifiedChatRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [],
      tools: [{ type: 'function', function: { name: originalName } }],
    };

    applyRequestMasking(request);
    expect(request.tools![0]!.function!.name).toBe(`proxy_${originalName}`);

    const response: UnifiedChatResponse = {
      id: 'msg_1',
      model: 'claude-3-5-sonnet-20241022',
      content: null,
      tool_calls: [
        {
          id: 'tc1',
          type: 'function',
          function: { name: `proxy_${originalName}`, arguments: '{}' },
        },
      ],
    };

    deproxyResponse(response);
    expect(response.tool_calls![0]!.function.name).toBe(originalName);
  });
});

// ─── createDeproxyTransformStream ────────────────────────────────────────────

describe('createDeproxyTransformStream', () => {
  async function collectChunks(stream: ReadableStream<UnifiedChatStreamChunk>) {
    const chunks: UnifiedChatStreamChunk[] = [];
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    return chunks;
  }

  function makeChunk(toolCallName?: string): UnifiedChatStreamChunk {
    return {
      id: 'chunk_1',
      model: 'claude-3-5-sonnet-20241022',
      created: Date.now(),
      delta: {
        ...(toolCallName !== undefined
          ? {
              tool_calls: [
                { index: 0, id: 'tc1', type: 'function', function: { name: toolCallName } },
              ],
            }
          : {}),
      },
    };
  }

  test('strips proxy_ prefix from tool_call delta names', async () => {
    const source = new ReadableStream<UnifiedChatStreamChunk>({
      start(controller) {
        controller.enqueue(makeChunk('proxy_get_weather'));
        controller.close();
      },
    });

    const out = await collectChunks(createDeproxyTransformStream(source));
    expect(out[0]!.delta.tool_calls![0]!.function!.name).toBe('get_weather');
  });

  test('leaves non-prefixed names unchanged', async () => {
    const source = new ReadableStream<UnifiedChatStreamChunk>({
      start(controller) {
        controller.enqueue(makeChunk('get_weather'));
        controller.close();
      },
    });

    const out = await collectChunks(createDeproxyTransformStream(source));
    expect(out[0]!.delta.tool_calls![0]!.function!.name).toBe('get_weather');
  });

  test('passes through chunks with no tool_calls unchanged', async () => {
    const source = new ReadableStream<UnifiedChatStreamChunk>({
      start(controller) {
        controller.enqueue(makeChunk()); // no tool_calls
        controller.close();
      },
    });

    const out = await collectChunks(createDeproxyTransformStream(source));
    expect(out).toHaveLength(1);
    expect(out[0]!.delta.tool_calls).toBeUndefined();
  });

  test('handles multiple chunks correctly', async () => {
    const source = new ReadableStream<UnifiedChatStreamChunk>({
      start(controller) {
        controller.enqueue(makeChunk('proxy_tool_a'));
        controller.enqueue(makeChunk('proxy_tool_b'));
        controller.enqueue(makeChunk('Bash')); // built-in, no prefix to strip
        controller.close();
      },
    });

    const out = await collectChunks(createDeproxyTransformStream(source));
    expect(out).toHaveLength(3);
    expect(out[0]!.delta.tool_calls![0]!.function!.name).toBe('tool_a');
    expect(out[1]!.delta.tool_calls![0]!.function!.name).toBe('tool_b');
    expect(out[2]!.delta.tool_calls![0]!.function!.name).toBe('Bash');
  });
});
