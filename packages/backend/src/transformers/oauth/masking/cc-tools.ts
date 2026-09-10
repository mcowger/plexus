/**
 * Tool description preservation + synthetic Claude Code tool injection —
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
import type { RenamePair } from './types';

/**
 * Preserves custom/MCP tool `description` fields and prepends the synthetic
 * Claude Code tool stubs so the tool set fingerprints like a real Claude
 * Code session even when the caller's own tools don't cover them.
 *
 * Caller-provided custom/MCP tool descriptions are kept verbatim. Collision
 * renames append a disambiguation note to the caller's description.
 *
 * A rename pair carrying a third element (see `cc-collision-shape.ts`) is a
 * name-collision disambiguation, not a cosmetic rename: the model will see
 * both this tool (now renamed) and the real Claude Code tool of its
 * original name in the same `tools[]`, so it needs a note telling it which
 * to prefer. The note is appended to the real description so both the
 * semantic text AND the disambiguation survive.
 *
 * Server-side tools (`type` other than "custom") are ALWAYS left
 * byte-identical — their schemas are closed and carry no
 * client-authored description (see `cc-tools-server-tools.test.ts`).
 *
 * Must run BEFORE `dedupeSyntheticToolCollisions()` (a computed rename
 * from `registry.ts` may target one of the reserved synthetic names,
 * producing a duplicate that the dedupe pass then resolves).
 *
 * @param body - Parsed JSON request body with a `tools[]` array
 * @param renamePairs - The same pairs passed to `applyToolRenames()`, used
 *   only to look up which renamed tool names need a collision note
 * @returns New body object with tool descriptions preserved and synthetic
 *   tools prepended (same reference if there's no `tools[]`)
 */
export function stripDescriptionsAndInjectSyntheticTools(
  body: any,
  renamePairs: readonly RenamePair[] = []
): any {
  if (!Array.isArray(body?.tools)) {
    return body;
  }

  const noteByRenamedName = new Map<string, string>();
  for (const [, renamedName, note] of renamePairs) {
    if (note) noteByRenamedName.set(renamedName, note);
  }

  const preservedTools = body.tools.map((t: any) => {
    // Server-side tools (`bash_20250124`, `web_search_*`, `advisor_20260301`, …)
    // are identified by a `type` other than "custom", and their schemas are
    // CLOSED — Anthropic rejects unknown keys with
    // `tools.N.<type>.description: Extra inputs are not permitted`. They carry
    // no client-authored description to fingerprint anyway, so there is nothing
    // to modify. Leave them byte-identical.
    //
    // This mirrors the rule `applyClaudeOAuthTransform` already applies in
    // `oauth-claude.ts` ("Skip built-in tools (they have a `type` field)").
    const type = typeof t?.type === 'string' ? t.type : undefined;
    if (type && type !== 'custom') {
      return t;
    }
    const note = noteByRenamedName.get(t?.name);

    if (!note) return t;
    const original = typeof t?.description === 'string' ? t.description : '';
    return { ...t, description: original ? `${original}\n\n${note}` : note };
  });

  return {
    ...body,
    tools: [...CC_SYNTHETIC_TOOLS.map((t) => ({ ...t })), ...preservedTools],
  };
}
