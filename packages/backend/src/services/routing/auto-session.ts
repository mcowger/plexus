/**
 * Shared auto-session branch identity.
 *
 * Auto routing and cache-key injection must agree on which requests belong to
 * the same conversation branch. This helper is the single source of that
 * identity so the classifier's session cache and the runtime's cache/session
 * key do not drift apart.
 *
 * Precedence:
 *   1. Claude Code session hint, combined with the task's transcript anchor so
 *      subagents that inherit the parent `x-claude-code-session-id` do not
 *      reuse each other's judgment. The hint alone is not a branch key.
 *   2. Stable inbound affinity headers.
 *   3. Body `prompt_cache_key`.
 *   4. A hash of the first two messages: client-independent and stable across
 *      turns of the same conversation.
 *
 * `x-client-request-id` is deliberately excluded because it identifies a single
 * HTTP request, not a conversation, so using it would put every turn in its own
 * bucket. `previousResponseId` is likewise never used: it changes every turn.
 */

import { createHash } from 'node:crypto';
import type { UnifiedChatRequest } from '../../types/unified';

/** Stable inbound affinity headers, in precedence order. */
const STABLE_SESSION_HEADERS = [
  'session_id',
  'x-session-affinity',
  'x-session-id',
  'x-multi-turn-session-id',
  'x-opencode-session',
] as const;

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function hashAnchor(parts: unknown[]): string | undefined {
  if (parts.length === 0) return undefined;
  const encoded = JSON.stringify(parts);
  if (!encoded || encoded === '[]' || encoded === '[null]') return undefined;
  return createHash('sha256').update(encoded).digest('hex').slice(0, 32);
}

/** First user message content; stable across turns of one task/subagent. */
function taskAnchor(request: UnifiedChatRequest): string | undefined {
  const firstUser = (request.messages ?? []).find((message) => message.role === 'user');
  if (!firstUser) return undefined;
  return hashAnchor([firstUser.content]);
}

/** First two messages; client-independent conversation identity. */
function conversationAnchor(request: UnifiedChatRequest): string | undefined {
  const messages = request.messages ?? [];
  if (messages.length < 2) return undefined;
  return hashAnchor(messages.slice(0, 2));
}

/**
 * Derive the stable conversation branch for auto session state, or `undefined`
 * when the request carries no usable identity (branchless requests stay
 * stateless rather than sharing one global bucket).
 */
export function deriveAutoSessionBranch(request: UnifiedChatRequest): string | undefined {
  const claudeSession = trimToUndefined(request.claudeCodeSessionId);
  if (claudeSession) {
    const anchor = taskAnchor(request);
    return anchor ? `cc:${claudeSession}:${anchor}` : `cc:${claudeSession}`;
  }

  const routing = request.cacheRoutingHeaders;
  for (const header of STABLE_SESSION_HEADERS) {
    const value = trimToUndefined(routing?.[header]);
    if (value) return value;
  }

  const promptCacheKey = trimToUndefined(request.prompt_cache_key);
  if (promptCacheKey) return promptCacheKey;

  const anchor = conversationAnchor(request);
  return anchor ? `m:${anchor}` : undefined;
}
