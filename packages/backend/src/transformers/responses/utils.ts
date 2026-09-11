import {
  UnifiedClientToolCall,
  UnifiedImageGenerationCall,
  UnifiedUsage,
} from '../../types/unified';

/**
 * Generates unique response ID
 */
export function generateResponseId(): string {
  return `resp_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Generates unique item ID with prefix
 */
export function generateItemId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Projects a completed image_generation_call output item (with a non-empty
 * base64 `result`) onto the typed unified carry — see
 * UnifiedImageGenerationCall in types/unified.ts. The `result` is carried
 * byte-intact: the inline size cap applies only to the chat-format markdown
 * rendering (see transformers/image-rendering.ts), never to the typed item.
 */
export function toUnifiedImageGenerationCall(
  item: Record<string, unknown>
): UnifiedImageGenerationCall {
  return {
    ...(typeof item.id === 'string' ? { id: item.id } : {}),
    ...(typeof item.status === 'string' ? { status: item.status } : {}),
    result: typeof item.result === 'string' ? item.result : String(item.result ?? ''),
  };
}

/**
 * Rebuilds the wire `usage` object for every Responses-format payload we
 * emit (the unary `formatResponse` body and each terminal streaming event:
 * response.completed on stream end, response.completed on finish_reason,
 * response.incomplete and response.failed). Single source of truth so the
 * four sites can never drift apart.
 *
 * `input_tokens` is the TOTAL input (uncached + cached + cache writes),
 * matching the Responses API contract, because the unified layer carries
 * those split out (see normalizeOpenAIResponsesUsage).
 *
 * `image_tokens` is emitted inside the detail blocks ONLY when the unified
 * usage actually carries it — providers that report no image tokens (every
 * text-only turn) must produce exactly the payload they produced before this
 * field existed, so an omitted detail stays omitted rather than becoming 0.
 */
export function buildResponsesUsagePayload(
  usage: UnifiedUsage | null | undefined
): Record<string, unknown> | undefined {
  if (!usage) return undefined;

  return {
    input_tokens:
      (usage.input_tokens || 0) + (usage.cached_tokens || 0) + (usage.cache_creation_tokens || 0),
    output_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens,
    input_tokens_details: {
      cached_tokens: usage.cached_tokens || 0,
      ...(usage.input_image_tokens !== undefined ? { image_tokens: usage.input_image_tokens } : {}),
    },
    output_tokens_details: {
      reasoning_tokens: usage.reasoning_tokens || 0,
      ...(usage.output_image_tokens !== undefined
        ? { image_tokens: usage.output_image_tokens }
        : {}),
    },
  };
}

/**
 * True for a built-in Responses output item whose execution the model has
 * delegated to the CLIENT (`execution: "client"`, e.g. `tool_search_call`).
 * These are pending tool calls the caller must act on to continue the turn —
 * unlike server-executed built-ins (web_search_call, etc.) — so they need the
 * same "keep this and tell the client" treatment as a function_call rather
 * than being silently dropped as an unrecognized item type. Keyed on the
 * `execution` discriminator (not a type allowlist) so future built-in
 * client-executed tool types are handled automatically, plus a `_call`
 * suffix check so a provider that ever stamps `execution` on some unrelated
 * item type can't be misread as a tool call. Accepts either `call_id` or
 * `id` (falling back between them — see `clientToolCallKey` below) rather
 * than requiring `call_id` specifically: every item observed on the wire so
 * far has both, but requiring one exclusively risks silently dropping an
 * item that only has the other, which is exactly the failure mode this
 * carry exists to prevent.
 */
export function isClientExecutedToolItem(item: unknown): item is UnifiedClientToolCall {
  if (!item || typeof item !== 'object') {
    return false;
  }
  const candidate = item as Record<string, unknown>;
  return (
    candidate.execution === 'client' &&
    typeof candidate.type === 'string' &&
    candidate.type.endsWith('_call') &&
    (typeof candidate.call_id === 'string' || typeof candidate.id === 'string')
  );
}

/**
 * Identifier used to dedupe a client-executed tool-call item between its
 * streamed `response.output_item.done` event and the `response.completed`
 * fallback loop — prefers `id` (the item's own identity) and falls back to
 * `call_id` when `id` is absent, so an item missing either field still gets
 * a stable dedupe key instead of silently bypassing the dedupe check (which
 * would emit it twice) or being dropped entirely.
 */
export function clientToolCallKey(item: unknown): string | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const candidate = item as Record<string, unknown>;
  if (typeof candidate.id === 'string') return candidate.id;
  if (typeof candidate.call_id === 'string') return candidate.call_id;
  return undefined;
}
