import { describe, expect, it } from 'vitest';
import { buildToolRenamePairs } from '../registry';
import { dedupeSyntheticToolCollisions } from '../dedupe';
import type { ToolDescriptor } from '../types';

function tool(name: string): ToolDescriptor {
  return { name };
}

describe('buildToolRenamePairs', () => {
  it('renames opencode built-ins with real Claude Code schema equivalents', () => {
    const tools = [
      tool('bash'),
      tool('read'),
      tool('write'),
      tool('edit'),
      tool('glob'),
      tool('grep'),
      tool('todowrite'),
    ];
    const pairs = buildToolRenamePairs(tools);
    expect(Object.fromEntries(pairs)).toEqual({
      bash: 'Bash',
      read: 'Read',
      write: 'Write',
      edit: 'Edit',
      glob: 'Glob',
      grep: 'Grep',
      todowrite: 'TodoWrite',
    });
  });

  it('does not rename opencode tools with no schema-compatible Claude Code equivalent', () => {
    const tools = [tool('webfetch'), tool('skill'), tool('question')];
    expect(buildToolRenamePairs(tools)).toEqual([]);
  });

  it('clusters MCP-server tools by shared prefix into mcp__<server>__<tool> form', () => {
    const tools = [
      tool('github_search_users'),
      tool('github_get_me'),
      tool('github_list_issues'),
      tool('github_create_gist'),
    ];
    const pairs = buildToolRenamePairs(tools);
    expect(Object.fromEntries(pairs)).toEqual({
      github_search_users: 'mcp__github__search_users',
      github_get_me: 'mcp__github__get_me',
      github_list_issues: 'mcp__github__list_issues',
      github_create_gist: 'mcp__github__create_gist',
    });
  });

  it('does not cluster prefixes with too few tools (avoids false positives)', () => {
    // Only 3 tools share the "list" prefix — below MIN_CLUSTER_SIZE (4) — so
    // opencode's own list_mcp_resources / list_mcp_resource_templates /
    // list_types must NOT be misidentified as an MCP server named "list".
    const tools = [
      tool('list_mcp_resources'),
      tool('list_mcp_resource_templates'),
      tool('list_types'),
    ];
    expect(buildToolRenamePairs(tools)).toEqual([]);
  });

  it('does not double-rename a name already claimed by the opencode shape', () => {
    // "glob" is an opencode built-in; even if enough underscore-prefixed
    // siblings existed under some hypothetical "glob_*" cluster, the
    // opencode shape claims "glob" first and the MCP shape never sees it as
    // a candidate for its own prefix.
    const tools = [tool('glob'), tool('bash')];
    const pairs = buildToolRenamePairs(tools);
    expect(pairs).toEqual([
      ['bash', 'Bash'],
      ['glob', 'Glob'],
    ]);
  });

  it('handles the full real-world trace shape (opencode + 3 MCP servers + unmatched extras)', () => {
    const tools = [
      ...['bash', 'edit', 'glob', 'grep', 'read', 'write', 'todowrite'].map(tool),
      ...['webfetch', 'skill', 'question'].map(tool),
      ...['list_mcp_resource_templates', 'list_mcp_resources', 'read_mcp_resource'].map(tool),
      ...['list_types', 'lookup_type', 'type_check'].map(tool),
      ...Array.from({ length: 13 }, (_, i) => tool(`ESPhome_tool_${i}`)),
      ...Array.from({ length: 55 }, (_, i) => tool(`github_tool_${i}`)),
      ...Array.from({ length: 58 }, (_, i) => tool(`home-assistant_tool_${i}`)),
    ];
    const pairs = buildToolRenamePairs(tools);
    const renamedNames = new Set(pairs.map(([, renamed]) => renamed));
    // 7 opencode built-ins + 13 + 55 + 58 MCP tools = 133
    expect(pairs).toHaveLength(7 + 13 + 55 + 58);
    // No collisions among the renamed target names.
    expect(renamedNames.size).toBe(pairs.length);
    // Unmatched tools (webfetch/skill/question, opencode's own MCP-management
    // tools, and the 3 non-opencode augmented tools) are untouched.
    const renamedSources = new Set(pairs.map(([from]) => from));
    for (const untouched of [
      'webfetch',
      'skill',
      'question',
      'list_mcp_resource_templates',
      'list_mcp_resources',
      'read_mcp_resource',
      'list_types',
      'lookup_type',
      'type_check',
    ]) {
      expect(renamedSources.has(untouched)).toBe(false);
    }
  });
});

describe('dedupeSyntheticToolCollisions', () => {
  it('keeps the last occurrence when names collide', () => {
    const body = {
      tools: [
        { name: 'Glob', description: '' },
        { name: 'Agent', description: '' },
        {
          name: 'Glob',
          description: 'client real schema',
          input_schema: { properties: { pattern: {} } },
        },
      ],
    };
    const result = dedupeSyntheticToolCollisions(body);
    expect(result.tools).toEqual([
      { name: 'Agent', description: '' },
      {
        name: 'Glob',
        description: 'client real schema',
        input_schema: { properties: { pattern: {} } },
      },
    ]);
  });

  it('is a no-op when there are no collisions', () => {
    const body = { tools: [{ name: 'Agent' }, { name: 'Bash' }] };
    expect(dedupeSyntheticToolCollisions(body)).toBe(body);
  });

  it('is a no-op when there are no tools', () => {
    const body = { model: 'x' };
    expect(dedupeSyntheticToolCollisions(body)).toBe(body);
  });
});
