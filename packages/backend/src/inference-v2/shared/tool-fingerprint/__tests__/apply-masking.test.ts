/**
 * Regression test for the v2 Claude Code OAuth-masking pipeline
 * (`applyClaudeCodeMasking`), reproducing the shape of production debug
 * trace 17404760-e986-49b3-8a20-f1a4a469a0ac.
 *
 * That request was rejected by Anthropic with
 * `400 tools: Tool names must be unique.` (duplicate Glob/Grep from the
 * vendored synthetic-tool injector colliding with pi-ai's own tool
 * renames), and later — after that fix — with an overage/non-CC billing
 * rejection (`You're out of extra usage.`) caused by two further gaps:
 * the CCH signature was never computed (always the literal `cch=00000`
 * placeholder), and the caller's real system prompt rode through to
 * Anthropic unmodified instead of being replaced/relocated like a genuine
 * Claude Code session's would be.
 *
 * This test locks in all three fixes against a fixture built from the real
 * trace's tool-name distribution (see fixtures.ts) so a future change to
 * any pipeline stage that reintroduces one of these regressions fails here
 * first.
 */

import { describe, expect, it } from 'vitest';
import { applyClaudeCodeMasking } from '../apply-masking';
import { buildFixtureTools, buildPiAiOutputFixture } from './fixtures';

describe('applyClaudeCodeMasking (regression: debug trace 17404760-e986-49b3-8a20-f1a4a469a0ac)', () => {
  it('produces zero duplicate tool names in the outgoing tools array', () => {
    const { payload } = applyClaudeCodeMasking(JSON.stringify(buildPiAiOutputFixture()));

    const names: string[] = payload.tools.map((t: any) => t.name);
    const uniqueNames = new Set(names);

    expect(uniqueNames.size).toBe(names.length);
  });

  it('injects the 5 synthetic Claude Code tools and de-dupes the Glob/Grep collision', () => {
    const { payload } = applyClaudeCodeMasking(JSON.stringify(buildPiAiOutputFixture()));
    const names: string[] = payload.tools.map((t: any) => t.name);

    // Agent/NotebookEdit/TodoRead have no client-side collision and survive.
    expect(names).toContain('Agent');
    expect(names).toContain('NotebookEdit');
    expect(names).toContain('TodoRead');

    // Glob/Grep exist exactly once (client's real tool wins over the
    // synthetic stub — see dedupe.ts's "keep last occurrence" rationale).
    expect(names.filter((n) => n === 'Glob')).toHaveLength(1);
    expect(names.filter((n) => n === 'Grep')).toHaveLength(1);

    // 161 fixture tools + 5 synthetic - 2 deduped collisions = 164.
    expect(payload.tools).toHaveLength(buildFixtureTools().length + 5 - 2);
  });

  it('renames MCP-server tools to the mcp__<server>__<tool> convention, clustered per server', () => {
    const { payload } = applyClaudeCodeMasking(JSON.stringify(buildPiAiOutputFixture()));
    const names: string[] = payload.tools.map((t: any) => t.name);

    expect(names.filter((n) => n.startsWith('mcp__home-assistant__'))).toHaveLength(78);
    expect(names.filter((n) => n.startsWith('mcp__github__'))).toHaveLength(55);
    expect(names.filter((n) => n.startsWith('mcp__ESPhome__'))).toHaveLength(12);

    // Original flat-prefixed names must be gone.
    expect(names.some((n) => n.startsWith('home-assistant_'))).toBe(false);
    expect(names.some((n) => n.startsWith('github_'))).toBe(false);
    expect(names.some((n) => n.startsWith('ESPhome_'))).toBe(false);
  });

  it('leaves tools with no Claude Code equivalent untouched', () => {
    const { payload } = applyClaudeCodeMasking(JSON.stringify(buildPiAiOutputFixture()));
    const names: string[] = payload.tools.map((t: any) => t.name);

    for (const untouched of [
      'question',
      'list_mcp_resource_templates',
      'list_mcp_resources',
      'read_mcp_resource',
      'list_types',
      'lookup_type',
      'type_check',
    ]) {
      expect(names).toContain(untouched);
    }
  });

  it('replaces system[] with the genuine 3-block Claude Code shape', () => {
    const { payload } = applyClaudeCodeMasking(JSON.stringify(buildPiAiOutputFixture()));

    expect(payload.system).toHaveLength(3);
    expect(payload.system[0].text).toMatch(/^x-anthropic-billing-header:/);
    expect(payload.system[1].text).toBe(
      "You are Claude Code, Anthropic's official CLI for Claude."
    );
    // Static CC prompt, not the caller's system prompt.
    expect(payload.system[2].text).toMatch(
      /^You are an interactive agent that helps users with software engineering tasks\./
    );
    expect(payload.system[2].text).not.toContain('synthetic/workspace');
    expect(payload.system[2].text).not.toContain('AGENTS.md');
  });

  it('relocates the caller real system content, sanitized, into the first user message', () => {
    const { payload } = applyClaudeCodeMasking(JSON.stringify(buildPiAiOutputFixture()));

    const firstUserMessage = payload.messages.find((m: any) => m.role === 'user');
    const content =
      typeof firstUserMessage.content === 'string'
        ? firstUserMessage.content
        : firstUserMessage.content[0].text;

    expect(content).toContain('<system-reminder>');
    expect(content).toContain(
      'Use the available tools when needed to help with software engineering tasks.'
    );
    // The caller's actual system-prompt content (paths, AGENTS.md instructions) must NOT leak through.
    expect(content).not.toContain('synthetic/workspace');
    expect(content).not.toContain('Synthetic agent rules');
  });

  it('signs the CCH — never sends the unsigned 00000 placeholder', () => {
    const { payload } = applyClaudeCodeMasking(JSON.stringify(buildPiAiOutputFixture()));

    const billingText = payload.system[0].text as string;
    expect(billingText).not.toContain('cch=00000');
    expect(billingText).toMatch(/cch=[0-9a-f]{5};/);
  });

  it('produces a deterministic signature for identical input (no accidental randomness)', () => {
    const input = JSON.stringify(buildPiAiOutputFixture());
    const first = applyClaudeCodeMasking(input);
    const second = applyClaudeCodeMasking(input);

    expect(first.payload.system[0].text).toBe(second.payload.system[0].text);
  });

  it('returns toolRenamePairs usable for reverse-mapping the response', () => {
    const { toolRenamePairs } = applyClaudeCodeMasking(JSON.stringify(buildPiAiOutputFixture()));

    const pairsMap = Object.fromEntries(toolRenamePairs);
    expect(pairsMap['home-assistant_ha_action_0']).toBe('mcp__home-assistant__ha_action_0');
    expect(pairsMap['github_action_0']).toBe('mcp__github__action_0');
    expect(pairsMap['ESPhome_device_action_0']).toBe('mcp__ESPhome__device_action_0');
  });
});
