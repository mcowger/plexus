import { describe, it, expect } from 'vitest';
import { OpenAITransformer } from '../openai';
import { ResponsesTransformer } from '../responses';

/**
 * Chat Completions `response_format` must land on the unified request in the
 * unified shape (`json_schema` = the schema, `name` / `description` / `strict`
 * as siblings). Carrying OpenAI's nested wrapper through verbatim made every
 * consumer wrap it a second time: chat -> chat emitted
 * `json_schema.schema = { name, schema, strict }` and chat -> responses emitted
 * `text.format.schema` holding the wrapper instead of the schema.
 */

const SCHEMA = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: false,
};

const CHAT_REQUEST = {
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'hello' }],
  response_format: {
    type: 'json_schema',
    json_schema: { name: 'result', description: 'a result', schema: SCHEMA, strict: false },
  },
};

describe('OpenAITransformer response_format normalization', () => {
  it('parses the json_schema wrapper onto the unified shape', async () => {
    const unified = await new OpenAITransformer().parseRequest(CHAT_REQUEST);

    expect(unified.response_format).toEqual({
      type: 'json_schema',
      json_schema: SCHEMA,
      name: 'result',
      description: 'a result',
      strict: false,
    });
  });

  it('passes non-schema response formats through by type', async () => {
    const unified = await new OpenAITransformer().parseRequest({
      ...CHAT_REQUEST,
      response_format: { type: 'json_object' },
    });

    expect(unified.response_format).toEqual({ type: 'json_object' });
  });

  it('does not double-wrap the schema on chat -> chat', async () => {
    const transformer = new OpenAITransformer();
    const unified = await transformer.parseRequest(CHAT_REQUEST);
    const out = await transformer.transformRequest(unified);

    expect(out.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'result', description: 'a result', schema: SCHEMA, strict: false },
    });
  });

  it('emits the schema itself on chat -> responses text.format', async () => {
    const unified = await new OpenAITransformer().parseRequest(CHAT_REQUEST);
    const out = await new ResponsesTransformer().transformRequest(unified);

    expect(out.text.format).toMatchObject({ type: 'json_schema' });
    expect(out.text.format.schema).toEqual(SCHEMA);
  });
});
