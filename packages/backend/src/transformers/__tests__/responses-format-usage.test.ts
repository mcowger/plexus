import { describe, expect, test } from 'bun:test';

import { ResponsesTransformer } from '../responses';

describe('ResponsesTransformer usage formatting', () => {
  test('formatResponse emits input_tokens as total input including cache', async () => {
    const transformer = new ResponsesTransformer();

    const formatted = await transformer.formatResponse({
      id: 'resp_1',
      model: 'gpt-4o',
      created: 1234567890,
      content: 'done',
      usage: {
        input_tokens: 2571,
        output_tokens: 416,
        total_tokens: 17963,
        reasoning_tokens: 0,
        cached_tokens: 14976,
        cache_creation_tokens: 0,
      },
    });

    expect(formatted.usage.input_tokens).toBe(17547);
    expect(formatted.usage.input_tokens_details.cached_tokens).toBe(14976);
    expect(formatted.usage.output_tokens).toBe(416);
    expect(formatted.usage.total_tokens).toBe(17963);
  });

  test('formatStream response.completed emits total input_tokens including cache', async () => {
    const transformer = new ResponsesTransformer();

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          id: 'chatcmpl_1',
          model: 'gpt-4o',
          created: 1234567890,
          delta: { role: 'assistant', content: 'hello' },
          usage: {
            input_tokens: 2571,
            output_tokens: 416,
            total_tokens: 17963,
            reasoning_tokens: 0,
            cached_tokens: 14976,
            cache_creation_tokens: 0,
          },
        });

        controller.enqueue({
          id: 'chatcmpl_1',
          model: 'gpt-4o',
          created: 1234567890,
          delta: {},
          finish_reason: 'tool_calls',
          usage: {
            input_tokens: 2571,
            output_tokens: 416,
            total_tokens: 17963,
            reasoning_tokens: 0,
            cached_tokens: 14976,
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

    const completedEvent = output
      .split('\n\n')
      .find((line) => line.includes('"type":"response.completed"'));

    expect(completedEvent).toBeDefined();
    const payloadLine = (completedEvent as string)
      .split('\n')
      .find((line) => line.startsWith('data: '));
    expect(payloadLine).toBeDefined();
    const payload = JSON.parse((payloadLine as string).replace(/^data:\s*/, ''));

    expect(payload.response.usage.input_tokens).toBe(17547);
    expect(payload.response.usage.input_tokens_details.cached_tokens).toBe(14976);
    expect(payload.response.usage.output_tokens).toBe(416);
    expect(payload.response.usage.total_tokens).toBe(17963);
  });
});

describe('ResponsesTransformer image token usage details', () => {
  const baseUsage = {
    input_tokens: 12,
    output_tokens: 4160,
    total_tokens: 4172,
    reasoning_tokens: 0,
    cached_tokens: 0,
    cache_creation_tokens: 0,
  };

  const imageUsage = {
    ...baseUsage,
    input_image_tokens: 8,
    output_image_tokens: 4160,
  };

  async function collect(stream: ReadableStream): Promise<string> {
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

  function eventsOf(output: string): any[] {
    return output
      .split('\n\n')
      .filter((block) => block.trim().length > 0)
      .map((block) => block.split('\n').find((line) => line.startsWith('data: ')))
      .filter((line): line is string => Boolean(line))
      .map((line) => JSON.parse(line.replace(/^data:\s*/, '')));
  }

  function streamOf(chunks: any[]): ReadableStream {
    return new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
  }

  test('formatResponse emits image_tokens inside both token detail blocks', async () => {
    const transformer = new ResponsesTransformer();

    const formatted = await transformer.formatResponse({
      id: 'resp_img',
      model: 'gpt-5.6-codex',
      created: 1234567890,
      content: 'done',
      usage: imageUsage,
    });

    expect(formatted.usage.input_tokens_details).toEqual({
      cached_tokens: 0,
      image_tokens: 8,
    });
    expect(formatted.usage.output_tokens_details).toEqual({
      reasoning_tokens: 0,
      image_tokens: 4160,
    });
  });

  test('formatResponse omits image_tokens when the usage carries none', async () => {
    const transformer = new ResponsesTransformer();

    const formatted = await transformer.formatResponse({
      id: 'resp_plain',
      model: 'gpt-5.6-codex',
      created: 1234567890,
      content: 'done',
      usage: baseUsage,
    });

    expect(formatted.usage).toEqual({
      input_tokens: 12,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 4160,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 4172,
    });
    expect(formatted.usage.input_tokens_details).not.toHaveProperty('image_tokens');
    expect(formatted.usage.output_tokens_details).not.toHaveProperty('image_tokens');
  });

  test('formatStream response.completed on stream end carries image_tokens', async () => {
    const transformer = new ResponsesTransformer();

    const output = await collect(
      transformer.formatStream(
        streamOf([
          {
            id: 'chatcmpl_img',
            model: 'gpt-5.6-codex',
            created: 1234567890,
            delta: { role: 'assistant', content: 'hi' },
            usage: imageUsage,
          },
        ])
      )
    );

    const completed = eventsOf(output).find((e) => e.type === 'response.completed');
    expect(completed.response.usage.input_tokens_details).toEqual({
      cached_tokens: 0,
      image_tokens: 8,
    });
    expect(completed.response.usage.output_tokens_details).toEqual({
      reasoning_tokens: 0,
      image_tokens: 4160,
    });
  });

  test('formatStream response.completed on finish_reason carries image_tokens', async () => {
    const transformer = new ResponsesTransformer();

    const output = await collect(
      transformer.formatStream(
        streamOf([
          {
            id: 'chatcmpl_img',
            model: 'gpt-5.6-codex',
            created: 1234567890,
            delta: { role: 'assistant', content: 'hi' },
            usage: imageUsage,
          },
          // No `delta` key at all: takes the `finish_reason && !delta` branch.
          {
            id: 'chatcmpl_img',
            model: 'gpt-5.6-codex',
            created: 1234567890,
            finish_reason: 'stop',
            usage: imageUsage,
          },
        ])
      )
    );

    const completed = eventsOf(output).find((e) => e.type === 'response.completed');
    expect(completed.response.usage.input_tokens_details).toEqual({
      cached_tokens: 0,
      image_tokens: 8,
    });
    expect(completed.response.usage.output_tokens_details).toEqual({
      reasoning_tokens: 0,
      image_tokens: 4160,
    });
  });

  test('formatStream response.incomplete carries image_tokens', async () => {
    const transformer = new ResponsesTransformer();

    const output = await collect(
      transformer.formatStream(
        streamOf([
          {
            id: 'chatcmpl_img',
            model: 'gpt-5.6-codex',
            created: 1234567890,
            delta: { role: 'assistant', content: 'hi' },
            usage: imageUsage,
          },
          {
            id: 'chatcmpl_img',
            model: 'gpt-5.6-codex',
            created: 1234567890,
            event: 'error',
            incomplete_details: { reason: 'max_output_tokens' },
            usage: imageUsage,
          },
        ])
      )
    );

    const incomplete = eventsOf(output).find((e) => e.type === 'response.incomplete');
    expect(incomplete.response.usage.input_tokens_details).toEqual({
      cached_tokens: 0,
      image_tokens: 8,
    });
    expect(incomplete.response.usage.output_tokens_details).toEqual({
      reasoning_tokens: 0,
      image_tokens: 4160,
    });
  });

  test('formatStream response.failed carries image_tokens', async () => {
    const transformer = new ResponsesTransformer();

    const output = await collect(
      transformer.formatStream(
        streamOf([
          {
            id: 'chatcmpl_img',
            model: 'gpt-5.6-codex',
            created: 1234567890,
            delta: { role: 'assistant', content: 'hi' },
            usage: imageUsage,
          },
          {
            id: 'chatcmpl_img',
            model: 'gpt-5.6-codex',
            created: 1234567890,
            event: 'error',
            error: { code: 'server_error', message: 'boom' },
            usage: imageUsage,
          },
        ])
      )
    );

    const failed = eventsOf(output).find((e) => e.type === 'response.failed');
    expect(failed.response.usage.input_tokens_details).toEqual({
      cached_tokens: 0,
      image_tokens: 8,
    });
    expect(failed.response.usage.output_tokens_details).toEqual({
      reasoning_tokens: 0,
      image_tokens: 4160,
    });
  });

  test('formatStream usage payloads stay unchanged when no image tokens are present', async () => {
    const transformer = new ResponsesTransformer();

    const output = await collect(
      transformer.formatStream(
        streamOf([
          {
            id: 'chatcmpl_plain',
            model: 'gpt-5.6-codex',
            created: 1234567890,
            delta: { role: 'assistant', content: 'hi' },
            usage: baseUsage,
          },
        ])
      )
    );

    const completed = eventsOf(output).find((e) => e.type === 'response.completed');
    expect(completed.response.usage).toEqual({
      input_tokens: 12,
      output_tokens: 4160,
      total_tokens: 4172,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    });
    expect(completed.response.usage.input_tokens_details).not.toHaveProperty('image_tokens');
    expect(completed.response.usage.output_tokens_details).not.toHaveProperty('image_tokens');
  });
});
