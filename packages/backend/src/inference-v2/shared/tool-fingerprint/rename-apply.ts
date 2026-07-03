/**
 * Applies computed tool-rename pairs (see `registry.ts`) across every place
 * a tool name can appear in an outgoing Anthropic Messages API request
 * body — v2-native, object-level replacement for what the vendored eliza
 * pipeline did via blind quoted-string substitution
 * (`applyQuotedRenames()` in vendor/eliza/.../tool-rename.ts: literally
 * `body.split('"oldName"').join('"newName"')` over the entire raw JSON
 * string). That approach is correct but coarse — it can't distinguish a
 * tool name from any other JSON string value that happens to match, and
 * offers no way to reason about exactly which fields were touched. Since
 * this pipeline already has the parsed object in hand, renaming each known
 * name-bearing field explicitly is both safer and self-documenting.
 *
 * Fields renamed (confirmed against pi-ai's own Anthropic Messages
 * serializer, `@earendil-works/pi-ai/dist/api/anthropic-messages.js`,
 * `convertMessages()`/`convertTools()`/`buildParams()`):
 *   - `tools[].name`
 *   - `tool_choice.name` (when `tool_choice.type === "tool"`)
 *   - assistant message `content[]` blocks with `type === "tool_use"`, `.name`
 *
 * NOT renamed (verified unaffected):
 *   - `tool_result` blocks correlate to their originating call by
 *     `tool_use_id` (a call ID), never by tool name.
 *
 * This stage only renames the `name` field. A pair carrying a third element
 * (see `cc-collision-shape.ts`) also needs a description note appended, but
 * that has to happen in `cc-tools.ts`'s description-stripping stage instead
 * — it runs immediately after this one and would otherwise blank out any
 * note applied here.
 */

import type { RenamePair } from './types';

function toRenameMap(pairs: readonly RenamePair[]): Map<string, string> {
  return new Map(pairs.map(([from, to]) => [from, to]));
}

/**
 * @param body - Parsed JSON request body
 * @param pairs - Rename pairs from `buildToolRenamePairs()`
 * @returns New body object with tool names renamed everywhere they appear
 *   (same reference if `pairs` is empty)
 */
export function applyToolRenames(body: any, pairs: readonly RenamePair[]): any {
  if (pairs.length === 0) {
    return body;
  }
  const renameMap = toRenameMap(pairs);
  const result = { ...body };

  if (Array.isArray(body.tools)) {
    result.tools = body.tools.map((t: any) => {
      const renamed = renameMap.get(t?.name);
      return renamed ? { ...t, name: renamed } : t;
    });
  }

  if (body.tool_choice?.type === 'tool' && typeof body.tool_choice.name === 'string') {
    const renamed = renameMap.get(body.tool_choice.name);
    if (renamed) {
      result.tool_choice = { ...body.tool_choice, name: renamed };
    }
  }

  if (Array.isArray(body.messages)) {
    result.messages = body.messages.map((msg: any) => {
      if (!Array.isArray(msg?.content)) return msg;
      let changed = false;
      const content = msg.content.map((block: any) => {
        if (block?.type !== 'tool_use') return block;
        const renamed = renameMap.get(block.name);
        if (!renamed) return block;
        changed = true;
        return { ...block, name: renamed };
      });
      return changed ? { ...msg, content } : msg;
    });
  }

  return result;
}
