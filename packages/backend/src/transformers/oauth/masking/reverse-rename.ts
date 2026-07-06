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
 * Matches are scoped to the `"name":"<value>"` key/value pair specifically
 * (both plain and backslash-escaped-quote forms) rather than a bare
 * `"<value>"` match anywhere in the text. Every wire format v2 emits a tool
 * name in (Anthropic `tool_use.name`, OpenAI chat `function.name`, OpenAI
 * Responses, Gemini `functionCall.name`) uses the literal JSON key `name`
 * for it — see context-to-anthropic.ts / context-to-openai.ts. A bare
 * substring match would also incorrectly rewrite a renamed tool's actual
 * name if it happens to appear as some OTHER field's string value — e.g.
 * opencode's `question` tool takes model-authored free-text `label`/
 * `description` fields, and the model could legitimately produce an option
 * labeled exactly "Bash" while discussing shell tools, which is indistinguishable
 * from a real tool_use.name match without this scoping.
 */

import type { RenamePair } from './types';

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param text - Raw response text (one SSE frame, or a full JSON body)
 * @param pairs - The SAME rename pairs used on the request (from
 *   `buildToolRenamePairs()` — reverses `wireName -> renamedName` back to
 *   `wireName`)
 */
export function reverseToolRenames(text: string, pairs: readonly RenamePair[]): string {
  let result = text;
  for (const [orig, renamed] of pairs) {
    const escapedRenamed = escapeForRegex(renamed);
    result = result.replace(new RegExp(`"name":"${escapedRenamed}"`, 'g'), `"name":"${orig}"`);
    result = result.replace(
      new RegExp(`\\\\"name\\\\":\\\\"${escapedRenamed}\\\\"`, 'g'),
      `\\"name\\":\\"${orig}\\"`
    );
  }
  return result;
}
