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
});
