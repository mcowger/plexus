/**
 * Real-Claude-Code name-collision shape.
 *
 * Renames a caller tool ONLY when both hold:
 *   1. Its name exactly matches a real Claude Code tool name (see
 *      `cc-reference-tools.ts`).
 *   2. Its required top-level parameters differ from that CC tool's.
 *
 * Condition 2 is what makes this "collision" detection rather than blanket
 * client-name canonicalization: if a caller's `Write` tool already takes
 * `file_path`/`content` (real CC's shape), it already IS the CC tool in
 * every way that matters — leaving it alone is correct, and Anthropic sees
 * a normal, unremarkable single `Write` tool. Only a lookalike — same name,
 * incompatible shape (e.g. opencode's pre-pi-ai-rename `Write` using
 * `filePath`/`content` instead) — gets moved out of the way, because
 * otherwise either the model is misled about how to call "Write", or the
 * synthetic-injection/dedupe steps end up dropping one of two same-named
 * tools with different behavior.
 *
 * This intentionally has no per-client name list: it runs uniformly
 * whether the caller is opencode, an MCP-only client, or anything else —
 * "when the client is not Claude Code" is exactly the condition under
 * which a name collision like this can even arise.
 *
 * The renamed-to name is prefixed `mcp__` (this pipeline's existing
 * convention for "not a native CC tool name" — see `mcp-shape.ts`) rather
 * than invented ad hoc, and its description gets an appended instruction
 * telling the model to prefer it over the real CC tool of the same name,
 * since the model will see both in `tools[]` and needs a reason to pick
 * the caller's version for calls the caller will actually execute.
 */

import { CC_TOOL_REFERENCE, matchesReferenceShape } from './cc-reference-tools';
import type { RenamePair, ToolDescriptor, ToolShape } from './types';

function requiredParamsOf(tool: ToolDescriptor): string[] | undefined {
  const required = tool.parameters?.required;
  return Array.isArray(required)
    ? required.filter((r): r is string => typeof r === 'string')
    : undefined;
}

export const ccCollisionShape: ToolShape = {
  id: 'cc-collision',
  detect(tools: readonly ToolDescriptor[]): RenamePair[] {
    const pairs: RenamePair[] = [];
    for (const tool of tools) {
      if (!(tool.name in CC_TOOL_REFERENCE)) continue;
      if (matchesReferenceShape(tool.name, requiredParamsOf(tool))) continue;

      const renamed = `mcp__${tool.name}`;
      pairs.push([tool.name, renamed, `ALWAYS USE THIS TOOL INSTEAD OF ${tool.name}.`]);
    }
    return pairs;
  },
};
