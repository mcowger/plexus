/**
 * Reverses tool-name renames on an incoming Anthropic response — v2-native,
 * ported from vendor/eliza/plugins/plugin-anthropic-proxy/src/proxy/
 * reverse-map.ts + tool-rename.ts's `applyQuotedRenamesReverse()` (see
 * cc-constants.ts's module doc for the de-vendoring rationale).
 *
 * Operates on raw text (SSE frame strings, or a JSON.stringify'd
 * non-streaming response) rather than a parsed object: SSE
 * `input_json_delta` chunks embed partial JSON as string fragments that
 * cannot be parsed independently, and the streaming response path
 * (`pi-ai-executor.ts`'s `buildSSEGenerator`) works frame-by-frame, so a
 * string-level substitution is the only approach that works uniformly for
 * both streaming and non-streaming callers.
 *
 * Handles both plain (`"Name"`) and escaped (`\"Name\"`) quoted forms,
 * because a tool name can appear either as a real JSON string value
 * (`{"name":"Name"}`) or embedded inside another JSON string that itself
 * contains escaped JSON (SSE `input_json_delta` partial-argument chunks).
 */

import type { RenamePair } from './types';

/**
 * @param text - Raw response text (one SSE frame, or a full JSON body)
 * @param pairs - The SAME rename pairs used on the request (from
 *   `buildToolRenamePairs()` — reverses `wireName -> renamedName` back to
 *   `wireName`)
 */
export function reverseToolRenames(text: string, pairs: readonly RenamePair[]): string {
  let result = text;
  for (const [orig, renamed] of pairs) {
    result = result.split(`"${renamed}"`).join(`"${orig}"`);
    result = result.split(`\\"${renamed}\\"`).join(`\\"${orig}\\"`);
  }
  return result;
}
