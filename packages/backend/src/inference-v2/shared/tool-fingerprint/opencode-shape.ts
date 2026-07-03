/**
 * opencode built-in tool shape.
 *
 * Source: https://opencode.ai/docs/tools/ (fetched during investigation of
 * debug traces 1e0a037d-54a2-4358-ac53-75ade3a1f875 and
 * 7754cf0d-f083-44d2-8e57-fe41ce1f7592).
 *
 * Only tools whose REQUIRED arguments are a genuine subset/match of the real
 * Claude Code tool's arguments are renamed — renaming is purely a wire-level
 * name change, arguments are passed through untouched, so a schema mismatch
 * would either break the tool call or mislead the model about what the tool
 * actually does.
 *
 * Included (schema-compatible with real Claude Code tools):
 *   bash, read, write, edit, glob, grep, todowrite
 *
 * Deliberately EXCLUDED:
 *   - webfetch: opencode's `webfetch` returns raw page content (text/
 *     markdown/html); Claude Code's real `WebFetch` takes a `prompt` param
 *     and does AI-driven extraction over the fetched page. Different
 *     required shape and different behavior — renaming would be a lossy,
 *     misleading mismatch, not just a cosmetic one.
 *   - skill, question: opencode-specific concepts (skill loading, structured
 *     user prompts) with no Claude Code equivalent at all.
 *   - websearch, apply_patch, lsp: no stable schema captured from a live
 *     trace yet; add here once verified against opencode's docs/schema.
 */

import type { RenamePair, ToolDescriptor, ToolShape } from './types';

/**
 * (opencode wire name, real Claude Code name) — only tools verified
 * argument-compatible above.
 */
const OPENCODE_TOOL_RENAMES: readonly RenamePair[] = [
  ['bash', 'Bash'],
  ['read', 'Read'],
  ['write', 'Write'],
  ['edit', 'Edit'],
  ['glob', 'Glob'],
  ['grep', 'Grep'],
  ['todowrite', 'TodoWrite'],
];

const OPENCODE_TOOL_NAMES = new Set(OPENCODE_TOOL_RENAMES.map(([name]) => name));

export const opencodeShape: ToolShape = {
  id: 'opencode',
  detect(tools: readonly ToolDescriptor[]): RenamePair[] {
    const present = new Set(tools.map((t) => t.name));
    return OPENCODE_TOOL_RENAMES.filter(([wireName]) => present.has(wireName));
  },
};

/** Exposed for other shapes that need to avoid double-claiming these names. */
export function isOpencodeBuiltinName(name: string): boolean {
  return OPENCODE_TOOL_NAMES.has(name);
}
