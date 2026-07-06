/**
 * Regression tests for `reverseToolRenames` — flagged by automated PR review
 * on #650 (importance 8): the original implementation did blind quoted-
 * string substitution (`text.split('"Renamed"').join('"orig"')`), which
 * incorrectly rewrites a renamed tool's name if it happens to appear as
 * some OTHER field's string value in the response — e.g. opencode's
 * `question` tool takes model-authored free-text `label`/`description`
 * fields, and the model can legitimately produce an option labeled exactly
 * "Bash" while discussing shell tools. That text is indistinguishable from
 * a real `tool_use.name` match without scoping to the `"name":"..."` key.
 */

import { describe, expect, it } from 'vitest';
import { reverseToolRenames } from '../reverse-rename';

describe('reverseToolRenames', () => {
  const pairs: [string, string][] = [
    ['bash', 'Bash'],
    ['github_search_users', 'mcp__github__search_users'],
  ];

  it('reverses a real tool_use.name field (plain quoted)', () => {
    const input = '{"type":"tool_use","name":"Bash","input":{}}';
    expect(reverseToolRenames(input, pairs)).toBe('{"type":"tool_use","name":"bash","input":{}}');
  });

  it('reverses a real tool_use.name field embedded in an escaped SSE partial_json fragment', () => {
    // Single-backslash escaping, matching the real shape of an Anthropic
    // input_json_delta chunk whose partial JSON string itself contains an
    // embedded "name" key (e.g. a tool call whose arguments happen to
    // include a nested object with its own "name" field).
    const input = '{"partial_json":"{\\"name\\":\\"Bash\\"}"}';
    expect(reverseToolRenames(input, pairs)).toBe('{"partial_json":"{\\"name\\":\\"bash\\"}"}');
  });

  it('reverses a renamed MCP tool name under tool_use.name', () => {
    const input = '{"type":"tool_use","name":"mcp__github__search_users","input":{}}';
    expect(reverseToolRenames(input, pairs)).toBe(
      '{"type":"tool_use","name":"github_search_users","input":{}}'
    );
  });

  it('does NOT rewrite a renamed tool name appearing as an unrelated field value (plain quoted)', () => {
    // e.g. the `question` tool's model-authored option label happens to be
    // the literal string "Bash" — not a tool_use.name field at all.
    const input = '{"options":[{"label":"Bash"}]}';
    expect(reverseToolRenames(input, pairs)).toBe(input);
  });

  it('does NOT rewrite a renamed tool name appearing as an unrelated field value (escaped)', () => {
    const input = '{"partial_json":"{\\"label\\":\\"Bash\\"}"}';
    expect(reverseToolRenames(input, pairs)).toBe(input);
  });

  it('does not rewrite when the renamed value only partially matches (substring)', () => {
    const input = '{"type":"tool_use","name":"BashSomethingElse","input":{}}';
    expect(reverseToolRenames(input, pairs)).toBe(input);
  });

  it('is a no-op for text with no rename pairs', () => {
    const input = '{"type":"tool_use","name":"Bash"}';
    expect(reverseToolRenames(input, [])).toBe(input);
  });

  it('handles a tool name containing regex special characters safely', () => {
    const specialPairs: [string, string][] = [['weird_tool', 'mcp__server.name+1__weird_tool']];
    const input = '{"type":"tool_use","name":"mcp__server.name+1__weird_tool"}';
    expect(reverseToolRenames(input, specialPairs)).toBe('{"type":"tool_use","name":"weird_tool"}');
  });
});
