/**
 * Single entry point for the v2 Claude Code OAuth-masking transformation
 * pipeline applied to an outgoing Anthropic `/v1/messages` request body.
 *
 * Fully v2-native — no dependency on vendor/eliza/plugins/plugin-anthropic-
 * proxy. That package was audited (see cc-constants.ts's module doc) and
 * found to be mostly dead weight for this use case: half its layers
 * (`stripSystemConfig`, assistant-prefill strip, thinking-block strip) are
 * either eliza-specific no-ops for any other client or speculative behavior
 * never confirmed necessary for our traffic; the CCH-signing gap it left
 * (see sign-billing.ts) and the tool-rename dictionary gap it left (see
 * registry.ts) were the actual production bugs this pipeline exists to fix.
 * v1 (`transformers/oauth/oauth-claude.ts`) already proves the eliza
 * dependency was never load-bearing for Claude Code fingerprinting in
 * general — it has zero vendor/eliza imports. The remaining genuinely
 * useful surface (fingerprint constants, the billing-hash formula, the
 * synthetic tool list) is ported natively with sourcing comments in
 * cc-constants.ts so it can be independently re-derived from a real Claude
 * Code capture if Anthropic ever changes these values.
 *
 * Pipeline, in order (each step's rationale is documented at its own
 * module — this is just the composition):
 *
 *   1. `buildToolRenamePairs()` — compute schema-safe renames for the
 *      caller's actual tool surface (opencode built-ins, MCP-server tools).
 *   2. `applyToolRenames()` — apply those renames across `tools[]`,
 *      `tool_choice`, and any `tool_use` blocks in message history.
 *   3. `stripDescriptionsAndInjectSyntheticTools()` — strip caller tool
 *      descriptions (fingerprint parity) and prepend the 5 synthetic
 *      Claude Code tool stubs.
 *   4. `dedupeSyntheticToolCollisions()` — defensive backstop for the rare
 *      case a computed rename collides with one of the 5 synthetic names.
 *   5. `injectClaudeCodeIdentity()` — replace `system[]` with the genuine
 *      Claude Code system-prompt shape; relocate the caller's real system
 *      content into the first user message.
 *   6. `injectClaudeCodeMetadata()` — set `metadata.user_id` to the
 *      device_id/session_id shape real Claude Code sends.
 *   7. `signBillingHeader()` — sign the CCH placeholder over the finalized
 *      body. Must run last so the signature covers everything above.
 */

import { buildToolRenamePairs } from './registry';
import { applyToolRenames } from './rename-apply';
import { stripDescriptionsAndInjectSyntheticTools } from './cc-tools';
import { dedupeSyntheticToolCollisions } from './dedupe';
import { injectClaudeCodeIdentity } from './cc-identity';
import { injectClaudeCodeMetadata } from './cc-metadata';
import { signBillingHeader } from './sign-billing';
import type { RenamePair } from './types';

export interface ClaudeCodeMaskingResult {
  /** Fully transformed request body, ready to send to Anthropic. */
  payload: any;
  /** Rename pairs computed in step 1 — callers reverse-map responses with these. */
  toolRenamePairs: RenamePair[];
}

/**
 * Applies the full v2 Claude Code OAuth-masking pipeline to an outgoing
 * Anthropic Messages API request body.
 *
 * @param payloadStr - JSON-stringified request body, as produced by pi-ai's
 *   `buildParams()` (already has pi-ai's own CC identity block + tool
 *   renames for pi-ai's fixed 17-tool list applied — this pipeline extends
 *   that to the caller's full tool surface and fixes the two gaps pi-ai
 *   doesn't cover: the caller's raw system prompt passing through, and the
 *   unsigned CCH placeholder)
 */
export function applyClaudeCodeMasking(payloadStr: string): ClaudeCodeMaskingResult {
  const parsedPayload = JSON.parse(payloadStr);
  const toolRenamePairs = buildToolRenamePairs(parsedPayload.tools ?? []);

  let payload = applyToolRenames(parsedPayload, toolRenamePairs);
  payload = stripDescriptionsAndInjectSyntheticTools(payload);
  // A computed rename above may target one of the 5 reserved synthetic tool
  // names (Glob/Grep/Agent/NotebookEdit/TodoRead), producing a duplicate
  // Anthropic rejects with `400 tools: Tool names must be unique.`. This is
  // a defensive backstop; in practice the tool-fingerprint shapes are
  // designed to avoid it (see opencode-shape.ts).
  payload = dedupeSyntheticToolCollisions(payload);
  payload = injectClaudeCodeIdentity(payload);
  payload = injectClaudeCodeMetadata(payload);
  payload = signBillingHeader(payload);

  return { payload, toolRenamePairs };
}
