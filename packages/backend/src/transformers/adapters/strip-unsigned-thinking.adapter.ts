import type { ProviderAdapter } from '../../types/provider-adapter';
import { stripThinkingSignatureBlocks } from '../../services/dispatch/dispatcher-auto-compat';
import { logger } from '../../utils/logger';

/**
 * strip_unsigned_thinking adapter
 *
 * Removes `thinking` blocks that carry no `signature` from an Anthropic
 * Messages body before it is sent to a target known to be Anthropic itself.
 *
 * Why this exists:
 *
 * Anthropic requires every `thinking` block to carry the `signature` it issued
 * with it, and hard-400s without one:
 *
 *   messages.N.content.0.thinking.signature: Field required
 *
 * A signature goes missing when conversation history reached Plexus on a wire
 * format that has nowhere to carry it. OpenAI chat-completions exposes prior
 * reasoning only as `reasoning_content` text, so a client that generated
 * earlier turns with another model — or with Claude *through* Plexus on the
 * chat path — and then targets a Claude alias replays thinking that
 * `transformers/anthropic/request-builder.ts` cannot sign. New sessions work;
 * old sessions 400 on every turn.
 *
 * Why an adapter, not the shared builder:
 *
 * The Messages wire format is shared by Anthropic and by compatible endpoints
 * with different thinking semantics. Kimi's compatible endpoint, for one,
 * REQUIRES unsigned thinking to stay on historical assistant tool-call
 * messages. `buildAnthropicRequest()` does not know the concrete upstream, so
 * it preserves unsigned thinking, and the Anthropic-specific strip is applied
 * here — injected by `adapter-resolver.ts` only when the outbound wire format is
 * Anthropic Messages AND the target looks like Anthropic (`anthropic.com` base
 * URL, Anthropic OAuth, or Claude masking). Same gate and same override
 * channel as `normalize_anthropic_tool_ids`: `{ name, options: {}, enabled:
 * true }` forces it on for an Anthropic-compatible gateway on another host;
 * `{ name, enabled: false }` opts a detected-Anthropic route out.
 *
 * Why proactive rather than reactive only:
 *
 * The reactive strip-and-retry in `dispatcher-auto-compat.ts` also matches this
 * error and remains the fallback for strict or unknown gateways. But for a
 * target we already know is Anthropic, letting the first request fail just to
 * learn that is a wasted round trip on every turn of an affected session, and
 * Claude-Code masking signs the body after adapters run — mutating it on retry
 * post-signing is the case the tool-id normaliser had to avoid too.
 *
 * What is stripped:
 *
 * Only `thinking` blocks with no (or empty) `signature`. Signed blocks — which
 * Anthropic will validate itself — and `redacted_thinking` blocks (which carry
 * their own opaque `data`, not a `signature`) are left alone. Stripping reuses
 * `stripThinkingSignatureBlocks`, so a message emptied by the strip is dropped
 * unless doing so would break user/assistant alternation or orphan a
 * `tool_result`, in which case a `[reasoning elided]` placeholder is left in
 * its place.
 *
 * Inbound (postDispatch) and stream hooks: no-op. Request-side-only repair.
 */

export function isUnsignedThinkingBlock(block: any): boolean {
  return (
    !!block &&
    typeof block === 'object' &&
    block.type === 'thinking' &&
    (typeof block.signature !== 'string' || block.signature.length === 0)
  );
}

export const stripUnsignedThinkingAdapter: ProviderAdapter = {
  name: 'strip_unsigned_thinking',

  preDispatch(payload: Record<string, any>): Record<string, any> {
    const { payload: stripped, strippedCount } = stripThinkingSignatureBlocks(
      payload,
      isUnsignedThinkingBlock
    );
    if (strippedCount > 0) {
      logger.warn(
        `strip_unsigned_thinking: removed ${strippedCount} unsigned thinking block(s) that ` +
          `Anthropic would reject (model=${payload?.model ?? 'unknown'})`
      );
    }
    return stripped;
  },

  postDispatch(response: Record<string, any>): Record<string, any> {
    return response;
  },
};
