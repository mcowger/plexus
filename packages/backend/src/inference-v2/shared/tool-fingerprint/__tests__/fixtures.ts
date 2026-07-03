/**
 * Anonymized fixture generator reproducing the tool/system-prompt shape of
 * production debug trace 17404760-e986-49b3-8a20-f1a4a469a0ac (the request
 * that surfaced the CCH-signing and system-prompt-passthrough gaps fixed in
 * cc-identity.ts / sign-billing.ts).
 *
 * The real trace's system prompt contains the reporting user's actual
 * absolute file paths and private repo instructions — this generator
 * reproduces only the *shape* that matters for the masking pipeline
 * (tool-name distribution, system-block count/order, message structure)
 * with entirely synthetic content. Tool name distribution verified against
 * the real trace: 7 opencode-overlapping tools (already capitalized by
 * pi-ai's own OAuth transform before our pipeline runs — see
 * apply-masking.ts's module doc), 2 more pi-ai renames we deliberately don't
 * duplicate (Skill, WebFetch), 145 MCP-server tools across 3 servers
 * (78 home-assistant, 55 github, 12 ESPhome), and 9 tools with no CC
 * equivalent that must pass through untouched.
 */

import type { ToolDescriptor } from '../types';

/** A tool as it appears in the outgoing Anthropic payload (post pi-ai transform). */
export interface AnthropicToolFixture {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

function tool(
  name: string,
  input_schema: Record<string, unknown> = { type: 'object', properties: {} }
): AnthropicToolFixture {
  return { name, description: `Synthetic description for ${name}`, input_schema };
}

/**
 * The 7 opencode built-ins that pi-ai's own OAuth transform ALREADY renames
 * to Claude Code casing before our pipeline sees the payload (pi-ai's
 * `toClaudeCodeName()` matches case-insensitively against its own 17-tool
 * list, which includes all 7). Included here at their POST-pi-ai-rename
 * names — this is the actual input shape our pipeline receives, confirmed
 * against the real trace's `transformedRequest.tools`.
 */
function opencodeToolsAlreadyRenamedByPiAi(): AnthropicToolFixture[] {
  return [
    tool('Bash', {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
    }),
    tool('Edit', {
      type: 'object',
      properties: {
        filePath: { type: 'string' },
        oldString: { type: 'string' },
        newString: { type: 'string' },
      },
      required: ['filePath', 'oldString', 'newString'],
    }),
    tool('Glob', {
      type: 'object',
      properties: { pattern: { type: 'string' } },
      required: ['pattern'],
    }),
    tool('Grep', {
      type: 'object',
      properties: { pattern: { type: 'string' } },
      required: ['pattern'],
    }),
    tool('Read', {
      type: 'object',
      properties: { filePath: { type: 'string' } },
      required: ['filePath'],
    }),
    tool('Write', {
      type: 'object',
      properties: { content: { type: 'string' }, filePath: { type: 'string' } },
      required: ['content', 'filePath'],
    }),
    tool('TodoWrite', {
      type: 'object',
      properties: { todos: { type: 'array' } },
      required: ['todos'],
    }),
  ];
}

/**
 * pi-ai also renames these two despite our `opencode-shape.ts` deliberately
 * excluding them (opencode's `webfetch` has a different arg shape/behavior
 * than real CC's `WebFetch`; `skill` has no CC equivalent at all) — pi-ai's
 * rename is unconditional and out of our control, so this fixture reflects
 * what actually arrives.
 */
function toolsRenamedByPiAiOnly(): AnthropicToolFixture[] {
  return [
    tool('WebFetch', {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    }),
    tool('Skill', { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }),
  ];
}

/** opencode-specific tool with no Claude Code equivalent — stays lowercase. */
function untouchedOpencodeTools(): AnthropicToolFixture[] {
  return [
    tool('question'),
    tool('list_mcp_resource_templates'),
    tool('list_mcp_resources'),
    tool('read_mcp_resource'),
    tool('list_types'),
    tool('lookup_type'),
    tool('type_check'),
  ];
}

function mcpServerTools(serverPrefix: string, toolNames: string[]): AnthropicToolFixture[] {
  return toolNames.map((name) => tool(`${serverPrefix}_${name}`));
}

const HOME_ASSISTANT_TOOL_NAMES = Array.from({ length: 78 }, (_, i) => `ha_action_${i}`);
const GITHUB_TOOL_NAMES = Array.from({ length: 55 }, (_, i) => `action_${i}`);
const ESPHOME_TOOL_NAMES = Array.from({ length: 12 }, (_, i) => `device_action_${i}`);

/**
 * Full 161-tool array matching the real trace's distribution:
 * 7 (opencode, pre-renamed) + 2 (pi-ai-only renames) + 7 (untouched) + 78 + 55 + 12 = 161
 */
export function buildFixtureTools(): AnthropicToolFixture[] {
  return [
    ...opencodeToolsAlreadyRenamedByPiAi(),
    ...toolsRenamedByPiAiOnly(),
    ...untouchedOpencodeTools(),
    ...mcpServerTools('home-assistant', HOME_ASSISTANT_TOOL_NAMES),
    ...mcpServerTools('github', GITHUB_TOOL_NAMES),
    ...mcpServerTools('ESPhome', ESPHOME_TOOL_NAMES),
  ];
}

export function toToolDescriptors(tools: AnthropicToolFixture[]): ToolDescriptor[] {
  return tools.map((t) => ({ name: t.name, parameters: t.input_schema }));
}

/**
 * Synthetic system prompt with the same STRUCTURE as the real trace's
 * client system prompt (identity framing + environment block + agent-rules
 * instructions) but no real paths, repo names, or user-specific content.
 */
const SYNTHETIC_CLIENT_SYSTEM_PROMPT = `You are an expert coding assistant. You help users by reading files, executing commands, editing code, and writing new files.

Be concise in your responses. Show file paths clearly when working with files.
You are powered by the model named test-model. The exact model ID is test-provider/test-model
Here is some useful information about the environment you are running in:
<env>
  Working directory: /synthetic/workspace
  Workspace root folder: /synthetic/workspace
  Is directory a git repo: yes
  Platform: linux
  Today's date: Mon Jan 01 2024
</env>
Instructions from: /synthetic/workspace/AGENTS.md
# Synthetic agent rules

This file is a placeholder for regression-test purposes.
`;

/**
 * Builds the request body shape as it exists when it reaches
 * `applyClaudeCodeMasking()` — i.e. AFTER pi-ai's own `buildParams()` has
 * already run (CC identity block prepended, its own 9 tool renames
 * applied) but BEFORE our pipeline's tool renames / synthetic injection /
 * identity replacement / CCH signing.
 */
export function buildPiAiOutputFixture(): any {
  return {
    model: 'claude-sonnet-5',
    max_tokens: 4096,
    stream: true,
    system: [
      { type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." },
      { type: 'text', text: SYNTHETIC_CLIENT_SYSTEM_PROMPT },
    ],
    messages: [{ role: 'user', content: 'Are you online?' }],
    tools: buildFixtureTools(),
  };
}
