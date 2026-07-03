/**
 * Ordered registry of tool shapes for v2 Claude-masking fingerprint renames.
 *
 * To support a new client tool surface, add a new `ToolShape` module and
 * register it here. Order matters: a tool name claimed by an earlier shape
 * is removed from consideration before later shapes run, so more specific
 * detectors (e.g. a known client's exact built-in names) should precede
 * general heuristics (e.g. MCP-prefix clustering).
 */

import { opencodeShape } from './opencode-shape';
import { mcpShape } from './mcp-shape';
import type { RenamePair, ToolDescriptor, ToolShape } from './types';

const SHAPES: readonly ToolShape[] = [opencodeShape, mcpShape];

/**
 * Computes the full set of rename pairs for the given outgoing tool list by
 * running each registered shape in order, removing claimed names between
 * shapes so no tool is renamed twice.
 *
 * Pure function of `tools` — safe to call again with the same tool list to
 * recompute the same pairs for reverse-mapping the response (see
 * `pi-ai-executor.ts`, which stashes the result rather than recomputing, but
 * purity is what makes stashing-vs-recomputing an implementation detail).
 */
export function buildToolRenamePairs(tools: readonly ToolDescriptor[]): RenamePair[] {
  const allPairs: RenamePair[] = [];
  const claimed = new Set<string>();
  let remaining = tools;

  for (const shape of SHAPES) {
    const pairs = shape.detect(remaining);
    for (const pair of pairs) {
      allPairs.push(pair);
      claimed.add(pair[0]);
    }
    if (claimed.size > 0) {
      remaining = remaining.filter((t) => !claimed.has(t.name));
    }
  }

  return allPairs;
}

export type { RenamePair, ToolDescriptor, ToolShape } from './types';
