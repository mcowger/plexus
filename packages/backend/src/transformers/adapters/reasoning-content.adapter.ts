import type { ProviderAdapter } from '../../types/provider-adapter';

/**
 * reasoning_content adapter
 *
 * Handles providers (e.g. Fireworks) that use `reasoning_content` instead of
 * the `reasoning` field name used by mainstream OpenAI-compatible clients.
 *
 * Outbound (preDispatch):
 *   - On assistant messages: `reasoning` → `reasoning_content`
 *   - On assistant messages: `thinking.content` → `reasoning_content` (if no `reasoning` present)
 *
 * Inbound (postDispatch):
 *   - On response choices: `reasoning_content` → `reasoning`
 *
 * Stream (preDispatchStreamChunk):
 *   - Rewrites `"reasoning_content":` → `"reasoning":` in raw SSE lines
 *   - This covers both delta fields in streaming chunks
 *
 * Stream (postDispatchStreamChunk):
 *   - Not needed: by the time postDispatchStreamChunk runs the provider has
 *     already emitted `reasoning_content`; preDispatchStreamChunk handles it.
 */
export const reasoningContentAdapter: ProviderAdapter = {
  name: 'reasoning_content',

  preDispatch(payload: Record<string, any>): Record<string, any> {
    if (!Array.isArray(payload.messages)) return payload;

    const messages = payload.messages.map((msg: any) => {
      if (msg.role !== 'assistant') return msg;

      // Priority: explicit `reasoning` field first, then `thinking.content`
      const reasoningValue =
        msg.reasoning !== undefined
          ? msg.reasoning
          : msg.thinking?.content !== undefined
            ? msg.thinking.content
            : undefined;

      if (reasoningValue === undefined) return msg;

      const { reasoning: _r, thinking: _t, ...rest } = msg;
      return { ...rest, reasoning_content: reasoningValue };
    });

    return { ...payload, messages };
  },

  postDispatch(response: Record<string, any>): Record<string, any> {
    // The OpenAI transformer's transformResponse() already reads
    // `message.reasoning_content` natively, so no field rename is needed
    // on the inbound path. This is intentionally a no-op.
    return response;
  },

  preDispatchStreamChunk(line: string): string {
    // Replace `"reasoning":` with `"reasoning_content":` in the JSON payload
    // of SSE data lines so the provider receives the correct field name.
    if (!line.startsWith('data:')) return line;
    return line.replace(/"reasoning":/g, '"reasoning_content":');
  },
};
