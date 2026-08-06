/**
 * Regression tests for `applyToolRenames`'s handling of `tool_reference`
 * blocks (Anthropic advanced tool use / tool search).
 *
 * A renamed tool must be renamed everywhere its name appears in the request,
 * including the `tool_reference.tool_name` blocks a tool-search result leaves
 * in the message history. If `tools[]` is renamed but those blocks are not,
 * Anthropic rejects the whole request with
 * `400 Tool reference '<name>' not found in available tools` — and because
 * the block is persisted in the client's history, every subsequent turn in
 * that session fails the same way.
 */

import { describe, expect, it } from 'vitest';
import { applyToolRenames } from '../rename-apply';
import type { RenamePair } from '../types';

const pairs: RenamePair[] = [['github_search_users', 'mcp__github__search_users']];

describe('applyToolRenames', () => {
  it('renames a top-level tool_reference block', () => {
    const body = {
      tools: [{ name: 'github_search_users' }],
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool_reference', tool_name: 'github_search_users' }],
        },
      ],
    };
    const result = applyToolRenames(body, pairs);
    expect(result.messages[0].content[0]).toEqual({
      type: 'tool_reference',
      tool_name: 'mcp__github__search_users',
    });
    expect(result.tools[0].name).toBe('mcp__github__search_users');
  });

  it('renames tool_reference blocks nested inside a tool_result (tool-search result shape)', () => {
    const body = {
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_01',
              content: [
                { type: 'tool_reference', tool_name: 'github_search_users' },
                { type: 'tool_reference', tool_name: 'unrelated_tool' },
              ],
            },
          ],
        },
      ],
    };
    const result = applyToolRenames(body, pairs);
    expect(result.messages[0].content[0].content).toEqual([
      { type: 'tool_reference', tool_name: 'mcp__github__search_users' },
      { type: 'tool_reference', tool_name: 'unrelated_tool' },
    ]);
  });

  it('leaves tool_use renaming and untouched blocks intact', () => {
    const body = {
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'github_search_users' },
            { type: 'tool_use', id: 'toolu_01', name: 'github_search_users', input: {} },
          ],
        },
      ],
    };
    const result = applyToolRenames(body, pairs);
    expect(result.messages[0].content[0]).toEqual({
      type: 'text',
      text: 'github_search_users',
    });
    expect(result.messages[0].content[1].name).toBe('mcp__github__search_users');
  });
});
