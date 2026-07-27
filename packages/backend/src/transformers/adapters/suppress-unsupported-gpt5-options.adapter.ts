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
  // Client-only Responses API field some upstreams reject outright (e.g.
  // updated LobeHub sends this on gpt-5.5 traffic; ChatGPT/Codex-OAuth and
  // some aggregators 400 with "Unsupported parameter: safety_identifier").
  //
  // NOTE: prompt_cache_key is intentionally NOT in this static list.
  // oauth-native-request.ts's Codex-OAuth native path legitimately derives
  // its session-id/x-client-request-id headers from prompt_cache_key (it's
  // a real Codex CLI session/cache-correlation id), and no upstream has been
  // observed rejecting it. If one ever does, the reactive strip-and-retry in
  // dispatcher-auto-compat.ts (planUnsupportedParamStrip, wired in
  // standard-attempt-request.ts) strips it on that specific 400 instead of
  // unconditionally removing it from every GPT-5 request up front.
  'safety_identifier',
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
