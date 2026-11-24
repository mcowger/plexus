import type { ProviderAdapter } from '../../types/provider-adapter';

/**
 * strip_cache_control adapter
 *
 * Removes Anthropic `cache_control` markers from a request body whose outbound
 * wire is NOT Anthropic Messages.
 *
 * Why this exists: the Anthropic transformer deliberately keeps `cache_control`
 * in the unified layer so Claude targets get cache hits. Chat-completions
 * upstreams (Mistral, Ollama, ...) reject the unknown field with HTTP 422
 * (`extra_forbidden` on `messages.N.content.M.cache_control`).
 *
 * Auto-injected by `adapter-resolver.ts` when the final outbound wire type is
 * not `messages`, so it is per-target: an alias that routes to Claude first
 * and Mistral last keeps its markers on Claude and loses them on Mistral.
 *
 * Touched: top-level `cache_control`, message / system / Responses input
 * entries, their content blocks (and blocks nested in `content`), and
 * top-level tool entries. Tool JSON schemas are never walked, so a parameter
 * named `cache_control` survives. Unchanged payloads keep their reference.
 */
export const stripCacheControlAdapter: ProviderAdapter = {
  name: 'strip_cache_control',

  preDispatch(payload: Record<string, any>): Record<string, any> {
    if (!payload || typeof payload !== 'object') return payload;
    let out = payload;
    const set = (key: string, value: unknown) => {
      if (value !== payload[key]) out = { ...out, [key]: value };
    };

    if ('cache_control' in payload) {
      const { cache_control: _drop, ...rest } = out;
      out = rest;
    }
    for (const key of ['messages', 'input']) {
      if (Array.isArray(payload[key])) set(key, mapArray(payload[key], stripEntry));
    }
    if (Array.isArray(payload.system)) set('system', mapArray(payload.system, stripEntry));
    if (Array.isArray(payload.tools)) set('tools', mapArray(payload.tools, stripTool));
    return out;
  },

  postDispatch(response: Record<string, any>): Record<string, any> {
    return response;
  },
};

/** Maps an array copy-on-write: returns the input reference when nothing changed. */
function mapArray(items: any[], fn: (item: any) => any): any[] {
  let changed = false;
  const mapped = items.map((item) => {
    const next = fn(item);
    if (next !== item) changed = true;
    return next;
  });
  return changed ? mapped : items;
}

function withoutCacheControl(obj: Record<string, any>): Record<string, any> {
  const { cache_control: _drop, ...rest } = obj;
  return rest;
}

/** Message, system block, content block or tool_result block (recurses into `content`). */
function stripEntry(entry: any): any {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
  let out = entry;
  if ('cache_control' in out) out = withoutCacheControl(out);
  if (Array.isArray(entry.content)) {
    const content = mapArray(entry.content, stripEntry);
    if (content !== entry.content) out = { ...out, content };
  }
  return out;
}

function stripTool(tool: any): any {
  if (!tool || typeof tool !== 'object') return tool;
  let out = tool;
  if ('cache_control' in out) out = withoutCacheControl(out);
  if (tool.function && typeof tool.function === 'object' && 'cache_control' in tool.function) {
    out = { ...out, function: withoutCacheControl(tool.function) };
  }
  return out;
}
