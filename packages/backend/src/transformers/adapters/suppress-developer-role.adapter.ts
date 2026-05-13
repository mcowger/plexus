import type { ProviderAdapter } from '../../types/provider-adapter';

/**
 * suppress_developer_role adapter
 *
 * Some providers (e.g. those without the latest OpenAI API additions) do not
 * recognise the `developer` role introduced by OpenAI o-series models and
 * reject requests that include it.
 *
 * Outbound (preDispatch):
 *   - Any message with `role === 'developer'` is rewritten to `role === 'system'`
 *
 * Inbound (postDispatch): no-op — providers never emit a `developer` role.
 *
 * Stream (preDispatchStreamChunk):
 *   - Rewrites `"role":"developer"` → `"role":"system"` in raw SSE data lines.
 *   - In practice developer-role messages appear in the request only, so this
 *     is a belt-and-suspenders safeguard.
 */
export const suppressDeveloperRoleAdapter: ProviderAdapter = {
  name: 'suppress_developer_role',

  preDispatch(payload: Record<string, any>): Record<string, any> {
    if (!Array.isArray(payload.messages)) return payload;

    const messages = payload.messages.map((msg: any) => {
      if (msg.role !== 'developer') return msg;
      return { ...msg, role: 'system' };
    });

    return { ...payload, messages };
  },

  postDispatch(response: Record<string, any>): Record<string, any> {
    return response;
  },

  preDispatchStreamChunk(line: string): string {
    if (!line.startsWith('data:')) return line;
    return line.replace(/"role":"developer"/g, '"role":"system"');
  },
};
