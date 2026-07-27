import { describe, expect, it } from 'vitest';
import { suppressUnsupportedGpt5OptionsAdapter } from '../suppress-unsupported-gpt5-options.adapter';

describe('suppressUnsupportedGpt5OptionsAdapter', () => {
  it('removes unsupported GPT-5 generation options and preserves other fields', () => {
    const payload = suppressUnsupportedGpt5OptionsAdapter.preDispatch({
      model: 'gpt-5.2',
      input: 'hello',
      temperature: 1,
      top_p: 0.9,
      logprobs: true,
      top_logprobs: 3,
      frequency_penalty: 0,
      presence_penalty: 0,
      logit_bias: { '1': 1 },
      truncation: 'auto',
      max_output_tokens: 10,
      max_completion_tokens: 10,
    });

    expect(payload).toEqual({ model: 'gpt-5.2', input: 'hello' });
  });

  // Updated LobeHub sends safety_identifier on gpt-5.5 traffic; some
  // configured upstreams 400 with "Unsupported parameter: safety_identifier".
  it('removes safety_identifier and preserves other fields', () => {
    const payload = suppressUnsupportedGpt5OptionsAdapter.preDispatch({
      model: 'gpt-5.5',
      input: 'hello',
      safety_identifier: 'user-hash-abc',
    });

    expect(payload).toEqual({ model: 'gpt-5.5', input: 'hello' });
  });

  // prompt_cache_key is intentionally NOT statically stripped: the
  // Codex-OAuth native path (oauth-native-request.ts) legitimately derives
  // its session-id/x-client-request-id headers from this field, and no
  // upstream has been observed rejecting it. A provider that does reject it
  // is handled by the reactive strip-and-retry in dispatcher-auto-compat.ts
  // instead (see planUnsupportedParamStrip / dispatcher-auto-compat.test.ts).
  it('preserves prompt_cache_key (not statically stripped)', () => {
    const payload = suppressUnsupportedGpt5OptionsAdapter.preDispatch({
      model: 'gpt-5.5',
      input: 'hello',
      safety_identifier: 'user-hash-abc',
      prompt_cache_key: 'cache-key-123',
    });

    expect(payload).toEqual({
      model: 'gpt-5.5',
      input: 'hello',
      prompt_cache_key: 'cache-key-123',
    });
  });
});
