import type { UnifiedChatRequest } from './unified';

/**
 * ProviderAdapter
 *
 * A programmatic hook that rewrites request payloads outbound to a provider
 * and raw response payloads inbound from a provider.
 *
 * Adapters are resolved per-dispatch based on provider- and model-level config,
 * then applied in order on preDispatch and in reverse on postDispatch.
 *
 * Implementing preDispatch/postDispatch is mandatory. Stream chunk hooks are
 * optional — omitting them means stream chunks pass through unmodified.
 */
export interface ProviderAdapter {
  /** Unique registry key (matches config adapter name). */
  readonly name: string;

  /**
   * Rewrite the unified request before it is sent to the provider.
   * Called after transformRequest(), before the HTTP call.
   * Must return a (potentially new) provider payload object.
   */
  preDispatch(payload: Record<string, any>): Record<string, any>;

  /**
   * Rewrite the raw provider JSON response before it is passed to
   * transformResponse(). Called only for non-streaming responses.
   * Must return a (potentially new) response object.
   */
  postDispatch(response: Record<string, any>): Record<string, any>;

  /**
   * Rewrite a raw SSE line (e.g. `data: {...}`) on its way out of the
   * provider, before transformStream() consumes it.
   * Return the line unchanged if no rewrite is needed.
   */
  preDispatchStreamChunk?(line: string): string;

  /**
   * Rewrite a raw SSE line after transformStream() / formatStream() have
   * produced it, just before it is written to the client.
   * Return the line unchanged if no rewrite is needed.
   */
  postDispatchStreamChunk?(line: string): string;
}
