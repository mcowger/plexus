import { describe, expect, it } from 'vitest';
import { buildToolRenamePairs } from '../registry';
import { dedupeSyntheticToolCollisions } from '../dedupe';
import type { ToolDescriptor } from '../types';

function tool(name: string, required: string[] = []): ToolDescriptor {
  return { name, parameters: { type: 'object', required } };
}

describe('buildToolRenamePairs', () => {
  it('renames a tool whose name collides with a real Claude Code tool but has an incompatible shape', () => {
    // opencode's pre-pi-ai-rename Write uses filePath/content; real CC's
    // Write requires file_path/content — same name, different shape.
    const tools = [tool('Write', ['filePath', 'content'])];
    const pairs = buildToolRenamePairs(tools);
    expect(pairs).toEqual([['Write', 'mcp__Write', 'ALWAYS USE THIS TOOL INSTEAD OF Write.']]);
  });

  it('does not rename a tool whose name collides with a real Claude Code tool and already matches its shape', () => {
    // Genuinely the same tool as real CC's Bash — nothing to disambiguate.
    const tools = [tool('Bash', ['command'])];
    expect(buildToolRenamePairs(tools)).toEqual([]);
  });

  it('does not rename tools with no name collision against any real Claude Code tool', () => {
    // None of these names appear in the CC reference table at all (case-
    // sensitive exact match), regardless of which client sent them.
    const tools = [
      tool('webfetch', ['url']),
      tool('skill', ['name']),
      tool('question'),
      tool('glob', ['pattern']),
      tool('grep', ['pattern']),
    ];
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
    expect(Object.fromEntries(pairs.map(([from, to]) => [from, to]))).toEqual({
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

  it('does not double-rename a name already claimed by the CC-collision shape', () => {
    // "Edit" collides with real CC's Edit under an incompatible shape and is
    // claimed by cc-collision-shape first; mcp-shape never sees "Edit" (nor
    // would it match — no underscore) as a candidate for its own clustering.
    const tools = [tool('Edit', ['filePath', 'oldString', 'newString']), tool('bash_run')];
    const pairs = buildToolRenamePairs(tools);
    expect(pairs).toEqual([['Edit', 'mcp__Edit', 'ALWAYS USE THIS TOOL INSTEAD OF Edit.']]);
  });

  it('handles the full real-world trace shape (opencode + 3 MCP servers + unmatched extras)', () => {
    const tools = [
      // opencode built-ins, pre-pi-ai-rename casing/shape: lowercase names
      // don't collide with any real CC tool name at all (case-sensitive).
      ...['bash', 'edit', 'read', 'write', 'todowrite'].map((n) => tool(n)),
      ...['webfetch', 'skill', 'question', 'glob', 'grep'].map((n) => tool(n)),
      ...['list_mcp_resource_templates', 'list_mcp_resources', 'read_mcp_resource'].map((n) =>
        tool(n)
      ),
      ...['list_types', 'lookup_type', 'type_check'].map((n) => tool(n)),
      ...Array.from({ length: 13 }, (_, i) => tool(`ESPhome_tool_${i}`)),
      ...Array.from({ length: 55 }, (_, i) => tool(`github_tool_${i}`)),
      ...Array.from({ length: 58 }, (_, i) => tool(`home-assistant_tool_${i}`)),
    ];
    const pairs = buildToolRenamePairs(tools);
    const renamedNames = new Set(pairs.map(([, renamed]) => renamed));
    // No CC-name collisions here (all lowercase) — only the 3 MCP clusters: 13 + 55 + 58 = 126.
    expect(pairs).toHaveLength(13 + 55 + 58);
    // No collisions among the renamed target names.
    expect(renamedNames.size).toBe(pairs.length);
    // Unmatched tools (the opencode built-ins/extras, none of which collide
    // with a real CC name while lowercase) are untouched.
    const renamedSources = new Set(pairs.map(([from]) => from));
    for (const untouched of [
      'bash',
      'edit',
      'read',
      'write',
      'todowrite',
      'webfetch',
      'skill',
      'question',
      'glob',
      'grep',
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
        { name: 'Agent', description: '' },
        { name: 'NotebookEdit', description: '' },
        {
          name: 'Agent',
          description: 'client real schema',
          input_schema: { properties: { prompt: {} } },
        },
      ],
    };
    const result = dedupeSyntheticToolCollisions(body);
    expect(result.tools).toEqual([
      { name: 'NotebookEdit', description: '' },
      {
        name: 'Agent',
        description: 'client real schema',
        input_schema: { properties: { prompt: {} } },
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
