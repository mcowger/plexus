import { describe, expect, it } from 'bun:test';

import { OpenAITransformer } from '../openai';

const mistralBlocks = [
  {
    type: 'thinking',
    thinking: [{ type: 'text', text: 'réfléchit' }],
    closed: true,
  },
  { type: 'text', text: 'pong' },
];

async function collect(stream: ReadableStream): Promise<any[]> {
  const out: any[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

describe('OpenAITransformer Mistral content blocks', () => {
  it('maps block content to text + reasoning in transformResponse', async () => {
    const res = await new OpenAITransformer().transformResponse({
      id: 'c1',
      model: 'mistral-large',
      choices: [
        {
          message: { role: 'assistant', content: mistralBlocks },
          finish_reason: 'stop',
        },
      ],
    });
    expect(res.content).toBe('pong');
    expect(res.reasoning_content).toBe('réfléchit');
  });

  it('keeps string content and explicit reasoning_content untouched', async () => {
    const res = await new OpenAITransformer().transformResponse({
      choices: [
        {
          message: { content: 'hi', reasoning_content: 'r' },
          finish_reason: 'stop',
        },
      ],
    });
    expect(res.content).toBe('hi');
    expect(res.reasoning_content).toBe('r');
  });

  it('maps block deltas to text + reasoning in transformStream', async () => {
    const enc = new TextEncoder();
    const frame = (content: any) =>
      enc.encode(`data: ${JSON.stringify({ id: 'c1', choices: [{ delta: { content } }] })}\n\n`);
    const src = new ReadableStream({
      start(c) {
        c.enqueue(
          frame([
            {
              type: 'thinking',
              thinking: [{ type: 'text', text: 'hm' }],
              closed: true,
            },
          ])
        );
        c.enqueue(frame([{ type: 'text', text: 'pong' }]));
        c.enqueue(frame('plain'));
        c.close();
      },
    });
    const chunks = await collect(new OpenAITransformer().transformStream(src));
    expect(chunks[0].delta.reasoning_content).toBe('hm');
    expect(chunks[0].delta.content).toBe('');
    expect(chunks[1].delta.content).toBe('pong');
    expect(chunks[2].delta.content).toBe('plain');
  });
});
