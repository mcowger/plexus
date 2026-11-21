import type { ProviderAdapter } from '../../types/provider-adapter';

function isDeveloperInputMessage(item: unknown): item is Record<string, unknown> {
  return (
    item != null &&
    typeof item === 'object' &&
    (!('type' in item) || item.type === undefined || item.type === 'message') &&
    'role' in item &&
    item.role === 'developer'
  );
}

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

  preDispatch(payload: Record<string, any>, _options?: Record<string, any>): Record<string, any> {
    const hasMessages = Array.isArray(payload.messages);
    const hasDeveloperInput =
      Array.isArray(payload.input) && payload.input.some(isDeveloperInputMessage);
    if (!hasMessages && !hasDeveloperInput) return payload;

    const result = { ...payload };
    if (hasMessages) {
      result.messages = payload.messages.map((msg: { role: string }) => {
        if (msg.role !== 'developer') return msg;
        return { ...msg, role: 'system' };
      });
    }
    if (hasDeveloperInput) {
      result.input = payload.input.map((item: unknown) => {
        if (!isDeveloperInputMessage(item)) return item;
        return { ...item, role: 'system' };
      });
    }
    return result;
  },

  postDispatch(response: Record<string, any>, _options?: Record<string, any>): Record<string, any> {
    return response;
  },

  preDispatchStreamChunk(line: string, _options?: Record<string, any>): string {
    if (!line.startsWith('data:')) return line;
    return line.replace(/"role":"developer"/g, '"role":"system"');
  },
};
