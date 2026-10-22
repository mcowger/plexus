import { describe, expect, it } from 'vitest';

import { buildAnthropicRequest } from '../anthropic/request-builder';
import { parseAnthropicRequest } from '../anthropic/request-parser';
import { buildGeminiRequest } from '../gemini/request-builder';
import { OpenAITransformer } from '../openai';
import { ResponsesTransformer } from '../responses';
import { buildResponsesRequest } from '../responses/request-builder';

/**
 * Regression tests for https://github.com/mcowger/plexus/issues/985:
 * `response_format` (`type: "json_schema"`, `strict: true`) on
 * `/v1/chat/completions` was silently dropped by
 * OpenAITransformer.parseRequest, so every cross-format route
 * (chat -> responses, chat -> messages, chat -> gemini) sent the schema
 * nowhere and upstreams returned unconstrained prose with HTTP 200.
 * Chat -> chat only survived by accident of the same-format `originalBody`
 * spread. The Anthropic builder additionally had no `output_config.format`
 * translation at all.
 */

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    decisions: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'decisions'],
  additionalProperties: false,
};

const CHAT_BODY = {
  model: 'openai/gpt-6.1-sol',
  stream: false,
  max_tokens: 1500,
  messages: [{ role: 'user', content: 'Summarize faithfully.' }],
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'meeting_summary',
      strict: true,
      schema: SCHEMA,
    },
  },
};

async function parseChat(body: any) {
  const transformer = new OpenAITransformer();
  const unified = await transformer.parseRequest(body);
  unified.incomingApiType = 'chat';
  unified.originalBody = body;
  return unified;
}

describe('parseRequest response_format normalization', () => {
  it('carries a json_schema descriptor onto the unified request in unified shape', async () => {
    const unified = await parseChat(CHAT_BODY);

    expect('response_format' in unified).toBe(true);
    expect(unified.response_format).toEqual({
      type: 'json_schema',
      json_schema: SCHEMA,
      name: 'meeting_summary',
      strict: true,
    });
  });

  it('an explicit strict:false survives (must not be clobbered to true)', async () => {
    const body = structuredClone(CHAT_BODY);
    body.response_format.json_schema.strict = false;

    const unified = await parseChat(body);

    expect(unified.response_format?.strict).toBe(false);
  });

  it('an omitted descriptor stays absent (no phantom own property)', async () => {
    const { response_format: _dropped, ...body } = CHAT_BODY;

    const unified = await parseChat(body);

    expect('response_format' in unified).toBe(false);
  });

  it('json_object normalizes to a bare type', async () => {
    const unified = await parseChat({ ...CHAT_BODY, response_format: { type: 'json_object' } });

    expect(unified.response_format).toEqual({ type: 'json_object' });
  });

  it('garbage response_format values normalize to absent', async () => {
    for (const garbage of [null, undefined, 'json', 42]) {
      const unified = await parseChat({ ...CHAT_BODY, response_format: garbage });
      expect('response_format' in unified, `garbage ${String(garbage)}`).toBe(false);
    }
  });
});

describe('cross-format structured-output emission', () => {
  it('chat -> chat emits the client descriptor exactly once', async () => {
    const unified = await parseChat(CHAT_BODY);
    const out = await new OpenAITransformer().transformRequest(unified);

    expect(out.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'meeting_summary',
        schema: SCHEMA,
        strict: true,
      },
    });
  });

  it('chat -> responses emits text.format with name/strict/schema', async () => {
    const unified = await parseChat(CHAT_BODY);
    const out = await buildResponsesRequest(unified);

    expect(out.text).toEqual({
      format: {
        type: 'json_schema',
        name: 'meeting_summary',
        strict: true,
        schema: SCHEMA,
      },
    });
  });

  it('chat -> responses preserves an explicit strict:false', async () => {
    const body = structuredClone(CHAT_BODY);
    body.response_format.json_schema.strict = false;
    const unified = await parseChat(body);
    const out = await buildResponsesRequest(unified);

    expect(out.text.format.strict).toBe(false);
  });

  it('chat -> responses emits a bare type for json_object (no schema key)', async () => {
    const unified = await parseChat({ ...CHAT_BODY, response_format: { type: 'json_object' } });
    const out = await buildResponsesRequest(unified);

    expect(out.text).toEqual({ format: { type: 'json_object' } });
  });

  it('chat -> messages emits output_config.format without touching effort', async () => {
    const unified = await parseChat(CHAT_BODY);
    const out = await buildAnthropicRequest(unified);

    expect(out.output_config).toEqual({
      format: { type: 'json_schema', schema: SCHEMA },
    });
  });

  it('chat -> chat passes the client descriptor through verbatim (no rebuild)', async () => {
    // Bare-schema fixture: no `name`, no `strict`. A rebuild would visibly
    // change this (fabricated `name: "response_schema"` wrapper), so
    // `toEqual` against the ORIGINAL proves the fast path ran — reference
    // equality alone would be brittle against future cloning of the spread.
    const body = {
      model: 'openai/gpt-6.1-sol',
      stream: false,
      messages: [{ role: 'user', content: 'Summarize faithfully.' }],
      response_format: { type: 'json_schema', json_schema: SCHEMA },
    };
    const unified = await parseChat(body);
    const out = await new OpenAITransformer().transformRequest(unified);

    expect(out.response_format).toEqual(body.response_format);
  });

  it('chat -> chat passes an explicit strict:false through verbatim', async () => {
    const body = structuredClone(CHAT_BODY);
    body.response_format.json_schema.strict = false;
    const unified = await parseChat(body);
    const out = await new OpenAITransformer().transformRequest(unified);

    expect(out.response_format).toEqual(body.response_format);
  });

  it('same-format with middleware-injected response_format still rebuilds', async () => {
    // The client sent no descriptor, but middleware attached a unified one:
    // with nothing verbatim to preserve, the cross-format rebuild applies.
    const { response_format: _dropped, ...body } = CHAT_BODY as any;
    const unified = await parseChat(body);
    unified.response_format = {
      type: 'json_schema',
      json_schema: SCHEMA,
      name: 'injected',
      strict: false,
    };
    const out = await new OpenAITransformer().transformRequest(unified);

    expect(out.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'injected', schema: SCHEMA, strict: false },
    });
  });

  it('chat -> responses omits strict when the client omitted it', async () => {
    const body = structuredClone(CHAT_BODY);
    delete (body.response_format.json_schema as any).strict;
    const unified = await parseChat(body);
    const out = await buildResponsesRequest(unified);

    expect(out.text.format).toEqual({
      type: 'json_schema',
      name: 'meeting_summary',
      schema: SCHEMA,
    });
    expect('strict' in out.text.format).toBe(false);
  });

  it('chat -> messages with omitted strict still emits output_config.format', async () => {
    // The main #985 path: raw REST callers often omit `strict`. Skipping it
    // would reintroduce the silent unstructured drop, so only an explicit
    // `strict: false` opts out.
    const body = structuredClone(CHAT_BODY);
    delete (body.response_format.json_schema as any).strict;
    const unified = await parseChat(body);
    const out = await buildAnthropicRequest(unified);

    expect(out.output_config).toEqual({
      format: { type: 'json_schema', schema: SCHEMA },
    });
  });

  it('chat -> responses carries description alongside name/schema', async () => {
    const body = structuredClone(CHAT_BODY);
    (body.response_format.json_schema as any).description = 'A meeting summary';
    const unified = await parseChat(body);
    const out = await buildResponsesRequest(unified);

    expect(out.text.format).toEqual({
      type: 'json_schema',
      name: 'meeting_summary',
      description: 'A meeting summary',
      strict: true,
      schema: SCHEMA,
    });
  });

  it('responses -> messages with explicit strict:false stays unstructured', async () => {
    const unified = await new ResponsesTransformer().parseRequest({
      model: 'openai/gpt-6.1-sol',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hi' }] }],
      text: { format: { type: 'json_schema', name: 's', strict: false, schema: SCHEMA } },
    });
    const out = await buildAnthropicRequest(unified);

    expect(out.output_config).toBeUndefined();
  });

  it('chat -> messages with explicit strict:false stays unstructured (best-effort opt-out)', async () => {
    const body = structuredClone(CHAT_BODY);
    body.response_format.json_schema.strict = false;
    const unified = await parseChat(body);
    const out = await buildAnthropicRequest(unified);

    expect(out.output_config).toBeUndefined();
  });

  it('chat -> gemini emits responseMimeType + responseJsonSchema', async () => {
    const unified = await parseChat(CHAT_BODY);
    const out = await buildGeminiRequest(unified);

    expect(out.generationConfig?.responseMimeType).toBe('application/json');
    expect(out.generationConfig?.responseJsonSchema).toEqual(SCHEMA);
  });

  it('chat -> gemini with explicit strict:false stays unstructured (best-effort opt-out)', async () => {
    const body = structuredClone(CHAT_BODY);
    body.response_format.json_schema.strict = false;
    const unified = await parseChat(body);
    const out = await buildGeminiRequest(unified);

    expect(out.generationConfig?.responseMimeType).toBeUndefined();
    expect(out.generationConfig?.responseJsonSchema).toBeUndefined();
  });
});

describe('messages-format structured outputs', () => {
  const MESSAGES_BODY = {
    model: 'claude-sonnet-5-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Summarize faithfully.' }],
    output_config: {
      effort: 'high',
      format: { type: 'json_schema', schema: SCHEMA },
    },
  };

  it('same-format verbatim output_config (effort + format) is never rebuilt', async () => {
    const unified = await parseAnthropicRequest(MESSAGES_BODY);
    unified.incomingApiType = 'messages';
    unified.originalBody = MESSAGES_BODY;
    const out = await buildAnthropicRequest(unified);

    // The client's own output_config passes through untouched — the
    // cross-format merge must not drop `effort` or rewrite `format`.
    expect(out.output_config).toBe(MESSAGES_BODY.output_config);
  });

  it('parseRequest carries output_config.format onto the unified request', async () => {
    const unified = await parseAnthropicRequest(MESSAGES_BODY);

    expect(unified.response_format).toEqual({ type: 'json_schema', json_schema: SCHEMA });
  });

  it('messages -> chat re-emits the parsed schema (fabricated name only, strict stays omitted)', async () => {
    const unified = await parseAnthropicRequest(MESSAGES_BODY);
    unified.incomingApiType = 'messages';
    unified.originalBody = MESSAGES_BODY;
    const out = await new OpenAITransformer().transformRequest(unified);

    expect(out.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'response_schema', schema: SCHEMA },
    });
  });

  it('messages -> responses re-emits without a fabricated strict:true', async () => {
    const unified = await parseAnthropicRequest(MESSAGES_BODY);
    unified.incomingApiType = 'messages';
    unified.originalBody = MESSAGES_BODY;
    const out = await buildResponsesRequest(unified);

    expect(out.text.format).toEqual({
      type: 'json_schema',
      name: 'response_schema',
      schema: SCHEMA,
    });
    expect('strict' in out.text.format).toBe(false);
  });
});
