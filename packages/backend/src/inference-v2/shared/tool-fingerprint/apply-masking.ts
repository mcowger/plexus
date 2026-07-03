/**
 * Single entry point for the v2 Claude Code OAuth-masking transformation
 * pipeline applied to an outgoing Anthropic `/v1/messages` request body.
 *
 * Extracted out of `pi-ai-executor.ts`'s `onPayload` callback so the exact
 * production sequence is directly unit-testable (see `__tests__/apply-
 * masking.test.ts`) rather than re-implemented/approximated in a test file,
 * which could silently drift from what actually ships.
 *
 * Pipeline, in order (each step's rationale is documented at its own
 * module — this is just the composition):
 *
 *   1. `buildToolRenamePairs()` — compute schema-safe renames for the
 *      caller's actual tool surface (opencode built-ins, MCP-server tools),
 *      replacing eliza's own `DEFAULT_TOOL_RENAMES` dictionary.
 *   2. Vendored `processBody()` — tool description stripping + synthetic
 *      Claude Code tool injection (fingerprint parity) using the renames
 *      from step 1.
 *   3. `dedupeSyntheticToolCollisions()` — defensive backstop for the rare
 *      case a computed rename collides with one of the 5 synthetic tool
 *      names.
 *   4. `injectClaudeCodeIdentity()` — replace `system[]` with the genuine
 *      Claude Code system-prompt shape; relocate the caller's real system
 *      content into the first user message.
 *   5. `signBillingHeader()` — sign the CCH placeholder over the finalized
 *      body. Must run last so the signature covers everything above.
 */

import { processBody } from '../../../../../../vendor/eliza/plugins/plugin-anthropic-proxy/src/proxy/process-body';
import { buildToolRenamePairs } from './registry';
import { dedupeSyntheticToolCollisions } from './dedupe';
import { injectClaudeCodeIdentity } from './cc-identity';
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

  const result = processBody(payloadStr, {
    replacements: [],
    toolRenames: toolRenamePairs,
    propRenames: [],
    stripSystemConfig: true,
    stripToolDescriptions: true,
    // Keep synthetic tool injection ON for Claude Code fingerprint parity
    // (Glob/Grep/Agent/NotebookEdit/TodoRead — see vendor/eliza/.../cc-tool-
    // injection.ts). The vendored injector unconditionally prepends all 5
    // stubs with no awareness of the caller's real tools, so if a computed
    // rename above happens to target one of those 5 reserved names, the
    // result is two tools with the same name — Anthropic rejects that with
    // `400 tools: Tool names must be unique.` dedupeSyntheticToolCollisions()
    // below is a defensive backstop for that case; in practice the
    // tool-fingerprint shapes are designed to avoid it (see
    // opencode-shape.ts).
    injectCCSyntheticTools: true,
  });

  let transformed = dedupeSyntheticToolCollisions(JSON.parse(result.body));

  // processBody() only prepends an unsigned billing block ahead of whatever
  // system[] pi-ai already built (its own CC identity block followed by the
  // caller's raw, unmodified system prompt — see cc-identity.ts for why
  // that's a deterministic non-CC signal on its own). Replace the whole
  // system[] with the genuine CC shape and relocate the caller's real system
  // content into the first user message, then sign the billing header last
  // so the signature covers the final, actually-transmitted body.
  transformed = injectClaudeCodeIdentity(transformed);
  const payload = signBillingHeader(transformed);

  return { payload, toolRenamePairs };
}
