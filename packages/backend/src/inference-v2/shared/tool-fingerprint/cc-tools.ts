/**
 * Tool description stripping + synthetic Claude Code tool injection —
 * v2-native, ported from vendor/eliza/plugins/plugin-anthropic-proxy/src/
 * proxy/cc-tool-injection.ts (see cc-constants.ts's module doc for the
 * de-vendoring rationale).
 *
 * The vendored version operated on the raw JSON string with hand-rolled
 * bracket-matching (its own comment: "skips [ and ] inside JSON string
 * values so description text can't corrupt depth") to avoid a parse/
 * re-stringify round-trip. That constraint doesn't apply here — this
 * pipeline already parses the body once for tool-rename computation (see
 * `registry.ts`'s caller in `apply-masking.ts`) and passes the parsed
 * object through every subsequent stage, so operating on the object
 * directly is both simpler and safer than re-deriving bracket-matching
 * logic.
 */

import { CC_SYNTHETIC_TOOLS } from './cc-constants';

/**
 * Strips every tool's `description` field to an empty string (real Claude
 * Code sessions send minimal/no tool descriptions vs. a typical client's
 * verbose ones — a third-party client's detailed descriptions are
 * themselves a fingerprint signal), and prepends the 5 synthetic Claude
 * Code tool stubs so the tool set fingerprints like a real Claude Code
 * session even when the caller's own tools don't cover them.
 *
 * Must run BEFORE `dedupeSyntheticToolCollisions()` (a computed rename
 * from `registry.ts` may target one of the 5 reserved synthetic names,
 * producing a duplicate that the dedupe pass then resolves).
 *
 * @param body - Parsed JSON request body with a `tools[]` array
 * @returns New body object with tool descriptions stripped and synthetic
 *   tools prepended (same reference if there's no `tools[]` to process)
 */
export function stripDescriptionsAndInjectSyntheticTools(body: any): any {
  if (!Array.isArray(body?.tools)) {
    return body;
  }

  const strippedTools = body.tools.map((t: any) => ({ ...t, description: '' }));

  return {
    ...body,
    tools: [...CC_SYNTHETIC_TOOLS.map((t) => ({ ...t })), ...strippedTools],
  };
}
