import { createHash } from 'node:crypto';

import type { ProviderAdapter } from '../../types/provider-adapter';
import { logger } from '../../utils/logger';

/**
 * normalize_anthropic_tool_ids adapter
 *
 * Rewrites `tool_use` / `tool_result` identifiers inside an Anthropic Messages
 * body so they satisfy Anthropic's tool-id charset constraint
 * `^[a-zA-Z0-9_-]+$`.
 *
 * Why this exists:
 *
 * Anthropic rejects any tool id outside that charset with a hard HTTP 400, e.g.
 * `messages.222.content.1.tool_use.id: String should match pattern
 * '^[a-zA-Z0-9_-]+$'`. Plenty of foreign providers mint ids that violate it —
 * Moonshot/Kimi emits `functions.WebSearch:3`, pi-ai replays composite
 * `call_x|fc_y` ids, and Gemini uses the dotted tool name as the id. Those ids
 * reach an Anthropic-shaped body through two separate routes:
 *
 *   1. The messages -> messages pass-through, where the dispatcher forwards a
 *      verbatim deep clone of the client body (`request-payload-builder.ts`)
 *      and `transformers/anthropic/request-builder.ts` never runs at all. A
 *      client that accumulated foreign ids in an earlier turn replays them
 *      here untouched.
 *   2. Cross-format transforms, which carry the upstream id straight across
 *      from `tool_calls[].id` / `tool_call_id`.
 *
 * Why proactive rather than reactive (strip-and-retry on the 400):
 *
 *   - Claude-Code masking computes its billing signature during
 *     `prepareNativeOAuthDispatch`, which runs *after* adapters. Mutating the
 *     body post-signing would invalidate that signature, so the rewrite has to
 *     happen up front.
 *   - Failover cannot rescue the request either: every Anthropic
 *     messages-format target enforces the same charset, so the identical body
 *     400s on each attempt.
 *
 * Where it is injected: `adapter-resolver.ts` adds this adapter implicitly only
 * when the outbound wire format is Anthropic Messages AND the target looks like
 * Anthropic (anthropic.com base URL, Anthropic OAuth, or Claude masking) —
 * other Messages-speaking proxies do not enforce the charset. A provider- or
 * model-level `adapter` entry overrides that either way
 * (`{ name, options: {}, enabled: true }` to force it on, `{ name, enabled:
 * false }` to opt out).
 *
 * (Same decision rule as the NOTE in
 * `suppress-unsupported-gpt5-options.adapter.ts`: strip statically when every
 * upstream on the path rejects the shape, reactively when only some do.)
 *
 * Outbound (preDispatch): rewrites offending ids in place and emits one warn
 * summarising the count. Ids already inside the charset — including Anthropic's
 * own `toolu_` / `srvtoolu_` ids of any length — are never touched.
 *
 * Inbound (postDispatch) and stream hooks: no-op. This is a request-side-only
 * repair, and adapters run in reverse on the way back, so identity is correct.
 */

const ANTHROPIC_TOOL_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const ANTHROPIC_TOOL_ID_MAX_LENGTH = 64;
const HASH_SUFFIX_LENGTH = 8;

const TOOL_USE_BLOCK_TYPES = new Set(['tool_use', 'server_tool_use', 'mcp_tool_use']);
const TOOL_RESULT_BLOCK_TYPES = new Set(['tool_result', 'mcp_tool_result']);

/**
 * Coerces a non-string id to the string the hash is taken over.
 *
 * `String(value)` runs VALUE-CONTROLLED coercion, and the value here came
 * straight off a client request body: `{"id": {"toString": null}}` is valid
 * JSON that parses fine and then makes `String()` throw a TypeError, which
 * would surface as an internal error mid-dispatch instead of a sanitized id.
 * Anything that refuses to coerce falls back to a per-`typeof` marker, keeping
 * the sanitizer total. All uncoercible values of one typeof therefore collapse
 * onto a single id — acceptable for input that is already garbage, since
 * determinism (the same input always yielding the same id) is the property
 * that matters, not distinctness.
 */
function coerceToolIdToString(id: unknown): string {
  try {
    return String(id);
  } catch {
    return `[uncoercible ${typeof id}]`;
  }
}

/**
 * Maps any value onto an id matching `^[a-zA-Z0-9_-]+$` and at most 64 chars.
 *
 * The function is pure and deterministic, which is what makes it safe without
 * any cross-turn bookkeeping: a `tool_use.id` and the `tool_result.tool_use_id`
 * that references it start from the same original string, so they always land
 * on the same sanitized value — across turns, retries and failover attempts,
 * with no id map to keep in sync.
 *
 * The hash suffix is taken over the ORIGINAL input, not the replaced form, so
 * ids that collapse together under character replacement (`a.b` and `a:b` both
 * become `a_b`) stay distinct. Every generated output is itself charset-valid,
 * so the function is idempotent: f(f(x)) === f(x).
 */
export function sanitizeAnthropicToolId(id: unknown): string {
  if (typeof id === 'string' && ANTHROPIC_TOOL_ID_PATTERN.test(id)) return id;

  // The hash is taken over UTF-16 code units, not `update(<string>)`'s implicit
  // UTF-8 encoding. UTF-8 is LOSSY for the malformed UTF-16 a JSON string can
  // legally carry: every lone surrogate encodes as U+FFFD, so `"\ud800"`,
  // `"\ud801"` and `"�"` would all hash identically and collide onto one
  // id. `utf16le` round-trips every code unit, so distinct inputs stay
  // distinct. Applied uniformly (well-formed strings too) — one path is
  // simpler than two, and only determinism matters here; nothing outside this
  // process ever recomputes these hashes.
  const hash8 = createHash('sha256')
    .update(Buffer.from(typeof id === 'string' ? id : coerceToolIdToString(id), 'utf16le'))
    .digest('hex')
    .slice(0, HASH_SUFFIX_LENGTH);

  if (typeof id !== 'string' || id.length === 0) return `tool_${hash8}`;

  const replaced = id.replace(/[^a-zA-Z0-9_-]/g, '_');
  // Truncate the prefix, never the suffix, so the disambiguating hash survives.
  const prefix = replaced.slice(0, ANTHROPIC_TOOL_ID_MAX_LENGTH - HASH_SUFFIX_LENGTH - 1);
  return `${prefix}_${hash8}`;
}

/**
 * Rewrites offending tool ids inside `payload.messages[].content[]` in place and
 * returns how many were changed.
 *
 * Scope is deliberately narrow — only ids nested inside message content blocks.
 * `system`, `tools`, `tool_choice`, message-level fields (chat-format
 * `tool_calls[]` / `tool_call_id` live there, and the OpenAI wire has no such
 * charset rule) and top-level ids are all left alone.
 *
 * `tool_use_id` is rewritten whenever it is a string, regardless of block type.
 * That covers result blocks this list doesn't enumerate
 * (`web_search_tool_result`, `code_execution_tool_result`, ...) and keeps every
 * reference consistent with its `tool_use` partner; for the valid `srvtoolu_`
 * ids those blocks normally carry it is a no-op.
 */
export function normalizeAnthropicToolIds(payload: Record<string, any>): number {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.messages)) return 0;

  let rewrittenCount = 0;

  for (const message of payload.messages) {
    if (!message || typeof message !== 'object' || !Array.isArray(message.content)) continue;

    for (const block of message.content) {
      if (!block || typeof block !== 'object') continue;

      if (TOOL_USE_BLOCK_TYPES.has(block.type) && block.id !== undefined) {
        const sanitized = sanitizeAnthropicToolId(block.id);
        if (sanitized !== block.id) {
          block.id = sanitized;
          rewrittenCount++;
        }
      }

      if (
        typeof block.tool_use_id === 'string' ||
        (TOOL_RESULT_BLOCK_TYPES.has(block.type) && block.tool_use_id !== undefined)
      ) {
        const sanitized = sanitizeAnthropicToolId(block.tool_use_id);
        if (sanitized !== block.tool_use_id) {
          block.tool_use_id = sanitized;
          rewrittenCount++;
        }
      }
    }
  }

  return rewrittenCount;
}

export const normalizeAnthropicToolIdsAdapter: ProviderAdapter = {
  name: 'normalize_anthropic_tool_ids',

  // Mutating in place is safe here: at the adapter hook the payload is always
  // attempt-local — either a fresh deep clone of the client body or freshly
  // built transformer output (see request-payload-builder.ts).
  preDispatch(payload: Record<string, any>): Record<string, any> {
    const rewrittenCount = normalizeAnthropicToolIds(payload);
    if (rewrittenCount > 0) {
      logger.warn(
        `normalize_anthropic_tool_ids: rewrote ${rewrittenCount} tool id(s) to Anthropic charset ` +
          `(model=${payload?.model ?? 'unknown'})`
      );
    }
    return payload;
  },

  postDispatch(response: Record<string, any>): Record<string, any> {
    return response;
  },
};
