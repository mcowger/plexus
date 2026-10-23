/**
 * Prompt-cache breakpoint injection for translated Messages requests.
 *
 * An Anthropic prompt cache is a prefix cache keyed on `cache_control`
 * breakpoints. A request that arrives on `/v1/chat/completions` or
 * `/v1/responses` and is translated to Messages never carries breakpoints (the
 * incoming formats have no way to express them), so every turn pays full input
 * price. This module fills those breakpoints in at the highest-value positions.
 *
 * Placement follows Anthropic's render order — `tools` → `system` → `messages`
 * — and the documented cap of four breakpoints per request:
 *
 *   1. the last tool definition (caches the whole tools block, the most
 *      stable and most expensive part of an agent prompt),
 *   2. the last `system` text block,
 *   3. the trailing message(s), walking back from the end of the conversation.
 *
 * The third position is the "walking" breakpoint: it needs no per-turn state.
 * Anthropic hashes cumulative prefixes, so a breakpoint that is always on the
 * current turn advances by itself. Two trailing marks are used by default
 * because each breakpoint only looks 20 blocks back for a previously written
 * prefix: `messages[-1]` anchors the current turn, while `messages[-2]` still
 * points at the previous turn's end and therefore matches last turn's write
 * exactly, even when a turn emits more than 20 blocks (large tool results).
 *
 * Guard rails, all deliberate:
 *   - only translated requests targeting Messages are touched; a native
 *     Messages client owns its own breakpoints,
 *   - a request that already carries any breakpoint (message-level, block-level,
 *     tool-level, or Anthropic's top-level automatic-caching field) is left
 *     completely untouched,
 *   - only cacheable block types are marked (`thinking` / `redacted_thinking`
 *     are skipped), and nothing is ever mutated in place.
 *
 * Payload shapes are typed loosely (`any`) on purpose: this operates on the
 * provider-specific Messages wire body, which the transformer builders and the
 * pass-through path both produce as untyped JSON (the transformer layer types
 * its payloads the same way). Narrowing to `unknown` here would only push the
 * casts into the helpers without adding safety, so the runtime checks below
 * are the actual contract.
 */

import { getApiBaseType } from '../../utils/api-format';
import { logger } from '../../utils/logger';

/** Anthropic's documented maximum number of `cache_control` breakpoints per request. */
export const MAX_CACHE_BREAKPOINTS = 4;

/** Default trailing (walking) breakpoint count — see the module comment. */
export const DEFAULT_MESSAGE_BREAKPOINTS = 2;

export type CacheControlTtl = '5m' | '1h';

export interface CacheControlMarker {
  type: 'ephemeral';
  ttl?: CacheControlTtl;
}

export interface CacheControlInjectionOptions {
  /** Mark the last tool definition. Defaults to true. */
  tools?: boolean;
  /** Mark the last system text block. Defaults to true. */
  system?: boolean;
  /** Number of trailing messages to mark. Defaults to 2. */
  messageBreakpoints?: number;
  /** Cache TTL. Omitted leaves Anthropic's default (5m). */
  ttl?: CacheControlTtl;
}

export interface CacheControlInjectionResult {
  payload: any;
  /** Human-readable positions that were marked, in the order they were marked. */
  sites: string[];
}

/**
 * Block types Anthropic accepts `cache_control` on. `thinking` and
 * `redacted_thinking` are deliberately absent, so a message ending on a
 * thinking block walks back to its last cacheable block instead.
 */
const CACHEABLE_BLOCK_TYPES = new Set(['text', 'image', 'document', 'tool_use', 'tool_result']);

function isNil(value: unknown): boolean {
  return value === undefined || value === null;
}

function hasBreakpoint(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !isNil((value as { cache_control?: unknown }).cache_control)
  );
}

/**
 * Counts every `cache_control` breakpoint already present in a Messages
 * payload, including the top-level (automatic caching) field, which Anthropic
 * counts against the same four-breakpoint budget.
 */
export function countCacheBreakpoints(payload: any): number {
  if (!payload || typeof payload !== 'object') return 0;

  let count = hasBreakpoint(payload) ? 1 : 0;

  if (Array.isArray(payload.tools)) {
    for (const tool of payload.tools) if (hasBreakpoint(tool)) count += 1;
  }
  if (Array.isArray(payload.system)) {
    for (const block of payload.system) if (hasBreakpoint(block)) count += 1;
  }
  if (Array.isArray(payload.messages)) {
    for (const message of payload.messages) {
      if (hasBreakpoint(message)) count += 1;
      if (!Array.isArray(message?.content)) continue;
      for (const block of message.content) if (hasBreakpoint(block)) count += 1;
    }
  }

  return count;
}

function buildMarker(ttl: CacheControlTtl | undefined): CacheControlMarker {
  // '5m' is Anthropic's default but is still forwarded explicitly when asked
  // for, so a mixed-TTL admin choice reaches the wire unchanged.
  return ttl === '5m' || ttl === '1h' ? { type: 'ephemeral', ttl } : { type: 'ephemeral' };
}

function isCacheableBlock(block: any): boolean {
  if (!block || typeof block !== 'object' || Array.isArray(block)) return false;
  if (!isNil(block.cache_control)) return false;
  if (!CACHEABLE_BLOCK_TYPES.has(block.type)) return false;
  if (block.type === 'text' && (typeof block.text !== 'string' || block.text.trim() === '')) {
    return false;
  }
  return true;
}

/** Returns the marked system value, or undefined when there is nothing to mark. */
function markSystem(system: any, marker: CacheControlMarker): any[] | undefined {
  if (Array.isArray(system)) {
    const blocks = [...system];
    for (let i = blocks.length - 1; i >= 0; i -= 1) {
      const block = blocks[i];
      if (
        block?.type === 'text' &&
        typeof block.text === 'string' &&
        block.text.trim() !== '' &&
        isNil(block.cache_control)
      ) {
        blocks[i] = { ...block, cache_control: marker };
        return blocks;
      }
    }
    return undefined;
  }

  if (typeof system === 'string' && system.trim() !== '') {
    // A bare string system prompt has nowhere to hang `cache_control`, so it
    // becomes the single-text-block form Anthropic also accepts.
    return [{ type: 'text', text: system, cache_control: marker }];
  }

  return undefined;
}

/** Returns the marked message, or null when the message cannot take a breakpoint. */
function markMessage(message: any, marker: CacheControlMarker): any | null {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  if (!isNil(message.cache_control)) return null;

  if (typeof message.content === 'string') {
    if (message.content.trim() === '') return null;
    return {
      ...message,
      content: [{ type: 'text', text: message.content, cache_control: marker }],
    };
  }

  if (!Array.isArray(message.content)) return null;

  const content = [...message.content];
  for (let i = content.length - 1; i >= 0; i -= 1) {
    if (!isCacheableBlock(content[i])) continue;
    content[i] = { ...content[i], cache_control: marker };
    return { ...message, content };
  }

  return null;
}

/**
 * Injects `cache_control` breakpoints into a translated Messages payload.
 *
 * Returns the original payload untouched (with an empty `sites` list) whenever
 * the request is out of scope or already carries breakpoints, so callers can
 * apply this unconditionally.
 */
export function injectCacheControlBreakpoints(
  payload: any,
  incomingApiType: string,
  targetApiType: string,
  options: CacheControlInjectionOptions = {}
): CacheControlInjectionResult {
  const unchanged: CacheControlInjectionResult = { payload, sites: [] };

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return unchanged;
  if (getApiBaseType(targetApiType) !== 'messages') return unchanged;
  if (getApiBaseType(incomingApiType) === 'messages') return unchanged;

  const existing = countCacheBreakpoints(payload);
  if (existing > 0) {
    logger.debug(
      `inject_cache_control: skipped, request already carries ${existing} breakpoint(s)`
    );
    return unchanged;
  }

  const marker = buildMarker(options.ttl);
  const sites: string[] = [];
  let result = payload;
  let remaining = MAX_CACHE_BREAKPOINTS;

  // 1. Tool definitions. Tools render first, so they anchor every later prefix.
  if (options.tools !== false && Array.isArray(result.tools) && result.tools.length > 0) {
    const tools = [...result.tools];
    const lastIndex = tools.length - 1;
    tools[lastIndex] = { ...tools[lastIndex], cache_control: marker };
    result = { ...result, tools };
    sites.push('tools');
    remaining -= 1;
  }

  // 2. System prompt. Its prefix includes the tools above, so tool churn
  //    already invalidates this one — nothing to do about that here.
  if (options.system !== false && remaining > 0) {
    const system = markSystem(result.system, marker);
    if (system !== undefined) {
      result = { ...result, system };
      sites.push('system');
      remaining -= 1;
    }
  }

  // 3. Trailing messages: current turn end, then the previous turn end(s).
  const requested = options.messageBreakpoints ?? DEFAULT_MESSAGE_BREAKPOINTS;
  const depth = Math.max(0, Math.min(Math.trunc(requested), remaining));
  if (depth > 0 && Array.isArray(result.messages)) {
    const messages = [...result.messages];
    // Collected deepest-first so the log reads in conversation order.
    const messageSites: string[] = [];
    let placed = 0;
    for (let i = messages.length - 1; i >= 0 && placed < depth; i -= 1) {
      const marked = markMessage(messages[i], marker);
      if (marked === null) continue;
      messages[i] = marked;
      placed += 1;
      messageSites.unshift(`messages[${i - messages.length}]`);
    }
    if (placed > 0) {
      result = { ...result, messages };
      sites.push(...messageSites);
    }
  }

  return { payload: result, sites };
}
