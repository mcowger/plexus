import type { ProviderAdapter } from '../../types/provider-adapter';

const GPT5_UNSUPPORTED_OPTIONS = [
  'temperature',
  'top_p',
  'logprobs',
  'top_logprobs',
  'frequency_penalty',
  'presence_penalty',
  'logit_bias',
  'truncation',
  'max_output_tokens',
  'max_completion_tokens',
] as const;

export function stripUnsupportedGpt5Options(payload: Record<string, any>): Record<string, any> {
  const next = { ...payload };
  for (const option of GPT5_UNSUPPORTED_OPTIONS) delete next[option];
  return next;
}

export const suppressUnsupportedGpt5OptionsAdapter: ProviderAdapter = {
  name: 'suppress_unsupported_gpt5_options',

  preDispatch(payload: Record<string, any>): Record<string, any> {
    return stripUnsupportedGpt5Options(payload);
  },

  postDispatch(response: Record<string, any>): Record<string, any> {
    return response;
  },
};
