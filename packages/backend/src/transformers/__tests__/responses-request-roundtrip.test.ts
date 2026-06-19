import { describe, it, expect } from 'vitest';
import { ResponsesTransformer } from '../responses';

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
  input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hello' }] }],
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
