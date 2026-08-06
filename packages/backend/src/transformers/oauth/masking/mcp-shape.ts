/**
 * Generic MCP-server tool shape.
 *
 * opencode (and other MCP-aware clients) expose MCP-server tools with a flat
 * `<server>_<tool>` wire name (e.g. `github_search_users`,
 * `home-assistant_ha_get_state`, `ESPhome_list_devices` — see debug trace
 * 1e0a037d-54a2-4358-ac53-75ade3a1f875, where 145 of 161 tools were exactly
 * this shape). Real Claude Code sessions expose MCP tools under the
 * `mcp__<server>__<tool>` convention instead. A tool array dominated by
 * flat-prefixed names is itself a strong non-Claude-Code signal — independent
 * of any single duplicate-name collision — so this shape normalizes them.
 *
 * Detection strategy: cluster tool names by the substring before their FIRST
 * underscore. A prefix is treated as an MCP server name only when at least
 * `MIN_CLUSTER_SIZE` tools share it — real MCP servers (github, home-
 * assistant, ESPhome, ...) expose many tools, so high-multiplicity clusters
 * are a reliable signal. This avoids false positives on single- or few-tool
 * prefixes that happen to contain an underscore (e.g. opencode's own
 * `list_mcp_resources` / `list_types`, which would otherwise false-cluster
 * under a fake "list" server). Tools already claimed by an earlier shape
 * (e.g. opencode's built-ins) are excluded from clustering entirely.
 *
 * This is intentionally heuristic rather than a hardcoded server allow-list:
 * MCP server names are per-deployment (whatever the user configures in
 * their client), so a fixed list would need constant maintenance. Threshold-
 * based clustering generalizes to any deployment's MCP server set without
 * per-server config.
 */

import type { RenamePair, ToolDescriptor, ToolShape } from './types';

/** Minimum number of tools sharing a prefix before it's treated as an MCP server name. */
const MIN_CLUSTER_SIZE = 4;

/**
 * Tools that are ALREADY in the `mcp__<server>__<tool>` convention — i.e. the
 * exact shape this module normalizes toward, as real Claude Code emits.
 * Without this guard the first-underscore clustering below treats their
 * literal `mcp` prefix as a server name and double-prefixes every one of
 * them (`mcp__github__get_me` -> `mcp__mcp___github__get_me`),
 * which desynchronizes `tools[].name` from `tool_reference.tool_name` blocks
 * in the message history and makes Anthropic reject the request with
 * `400 Tool reference '<name>' not found in available tools`.
 */
const ALREADY_MCP_SHAPED = /^mcp__[^_].*__.+$/;

function firstUnderscoreSplit(name: string): { prefix: string; rest: string } | null {
  const idx = name.indexOf('_');
  if (idx <= 0 || idx === name.length - 1) return null;
  return { prefix: name.slice(0, idx), rest: name.slice(idx + 1) };
}

export const mcpShape: ToolShape = {
  id: 'mcp-prefix',
  detect(tools: readonly ToolDescriptor[]): RenamePair[] {
    const byPrefix = new Map<string, string[]>();

    for (const tool of tools) {
      if (ALREADY_MCP_SHAPED.test(tool.name)) continue;
      const split = firstUnderscoreSplit(tool.name);
      if (!split) continue;
      const list = byPrefix.get(split.prefix) ?? [];
      list.push(tool.name);
      byPrefix.set(split.prefix, list);
    }

    const pairs: RenamePair[] = [];
    for (const [prefix, names] of byPrefix) {
      if (names.length < MIN_CLUSTER_SIZE) continue;
      for (const name of names) {
        const split = firstUnderscoreSplit(name);
        if (!split) continue;
        pairs.push([name, `mcp__${prefix}__${split.rest}`]);
      }
    }
    return pairs;
  },
};
