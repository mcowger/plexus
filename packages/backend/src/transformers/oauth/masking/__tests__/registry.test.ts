import { describe, expect, it, test } from 'bun:test';

import { namespaceNonCcToolName, NON_CC_TOOL_NAMESPACE } from '../cc-namespace-shape';
import { CC_TOOL_REFERENCE } from '../cc-reference-tools';
import { dedupeSyntheticToolCollisions } from '../dedupe';
import { buildToolRenamePairs } from '../registry';
import type { ToolDescriptor } from '../types';

function tool(name: string, required: string[] = [], type?: string): ToolDescriptor {
  const descriptor: ToolDescriptor = { name, parameters: { type: 'object', required } };
  if (type !== undefined) descriptor.type = type;
  return descriptor;
}

describe('buildToolRenamePairs', () => {
  it('renames a tool whose name collides with a real Claude Code tool but has an incompatible shape', () => {
    // opencode's pre-pi-ai-rename Write uses filePath/content; real CC's
    // Write requires file_path/content — same name, different shape.
    const tools = [tool('Write', ['filePath', 'content'])];
    const pairs = buildToolRenamePairs(tools);
    expect(pairs).toEqual([
      ['Write', `${NON_CC_TOOL_NAMESPACE}Write`, 'ALWAYS USE THIS TOOL INSTEAD OF Write.'],
    ]);
  });

  it('does not rename a tool whose name collides with a real Claude Code tool and already matches its shape', () => {
    // Genuinely the same tool as real CC's Bash — nothing to disambiguate.
    const tools = [tool('Bash', ['command'])];
    expect(buildToolRenamePairs(tools)).toEqual([]);
  });

  it('leaves every current real CC tool name bare', () => {
    for (const [name, required] of Object.entries(CC_TOOL_REFERENCE)) {
      const pairs = buildToolRenamePairs([tool(name, [...required])]);
      expect(pairs, `${name} must pass through bare`).toEqual([]);
    }
  });

  it('namespaces a caller tool that is not a current real CC tool name', () => {
    // The exact name Anthropic fingerprints as third-party traffic (verified
    // on staging: bare `web_search_exa` -> 400 "out of extra usage").
    const tools = [tool('web_search_exa', ['query', 'objective'])];
    expect(buildToolRenamePairs(tools)).toEqual([
      ['web_search_exa', `${NON_CC_TOOL_NAMESPACE}web_search_exa`],
    ]);
  });

  it('namespaces flat MCP-ish names wholesale rather than by prefix clustering', () => {
    // No cluster-size threshold: even a two-tool "server" is namespaced, and
    // the namespaced name preserves the whole original (no fake server
    // derived from the first underscore).
    const tools = [
      tool('web_search_exa', ['query']),
      tool('web_fetch_exa', ['urls']),
      tool('calculator'),
    ];
    expect(Object.fromEntries(buildToolRenamePairs(tools).map(([f, t]) => [f, t]))).toEqual({
      web_search_exa: `${NON_CC_TOOL_NAMESPACE}web_search_exa`,
      web_fetch_exa: `${NON_CC_TOOL_NAMESPACE}web_fetch_exa`,
      calculator: `${NON_CC_TOOL_NAMESPACE}calculator`,
    });
  });

  it('leaves tools already in the mcp__ namespace untouched (no double-prefix)', () => {
    const tools = [
      tool('mcp__github__get_me'),
      tool('mcp__exa__web_search_exa'),
      tool('mcp__home-assistant__ha_get_state'),
    ];
    expect(buildToolRenamePairs(tools)).toEqual([]);
  });

  it('leaves server-side tools byte-identical', () => {
    // Server tools carry a closed Anthropic-owned schema; renaming the
    // declaration would break it (see cc-tools-server-tools.test.ts).
    const tools = [
      tool('web_search', [], 'web_search_20250305'),
      tool('bash', [], 'bash_20250124'),
      tool('advisor', [], 'advisor_20260301'),
    ];
    expect(buildToolRenamePairs(tools)).toEqual([]);
  });

  it('namespaces a server-tool lookalike only when it is a caller custom tool', () => {
    const tools = [
      tool('web_search', ['query'], 'custom'),
      tool('web_search', [], 'web_search_20250305'),
    ];
    // Only the custom declaration (first) is renamed; the server declaration
    // shares the name but is skipped, so no pair is emitted for it. (Duplicate
    // names are invalid input regardless.)
    const pairs = buildToolRenamePairs(tools);
    expect(pairs).toEqual([['web_search', `${NON_CC_TOOL_NAMESPACE}web_search`]]);
  });

  it('produces names that respect the 64-char Anthropic limit', () => {
    const long = 'x'.repeat(120);
    const pairs = buildToolRenamePairs([tool(long, [], 'custom')]);
    expect(pairs).toHaveLength(1);
    const [, renamed] = pairs[0]!;
    expect(renamed.length).toBeLessThanOrEqual(64);
    expect(renamed.startsWith(NON_CC_TOOL_NAMESPACE)).toBe(true);
  });

  it('sanitizes characters Anthropic rejects in tool names', () => {
    const pairs = buildToolRenamePairs([tool('weird tool/name.v2', [], 'custom')]);
    expect(pairs).toEqual([['weird tool/name.v2', `${NON_CC_TOOL_NAMESPACE}weird_tool_name_v2`]]);
  });

  it('disambiguates two caller names that sanitize to the same namespace target', () => {
    const pairs = buildToolRenamePairs([tool('a b', [], 'custom'), tool('a_b', [], 'custom')]);
    expect(Object.fromEntries(pairs.map(([f, t]) => [f, t]))).toEqual({
      'a b': `${NON_CC_TOOL_NAMESPACE}a_b`,
      a_b: `${NON_CC_TOOL_NAMESPACE}a_b_2`,
    });
  });

  it('is deterministic for identical input', () => {
    const tools = [
      tool('web_search_exa', ['query']),
      tool('calculator'),
      tool('Write', ['filePath']),
    ];
    expect(buildToolRenamePairs(tools)).toEqual(buildToolRenamePairs(tools));
  });

  it('does not double-rename a name already claimed by the CC-collision shape', () => {
    // "Edit" collides with real CC's Edit under an incompatible shape and is
    // claimed first; the namespace shape must not see it again.
    const tools = [tool('Edit', ['filePath', 'oldString', 'newString']), tool('calculator')];
    const pairs = buildToolRenamePairs(tools);
    expect(Object.fromEntries(pairs.map(([f, t]) => [f, t]))).toEqual({
      Edit: `${NON_CC_TOOL_NAMESPACE}Edit`,
      calculator: `${NON_CC_TOOL_NAMESPACE}calculator`,
    });
    expect(pairs.filter(([from]) => from === 'Edit')).toHaveLength(1);
  });

  it('handles the full fixture shape (mixed CC names + a messy client surface)', () => {
    const tools = [
      tool('Bash', ['command']),
      tool('Read', ['filePath']), // CC name, wrong shape -> collision rename
      tool('web_search_exa', ['query']), // Anthropic-fingerprinted third-party name
      tool('home-assistant_ha_get_state'),
      tool('github_search_users'),
      tool('mcp__exa__web_search_exa'), // already namespaced
      tool('web_search', [], 'web_search_20250305'), // server tool
    ];
    const pairs = buildToolRenamePairs(tools);
    expect(Object.fromEntries(pairs.map(([f, t]) => [f, t]))).toEqual({
      Read: `${NON_CC_TOOL_NAMESPACE}Read`,
      web_search_exa: `${NON_CC_TOOL_NAMESPACE}web_search_exa`,
      'home-assistant_ha_get_state': `${NON_CC_TOOL_NAMESPACE}home-assistant_ha_get_state`,
      github_search_users: `${NON_CC_TOOL_NAMESPACE}github_search_users`,
    });
  });
});

describe('namespaceNonCcToolName', () => {
  it('preserves readable suffixes so the model can still distinguish tools', () => {
    expect(namespaceNonCcToolName('web_search_exa')).toBe(`${NON_CC_TOOL_NAMESPACE}web_search_exa`);
  });

  it('falls back to a non-empty body when the name sanitizes away', () => {
    expect(namespaceNonCcToolName('!!!')).toBe(`${NON_CC_TOOL_NAMESPACE}___`);
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
