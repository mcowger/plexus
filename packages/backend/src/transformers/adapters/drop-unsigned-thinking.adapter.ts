import { isAnthropicMessagesPayload } from '../../services/dispatch/dispatcher-auto-compat';
import type { ProviderAdapter } from '../../types/provider-adapter';
import { logger } from '../../utils/logger';

/**
 * drop_unsigned_thinking adapter
 *
 * Removes `thinking` blocks that carry no `signature` from an Anthropic
 * Messages body.
 *
 * Why this exists:
 *
 * Anthropic requires a `signature` on every `thinking` block and rejects the
 * whole request otherwise:
 *
 *   messages.N.content.0.thinking.signature: Field required
 *
 * Unsigned thinking reaches an Anthropic-shaped body through two routes:
 *
 *   1. Cross-format transforms. An OpenAI-style client replays
 *      `reasoning_content` on assistant messages (typically produced by a
 *      reasoning fallback target such as deepseek). The openai transformer maps
 *      it to `thinking: { content }` with no signature, and
 *      `transformers/anthropic/request-builder.ts` emits that block without a
 *      signature — deliberately, since not every Messages-format upstream
 *      shares Anthropic's rule (Kimi/Moonshot requires unsigned thinking to
 *      stay present on historical assistant turns).
 *   2. The messages -> messages pass-through, where the client body is
 *      forwarded verbatim and a client may replay thinking it never had signed.
 *
 * Every turn on the Anthropic target then fails, the dispatcher falls back to
 * the reasoning target, and the session accumulates a mixed history that no
 * target accepts. Unsigned reasoning is optional context that cannot be
 * reconstructed, so it is dropped rather than sent.
 *
 * Where it is injected: `adapter-resolver.ts` adds this adapter implicitly under
 * the same gate as `normalize_anthropic_tool_ids` (outbound wire format is
 * Messages AND the target looks like Anthropic). Other Messages-speaking
 * upstreams are left untouched. A provider- or model-level `adapter` entry
 * overrides that in both directions.
 *
 * Only blocks of type `thinking` without a usable signature are touched: a
 * signed block, a `redacted_thinking` block and every other block type are
 * preserved as-is. The predicate is role-agnostic: a `thinking` block in a user
 * turn is rejected by Anthropic whatever its signature, so there is nothing to
 * preserve there.
 *
 * A turn that held nothing but unsigned thinking loses all of its content. Such
 * a turn is dropped and the same-role turns it used to separate are MERGED,
 * because dropping it alone would leave two consecutive `user` (or `assistant`)
 * turns, which Anthropic also rejects. This is deliberately not the
 * `[reasoning elided]` placeholder of `stripThinkingSignatureBlocks`: that
 * helper serves the reactive stale-signature repair, this adapter rewrites every
 * request up front, and fabricating a text block the client never wrote would
 * show up in every replayed history. The merge cannot orphan a `tool_result`
 * either — a turn that still carried a `tool_use` block is never emptied.
 *
 * Inbound (postDispatch) and stream hooks: no-op (request-side repair only).
 */

/** True for a `thinking` block that carries no usable Anthropic signature. */
export function isUnsignedThinkingBlock(block: any): boolean {
  return (
    !!block &&
    typeof block === 'object' &&
    block.type === 'thinking' &&
    !(typeof block.signature === 'string' && block.signature.length > 0)
  );
}

/** Anthropic only enforces alternation between these two roles. */
function isAlternatingRole(role: unknown): boolean {
  return role === 'user' || role === 'assistant';
}

/** Normalizes a message's `content` to a block array so two turns can be merged. */
function toContentBlocks(content: any): any[] {
  if (Array.isArray(content)) return content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return [];
}

export interface UnsignedThinkingStripResult {
  /** The rewritten payload, or the input reference when nothing was dropped. */
  payload: Record<string, any>;
  /** Number of `thinking` blocks removed. */
  droppedBlockCount: number;
  /** Number of turns dropped because nothing but unsigned thinking remained. */
  droppedTurnCount: number;
}

/**
 * Drops unsigned `thinking` blocks from every message's `content`, copy-on-write
 * (the input payload, its `messages` array and its message objects are never
 * mutated — the payload can share them with the long-lived `UnifiedChatRequest`).
 * Only messages whose content changed are cloned; the rest are shared.
 */
export function dropUnsignedThinkingBlocks(
  payload: Record<string, any>
): UnsignedThinkingStripResult {
  const unchanged = { payload, droppedBlockCount: 0, droppedTurnCount: 0 };
  if (!isAnthropicMessagesPayload(payload)) return unchanged;

  let droppedBlockCount = 0;
  const perMessage = payload.messages.map((message: any) => {
    if (!message || !Array.isArray(message.content)) {
      return { message, content: message?.content, isArrayContent: false, changed: false };
    }
    const kept = message.content.filter((block: any) => {
      if (!isUnsignedThinkingBlock(block)) return true;
      droppedBlockCount++;
      return false;
    });
    return {
      message,
      content: kept,
      isArrayContent: true,
      changed: kept.length !== message.content.length,
    };
  });

  if (droppedBlockCount === 0) return unchanged;

  let droppedTurnCount = 0;
  // Set when a turn was dropped, so the very next kept turn knows it has to be
  // merged with the turn before it rather than pushed as a neighbour.
  let mergeWithPrevious = false;
  const messages: any[] = [];

  for (const { message, content, isArrayContent, changed } of perMessage) {
    if (isArrayContent && changed && content.length === 0) {
      // Nothing but unsigned thinking in this turn: drop it, the next kept turn
      // merges into its predecessor to keep the roles alternating.
      droppedTurnCount++;
      mergeWithPrevious = true;
      continue;
    }

    const previous = messages[messages.length - 1] as any;
    if (
      mergeWithPrevious &&
      previous &&
      isAlternatingRole(previous.role) &&
      previous.role === message.role
    ) {
      // Same-role neighbours are exactly what Anthropic rejects
      // (consecutive `user` turns after a dropped assistant turn). Concatenating
      // the blocks keeps every `tool_result` attached to the turn it followed,
      // so no `tool_use` is left unanswered.
      messages[messages.length - 1] = {
        ...previous,
        content: [...toContentBlocks(previous.content), ...toContentBlocks(content)],
      };
    } else {
      // Untouched messages (including non-array content) are shared, not cloned.
      messages.push(changed ? { ...message, content } : message);
    }
    mergeWithPrevious = false;
  }

  return {
    payload: { ...payload, messages },
    droppedBlockCount,
    droppedTurnCount,
  };
}

export const dropUnsignedThinkingAdapter: ProviderAdapter = {
  name: 'drop_unsigned_thinking',

  preDispatch(payload: Record<string, any>): Record<string, any> {
    const {
      payload: rewritten,
      droppedBlockCount,
      droppedTurnCount,
    } = dropUnsignedThinkingBlocks(payload);
    if (droppedBlockCount > 0) {
      logger.warn(
        `drop_unsigned_thinking: dropped ${droppedBlockCount} unsigned thinking block(s) ` +
          `and ${droppedTurnCount} emptied turn(s) (model=${payload?.model ?? 'unknown'})`
      );
    }
    return rewritten;
  },

  postDispatch(response: Record<string, any>): Record<string, any> {
    return response;
  },
};
