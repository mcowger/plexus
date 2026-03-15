import { describe, expect, test, beforeEach } from 'bun:test';
import { Dispatcher } from '../dispatcher';
import { setConfigForTesting } from '../../config';
import { CooldownManager } from '../cooldown-manager';

/**
 * Helper to create a ReadableStream from an array of events
 */
function createEventStream(events: any[]): ReadableStream<any> {
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(event);
      }
      controller.close();
    },
  });
}

/**
 * Helper to consume a stream and return all events
 */
async function consumeStream(stream: ReadableStream<any>): Promise<any[]> {
  const reader = stream.getReader();
  const events: any[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    events.push(value);
  }

  return events;
}

/**
 * Helper to access the private probeOAuthStreamStart method for testing
 */
function probeStreamStart(dispatcher: any, stream: ReadableStream<any>) {
  return dispatcher.probeOAuthStreamStart(stream);
}

function makeConfig() {
  return {
    providers: {
      claudecode: {
        type: 'oauth',
        oauth_provider: 'anthropic',
        api_base_url: 'https://api.anthropic.com',
        models: { 'claude-sonnet-4-6': {} },
      },
    },
    models: {
      'claude-sonnet-4-6': {
        selector: 'in_order',
        targets: [{ provider: 'claudecode', model: 'claude-sonnet-4-6' }],
      },
    },
    keys: {},
    failover: {
      enabled: true,
      retryableStatusCodes: [400, 402, 500, 502, 503, 504, 429],
      retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'],
    },
    quotas: [],
  } as any;
}

describe('OAuth probe: bookkeeping event buffering', () => {
  beforeEach(async () => {
    setConfigForTesting(makeConfig());
    await CooldownManager.getInstance().clearCooldown();
  });

  test('empty stream (0 events) returns ok:false', async () => {
    const dispatcher = new Dispatcher();
    const emptyStream = createEventStream([]);

    const result = await probeStreamStart(dispatcher, emptyStream);

    expect(result.ok).toBe(false);
    expect(result.streamStarted).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain('empty stream');
  });

  test('error event as first event returns ok:false', async () => {
    const dispatcher = new Dispatcher();
    const errorStream = createEventStream([
      {
        type: 'error',
        error: {
          type: 'rate_limit_error',
          message: 'Rate limit exceeded',
        },
      },
    ]);

    const result = await probeStreamStart(dispatcher, errorStream);

    expect(result.ok).toBe(false);
    expect(result.streamStarted).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain('Rate limit exceeded');
  });

  test('error event after bookkeeping events returns ok:false (regression case)', async () => {
    const dispatcher = new Dispatcher();
    const streamWithError = createEventStream([
      { type: 'start', role: 'assistant' },
      { type: 'text_start', contentIndex: 0 },
      {
        type: 'error',
        error: {
          type: 'rate_limit_error',
          message: "This request would exceed your account's rate limit",
        },
      },
    ]);

    const result = await probeStreamStart(dispatcher, streamWithError);

    // This is the critical regression test: the probe must NOT declare ok:true
    // after seeing 'start' or 'text_start' bookkeeping events. It must continue
    // reading until it sees either an error or content-carrying event.
    expect(result.ok).toBe(false);
    expect(result.streamStarted).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain('rate limit');
  });

  test('content event (text_delta) as first event returns ok:true', async () => {
    const dispatcher = new Dispatcher();
    const contentStream = createEventStream([
      { type: 'text_delta', delta: 'Hello', contentIndex: 0 },
      { type: 'text_delta', delta: ' world', contentIndex: 0 },
      { type: 'text_end', contentIndex: 0 },
    ]);

    const result = await probeStreamStart(dispatcher, contentStream);

    expect(result.ok).toBe(true);
    expect(result.stream).toBeDefined();

    // Verify the stream can be consumed and contains all events
    const events = await consumeStream(result.stream!);
    expect(events).toHaveLength(3);
    expect(events[0].type).toBe('text_delta');
    expect(events[0].delta).toBe('Hello');
  });

  test('bookkeeping events followed by content returns ok:true with all events replayed', async () => {
    const dispatcher = new Dispatcher();
    const streamWithBookkeeping = createEventStream([
      { type: 'start', role: 'assistant' },
      { type: 'text_start', contentIndex: 0 },
      { type: 'text_delta', delta: 'Hello', contentIndex: 0 },
      { type: 'text_delta', delta: ' world', contentIndex: 0 },
      { type: 'text_end', contentIndex: 0 },
    ]);

    const result = await probeStreamStart(dispatcher, streamWithBookkeeping);

    expect(result.ok).toBe(true);
    expect(result.stream).toBeDefined();

    // Verify ALL events are replayed, including the bookkeeping ones
    const events = await consumeStream(result.stream!);
    expect(events).toHaveLength(5);
    expect(events[0].type).toBe('start');
    expect(events[1].type).toBe('text_start');
    expect(events[2].type).toBe('text_delta');
    expect(events[2].delta).toBe('Hello');
  });

  test('all bookkeeping event types are buffered', async () => {
    const dispatcher = new Dispatcher();
    const allBookkeepingTypes = createEventStream([
      { type: 'start', role: 'assistant' },
      { type: 'text_start', contentIndex: 0 },
      { type: 'thinking_start', contentIndex: 1 },
      { type: 'thinking_end', contentIndex: 1 },
      { type: 'toolcall_start', contentIndex: 2, toolCall: { id: 'tool_1', name: 'bash' } },
      { type: 'toolcall_end', contentIndex: 2, toolCall: { id: 'tool_1' } },
      { type: 'text_end', contentIndex: 0 },
      { type: 'text_delta', delta: 'Content', contentIndex: 3 },
    ]);

    const result = await probeStreamStart(dispatcher, allBookkeepingTypes);

    expect(result.ok).toBe(true);

    // Verify all 8 events are replayed
    const events = await consumeStream(result.stream!);
    expect(events).toHaveLength(8);
    expect(events[0].type).toBe('start');
    expect(events[6].type).toBe('text_end');
    expect(events[7].type).toBe('text_delta');
  });

  test('reason: error is also detected', async () => {
    const dispatcher = new Dispatcher();
    const errorStream = createEventStream([
      { type: 'start', role: 'assistant' },
      {
        type: 'error',
        reason: 'error',
        error: {
          role: 'assistant',
          content: [],
          stopReason: 'error',
          errorMessage: '429 Rate limit exceeded',
        },
      },
    ]);

    const result = await probeStreamStart(dispatcher, errorStream);

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain('429');
  });
});
