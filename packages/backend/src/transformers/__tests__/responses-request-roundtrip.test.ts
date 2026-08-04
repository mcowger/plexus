import { describe, it, expect } from 'vitest';
import {
  ResponsesTransformer,
  normalizeCompositeResponsesCallIds,
  normalizeResponsesFunctionCallItemIds,
  normalizeResponsesReasoningContent,
} from '../responses';
import { OpenAITransformer } from '../openai';
import { parseAnthropicRequest } from '../anthropic/request-parser';

/**
 * Round-trip tests for the Responses API transformer.
 *
 * These mirror the Anthropic round-trip regression tests (PR #617). They cover
 * the case where a same-format (responses -> responses) transform takes the
 * non-pass-through path (e.g. adapter active, vision fallthrough) and would
 * otherwise drop Responses-API-native fields that the unified schema does not
 * model: user, store, background, service_tier, truncation, metadata, top_p,
 * previous_response_id, conversation, stream_options, etc.
 *
 * On the common pass-through path the verbatim originalBody is sent regardless,
 * so these only matter when pass-through is suppressed.
 */

const RESPONSES_REQUEST = {
  model: 'gpt-4o',
  input: [
    {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Hello' }],
    },
  ],
  stream: true,
  max_output_tokens: 1024,
  temperature: 0.7,
  top_p: 0.9,
  top_logprobs: 3,
  max_tool_calls: 5,
  instructions: 'Be concise.',
  reasoning: { effort: 'medium' },
  include: ['reasoning.encrypted_content'],
  prompt_cache_key: 'cache-1',
  parallel_tool_calls: true,
  text: { format: { type: 'text' } },
  user: 'user-abc',
  store: true,
  background: false,
  service_tier: 'auto',
  truncation: 'auto',
  metadata: { session: 's1' },
  previous_response_id: 'resp_prev_1',
  conversation: 'conv_1',
  prompt_cache_retention: '24h',
  safety_identifier: 'si-1',
  stream_options: { include_obfuscation: true },
};

describe('Responses responses -> responses round-trip preserves native fields', () => {
  it('normalizes composite call IDs to the model-generated call ID', () => {
    const body = {
      input: [
        {
          type: 'function_call',
          name: 'exec_command',
          call_id: 'call_short|fc_short',
          arguments: '{}',
        },
        {
          type: 'function_call',
          name: 'exec_command',
          call_id:
            'call_enS4L7YycCRyOiWOg31Xpvwm|fc_0281edd961557cf2016a4b062d87948195968b8fa6c46b8c7a',
          arguments: '{}',
        },
        {
          type: 'function_call_output',
          call_id:
            'call_enS4L7YycCRyOiWOg31Xpvwm|fc_0281edd961557cf2016a4b062d87948195968b8fa6c46b8c7a',
          output: 'ok',
        },
        {
          type: 'function_call',
          name: 'exec_command',
          call_id: 'call_plain',
          arguments: '{}',
        },
        {
          type: 'function_call',
          name: 'exec_command',
          call_id: 'custom|id',
          arguments: '{}',
        },
      ],
    };

    expect(normalizeCompositeResponsesCallIds(body)).toBe(2);
    expect(body.input.map((item) => item.call_id)).toEqual([
      'call_short|fc_short',
      'call_enS4L7YycCRyOiWOg31Xpvwm',
      'call_enS4L7YycCRyOiWOg31Xpvwm',
      'call_plain',
      'custom|id',
    ]);
  });

  it('uses normalized call IDs when rebuilding a Responses request', async () => {
    const transformer = new ResponsesTransformer();
    const body = {
      model: 'gpt-4o',
      input: [
        {
          type: 'function_call',
          name: 'exec_command',
          call_id:
            'call_enS4L7YycCRyOiWOg31Xpvwm|fc_0281edd961557cf2016a4b062d87948195968b8fa6c46b8c7a',
          arguments: '{}',
        },
        {
          type: 'function_call_output',
          call_id:
            'call_enS4L7YycCRyOiWOg31Xpvwm|fc_0281edd961557cf2016a4b062d87948195968b8fa6c46b8c7a',
          output: 'ok',
        },
      ],
    };

    normalizeCompositeResponsesCallIds(body);
    const unified = await transformer.parseRequest(body);
    const built = await transformer.transformRequest(unified);

    expect(
      built.input
        .filter(
          (item: any) => item.type === 'function_call' || item.type === 'function_call_output'
        )
        .map((item: any) => item.call_id)
    ).toEqual(['call_enS4L7YycCRyOiWOg31Xpvwm', 'call_enS4L7YycCRyOiWOg31Xpvwm']);
  });

  it('strips call-ID-shaped item ids from function_call items (strict providers demand fc_...)', () => {
    const badItem: Record<string, unknown> = {
      type: 'function_call',
      id: 'call_913ea4b95c694f4598cdc490',
      name: 'exec_command',
      call_id: 'call_913ea4b95c694f4598cdc490',
      arguments: '{}',
    };
    const goodItem: Record<string, unknown> = {
      type: 'function_call',
      id: 'fc_0281edd961557cf2016a4b062d87948195968b8fa6c46b8c7a',
      name: 'exec_command',
      call_id: 'call_enS4L7YycCRyOiWOg31Xpvwm',
      arguments: '{}',
    };
    const noIdItem: Record<string, unknown> = {
      type: 'function_call',
      name: 'exec_command',
      call_id: 'call_no_item_id',
      arguments: '{}',
    };
    const outputItem: Record<string, unknown> = {
      type: 'function_call_output',
      id: 'fco_019fcb3b-b025-7fc3-830a-f61ed2f8142b',
      call_id: 'call_913ea4b95c694f4598cdc490',
      output: 'ok',
    };
    const body = { input: [badItem, goodItem, noIdItem, outputItem] };

    expect(normalizeResponsesFunctionCallItemIds(body)).toBe(1);
    expect('id' in badItem).toBe(false);
    expect(badItem.call_id).toBe('call_913ea4b95c694f4598cdc490');
    expect(goodItem.id).toBe('fc_0281edd961557cf2016a4b062d87948195968b8fa6c46b8c7a');
    expect('id' in noIdItem).toBe(false);
    expect(outputItem.id).toBe('fco_019fcb3b-b025-7fc3-830a-f61ed2f8142b');
  });

  it('only touches the exact observed bad shape (function_call + call_-prefixed id)', () => {
    const messageItem: Record<string, unknown> = {
      type: 'message',
      id: 'call_not_our_problem',
      role: 'user',
      content: [{ type: 'input_text', text: 'hi' }],
    };
    // Caller-provided id with another prefix: not rewritten.
    const customIdItem: Record<string, unknown> = {
      type: 'function_call',
      id: 'custom_item_id',
      name: 'exec_command',
      call_id: 'call_plain',
      arguments: '{}',
    };
    const body = { input: [messageItem, customIdItem] };

    expect(normalizeResponsesFunctionCallItemIds(body)).toBe(0);
    expect(messageItem.id).toBe('call_not_our_problem');
    expect(customIdItem.id).toBe('custom_item_id');

    expect(normalizeResponsesFunctionCallItemIds(null)).toBe(0);
    expect(normalizeResponsesFunctionCallItemIds({})).toBe(0);
    expect(normalizeResponsesFunctionCallItemIds({ input: 'not-an-array' })).toBe(0);
  });

  it('rebuilds a clean request after stripping replayed item ids', async () => {
    const transformer = new ResponsesTransformer();
    const body = {
      model: 'gpt-4o',
      input: [
        {
          type: 'function_call',
          id: 'call_913ea4b95c694f4598cdc490',
          name: 'exec_command',
          call_id: 'call_913ea4b95c694f4598cdc490',
          arguments: '{}',
        },
        {
          type: 'function_call_output',
          call_id: 'call_913ea4b95c694f4598cdc490',
          output: 'ok',
        },
      ],
    };

    normalizeResponsesFunctionCallItemIds(body);
    const unified = await transformer.parseRequest(body);
    const built = await transformer.transformRequest(unified);

    expect(
      built.input
        .filter(
          (item: any) => item.type === 'function_call' || item.type === 'function_call_output'
        )
        .map((item: any) => item.call_id)
    ).toEqual(['call_913ea4b95c694f4598cdc490', 'call_913ea4b95c694f4598cdc490']);
    expect(built.input.every((item: any) => !String(item.id ?? '').startsWith('call_'))).toBe(true);
  });

  it('removes replayed plaintext reasoning content while preserving reasoning metadata', () => {
    const body = {
      input: [
        {
          id: 'rs_123',
          type: 'reasoning',
          status: 'completed',
          summary: [{ type: 'summary_text', text: 'summary' }],
          content: [{ type: 'reasoning_text', text: 'private chain of thought' }],
          encrypted_content: 'encrypted-reasoning',
        },
        {
          type: 'reasoning',
          summary: [],
          content: [],
          encrypted_content: null,
        },
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'hello' }],
        },
      ],
    };

    expect(normalizeResponsesReasoningContent(body)).toBe(1);
    expect(body.input[0]).toEqual({
      id: 'rs_123',
      type: 'reasoning',
      status: 'completed',
      summary: [{ type: 'summary_text', text: 'summary' }],
      content: [],
      encrypted_content: 'encrypted-reasoning',
    });
    expect(body.input[1]).toMatchObject({ content: [] });
    expect(body.input[2]).toMatchObject({ content: [{ type: 'input_text', text: 'hello' }] });
  });

  it('preserves top-level user, store, background, service_tier, truncation', async () => {
    const transformer = new ResponsesTransformer();
    const unified = await transformer.parseRequest(RESPONSES_REQUEST);
    const built = await transformer.transformRequest({
      ...unified,
      incomingApiType: 'responses',
      originalBody: RESPONSES_REQUEST,
    });

    expect(built.user).toBe('user-abc');
    expect(built.store).toBe(true);
    expect(built.background).toBe(false);
    expect(built.service_tier).toBe('auto');
    expect(built.truncation).toBe('auto');
  });

  it('preserves metadata, previous_response_id, conversation, stream_options', async () => {
    const transformer = new ResponsesTransformer();
    const unified = await transformer.parseRequest(RESPONSES_REQUEST);
    const built = await transformer.transformRequest({
      ...unified,
      incomingApiType: 'responses',
      originalBody: RESPONSES_REQUEST,
    });

    expect(built.metadata).toEqual({ session: 's1' });
    expect(built.previous_response_id).toBe('resp_prev_1');
    expect(built.conversation).toBe('conv_1');
    expect(built.stream_options).toEqual({ include_obfuscation: true });
    expect(built.prompt_cache_retention).toBe('24h');
    expect(built.safety_identifier).toBe('si-1');
  });

  it('does not inject a default temperature when the client omits it', async () => {
    const transformer = new ResponsesTransformer();
    const { temperature, ...requestWithoutTemperature } = RESPONSES_REQUEST;

    const unified = await transformer.parseRequest(requestWithoutTemperature);
    expect(unified.temperature).toBeUndefined();
    // Stronger than undefined: the unified request must carry NO own
    // `temperature` property at all. A phantom `temperature: undefined` own
    // property survives object spreads and flips `'temperature' in x` /
    // hasOwnProperty checks downstream even though JSON would drop it.
    expect('temperature' in unified).toBe(false);

    const built = await transformer.transformRequest({
      ...unified,
      incomingApiType: 'responses',
      originalBody: requestWithoutTemperature,
    });

    expect(built.temperature).toBeUndefined();
    expect(built).not.toHaveProperty('temperature');
  });

  it('still forwards an explicit temperature the client sent', async () => {
    const transformer = new ResponsesTransformer();
    const unified = await transformer.parseRequest(RESPONSES_REQUEST);
    expect(unified.temperature).toBe(0.7);

    const built = await transformer.transformRequest({
      ...unified,
      incomingApiType: 'responses',
      originalBody: RESPONSES_REQUEST,
    });

    expect(built.temperature).toBe(0.7);
  });

  it('preserves sampling params top_p, top_logprobs, max_tool_calls', async () => {
    const transformer = new ResponsesTransformer();
    const unified = await transformer.parseRequest(RESPONSES_REQUEST);
    const built = await transformer.transformRequest({
      ...unified,
      incomingApiType: 'responses',
      originalBody: RESPONSES_REQUEST,
    });

    expect(built.top_p).toBe(0.9);
    expect(built.top_logprobs).toBe(3);
    expect(built.max_tool_calls).toBe(5);
  });

  it('explicitly-mapped fields still override originalBody', async () => {
    const transformer = new ResponsesTransformer();
    const unified = await transformer.parseRequest(RESPONSES_REQUEST);
    // Simulate the unified pipeline overriding max_output_tokens
    const built = await transformer.transformRequest({
      ...unified,
      max_tokens: 4096,
      incomingApiType: 'responses',
      originalBody: RESPONSES_REQUEST,
    });

    // Explicit mapping wins over originalBody
    expect(built.max_output_tokens).toBe(4096);
    // But unmapped originalBody fields are still preserved
    expect(built.user).toBe('user-abc');
  });

  it('does not pollute cross-format (non-responses) transforms with originalBody fields', async () => {
    const transformer = new ResponsesTransformer();
    const unified = await transformer.parseRequest(RESPONSES_REQUEST);
    // Strip incomingApiType/originalBody to simulate a cross-format path
    // (e.g. chat -> responses), where the guard must not fire.
    const { incomingApiType, originalBody, ...rest } = unified;
    const built = await transformer.transformRequest(rest);

    expect(built.user).toBeUndefined();
    expect(built.store).toBeUndefined();
    expect(built.service_tier).toBeUndefined();
    expect(built.stream_options).toBeUndefined();
  });
});

describe('Anthropic -> Responses reasoning projection', () => {
  it('omits unified-only reasoning fields from the Responses payload', async () => {
    const unified = await parseAnthropicRequest({
      model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hello' }],
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
    });

    const built = await new ResponsesTransformer().transformRequest(unified);

    expect(built.reasoning).toEqual({ effort: 'high' });
    expect(built.reasoning).not.toHaveProperty('enabled');
    expect(built.reasoning).not.toHaveProperty('max_tokens');
  });

  it('uses the Responses off effort for explicitly disabled thinking', async () => {
    const unified = await parseAnthropicRequest({
      model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hello' }],
      thinking: { type: 'disabled' },
    });

    const built = await new ResponsesTransformer().transformRequest(unified);

    expect(built.reasoning).toEqual({ effort: 'none' });
  });

  it('leaves adaptive magnitude selection to registry auto-compat', async () => {
    const unified = await parseAnthropicRequest({
      model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hello' }],
      thinking: { type: 'adaptive' },
    });

    const built = await new ResponsesTransformer().transformRequest(unified);

    expect(built.reasoning).toBeUndefined();
  });
});

describe('parseRequest conditional-spread hygiene (omitted fields leave no own property)', () => {
  // Same rationale as the temperature test above: a phantom
  // `field: undefined` own property survives object spreads and flips
  // `'field' in x` / hasOwnProperty checks downstream even though JSON
  // serialization would drop it.
  const MINIMAL_REQUEST = {
    model: 'gpt-4o',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Hello' }],
      },
    ],
  };

  it('omitted optional client fields leave NO own property on the unified request', async () => {
    const transformer = new ResponsesTransformer();
    const unified = await transformer.parseRequest(MINIMAL_REQUEST);

    for (const field of [
      'requestId',
      'max_tokens',
      'temperature',
      'stream',
      'reasoning',
      'include',
      'prompt_cache_key',
      'text',
      'parallel_tool_calls',
      'metadata',
      'tools',
      'response_format',
    ]) {
      expect(field in unified, `'${field}' in unified must be false when omitted`).toBe(false);
    }
  });

  it('present tools still forward through the computed conversion (lock one example)', async () => {
    const transformer = new ResponsesTransformer();
    const unified = await transformer.parseRequest({
      ...MINIMAL_REQUEST,
      tools: [
        {
          type: 'function',
          name: 'get_weather',
          description: 'Get the weather',
          parameters: { type: 'object', properties: { city: { type: 'string' } } },
        },
      ],
    });

    expect('tools' in unified).toBe(true);
    expect(unified.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get the weather',
          parameters: { type: 'object', properties: { city: { type: 'string' } } },
        },
      },
    ]);
  });

  it('a present text.format still forwards as response_format (lock one example)', async () => {
    const transformer = new ResponsesTransformer();
    const unified = await transformer.parseRequest({
      ...MINIMAL_REQUEST,
      text: {
        format: {
          type: 'json_schema',
          name: 'result',
          schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
        },
      },
    });

    expect('response_format' in unified).toBe(true);
    expect(unified.response_format).toEqual({
      type: 'json_schema',
      json_schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
      name: 'result',
    });
  });

  it('an explicit stream:false still forwards as a real own property', async () => {
    const transformer = new ResponsesTransformer();
    const unified = await transformer.parseRequest({ ...MINIMAL_REQUEST, stream: false });

    expect('stream' in unified).toBe(true);
    expect(unified.stream).toBe(false);
  });

  describe('structured-output descriptor carry (text.format name/description/strict)', () => {
    // The Responses `text.format` structured-output descriptor is more than
    // the schema: clients also send `name`, `description`, and `strict`.
    // Discarding them forces the responses -> chat emission to fabricate
    // `name: "response_schema"` / `strict: true`, silently overriding what
    // the client asked for (e.g. strict: false).
    const DESCRIPTOR_REQUEST = {
      ...MINIMAL_REQUEST,
      text: {
        format: {
          type: 'json_schema',
          name: 'weather_report',
          description: 'A structured weather report',
          strict: false,
          schema: { type: 'object', properties: { temp: { type: 'number' } } },
        },
      },
    };

    it('parseRequest carries name/description/strict on the unified response_format', async () => {
      const unified = await new ResponsesTransformer().parseRequest(DESCRIPTOR_REQUEST);

      expect(unified.response_format).toEqual({
        type: 'json_schema',
        json_schema: { type: 'object', properties: { temp: { type: 'number' } } },
        name: 'weather_report',
        description: 'A structured weather report',
        strict: false,
      });
    });

    it('the outbound Chat payload emits the client-supplied descriptor values (responses -> chat)', async () => {
      const unified = await new ResponsesTransformer().parseRequest(DESCRIPTOR_REQUEST);
      const chatPayload = await new OpenAITransformer().transformRequest(unified);

      expect(chatPayload.response_format).toEqual({
        type: 'json_schema',
        json_schema: {
          name: 'weather_report',
          description: 'A structured weather report',
          schema: { type: 'object', properties: { temp: { type: 'number' } } },
          strict: false,
        },
      });
    });

    it('fallbacks apply ONLY when the client omitted the descriptor fields', async () => {
      const unified = await new ResponsesTransformer().parseRequest({
        ...MINIMAL_REQUEST,
        text: {
          format: {
            type: 'json_schema',
            schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
          },
        },
      });
      const chatPayload = await new OpenAITransformer().transformRequest(unified);

      expect(chatPayload.response_format).toEqual({
        type: 'json_schema',
        json_schema: {
          name: 'response_schema',
          schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
          strict: true,
        },
      });
    });

    it('strict: false survives to the outbound chat payload (must not be clobbered to true)', async () => {
      const unified = await new ResponsesTransformer().parseRequest(DESCRIPTOR_REQUEST);
      const chatPayload = await new OpenAITransformer().transformRequest(unified);

      expect(chatPayload.response_format.json_schema.strict).toBe(false);
    });
  });

  it('explicit values still forward (spot-check stream, max_output_tokens, metadata)', async () => {
    const transformer = new ResponsesTransformer();
    const unified = await transformer.parseRequest(RESPONSES_REQUEST);

    expect(unified.stream).toBe(true);
    expect(unified.max_tokens).toBe(1024);
    expect(unified.metadata).toEqual({ session: 's1' });
    expect(unified.reasoning).toEqual({ effort: 'medium' });
    expect(unified.include).toEqual(['reasoning.encrypted_content']);
    expect(unified.prompt_cache_key).toBe('cache-1');
    expect(unified.parallel_tool_calls).toBe(true);
    expect(unified.text).toEqual({ format: { type: 'text' } });
  });
});

describe('transformRequest stream-field hygiene (no phantom `stream: undefined`)', () => {
  // parseRequest already keeps an omitted client `stream` off the unified
  // request (see the conditional-spread tests above) — transformRequest must
  // not recreate it as a `stream: undefined` own property on the outbound
  // payload, which survives object spreads and flips `'stream' in x` checks
  // downstream even though JSON would drop it.
  const MINIMAL_REQUEST = {
    model: 'gpt-4o',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Hello' }],
      },
    ],
  };

  it('an omitted client stream leaves NO own `stream` property on the outbound payload', async () => {
    const transformer = new ResponsesTransformer();
    const unified = await transformer.parseRequest(MINIMAL_REQUEST);
    expect('stream' in unified).toBe(false);

    const built = await transformer.transformRequest(unified);
    expect('stream' in built).toBe(false);
  });

  it('an explicit stream:true still forwards', async () => {
    const transformer = new ResponsesTransformer();
    const unified = await transformer.parseRequest({ ...MINIMAL_REQUEST, stream: true });
    const built = await transformer.transformRequest(unified);
    expect(built.stream).toBe(true);
  });

  it('an explicit stream:false still forwards as a real own property', async () => {
    const transformer = new ResponsesTransformer();
    const unified = await transformer.parseRequest({ ...MINIMAL_REQUEST, stream: false });
    const built = await transformer.transformRequest(unified);
    expect('stream' in built).toBe(true);
    expect(built.stream).toBe(false);
  });
});
