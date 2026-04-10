import { describe, expect, test } from 'bun:test';
import {
  isClaudeOAuthToken,
  remapOAuthToolNames,
  reverseRemapOAuthToolNames,
  reverseRemapOAuthToolNamesFromStreamLine,
  injectClaudeCodeSystemPrompt,
  applyClaudeOAuthTransform,
} from '../oauth-claude';

describe('Claude OAuth', () => {
  describe('isClaudeOAuthToken', () => {
    test('returns true for OAuth tokens', () => {
      expect(isClaudeOAuthToken('sk-ant-oat-test-token')).toBe(true);
      expect(isClaudeOAuthToken('prefix-sk-ant-oat-suffix')).toBe(true);
    });

    test('returns false for API keys', () => {
      expect(isClaudeOAuthToken('sk-ant-api03-test-key')).toBe(false);
      expect(isClaudeOAuthToken('sk-test-key')).toBe(false);
    });
  });

  describe('remapOAuthToolNames', () => {
    test('remaps lowercase tool names to TitleCase', () => {
      const input = {
        tools: [{ name: 'bash', description: 'Run commands' }],
        messages: [
          {
            role: 'user',
            content: [{ type: 'tool_use', name: 'read', input: {} }],
          },
        ],
      };

      const result = remapOAuthToolNames(input);

      expect(result.renamed).toBe(true);
      expect(result.body.tools[0].name).toBe('Bash');
      expect(result.body.messages[0].content[0].name).toBe('Read');
    });

    test('idempotent remapping of TitleCase names', () => {
      const input = {
        tools: [{ name: 'Bash', description: 'Run commands' }],
      };

      const result = remapOAuthToolNames(input);

      // Name stays the same (idempotent), but renamed flag is true because we processed it
      expect(result.body.tools[0].name).toBe('Bash');
    });

    test('remaps tool_choice names', () => {
      const input = {
        tool_choice: { type: 'tool', name: 'read' },
      };

      const result = remapOAuthToolNames(input);

      expect(result.renamed).toBe(true);
      expect(result.body.tool_choice.name).toBe('Read');
    });

    test('handles tool_result with nested tool_reference', () => {
      const input = {
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                content: [{ type: 'tool_reference', tool_name: 'bash' }],
              },
            ],
          },
        ],
      };

      const result = remapOAuthToolNames(input);

      expect(result.renamed).toBe(true);
      expect(result.body.messages[0].content[0].content[0].tool_name).toBe('Bash');
    });
  });

  describe('reverseRemapOAuthToolNames', () => {
    test('remaps TitleCase tool names back to lowercase', () => {
      const input = {
        content: [{ type: 'tool_use', name: 'Bash', input: {} }],
      };

      const result = reverseRemapOAuthToolNames(input);

      expect(result.content[0].name).toBe('bash');
    });

    test('handles tool_reference blocks', () => {
      const input = {
        content: [{ type: 'tool_reference', tool_name: 'Read' }],
      };

      const result = reverseRemapOAuthToolNames(input);

      expect(result.content[0].tool_name).toBe('read');
    });

    test('preserves non-mapped names', () => {
      const input = {
        content: [{ type: 'tool_use', name: 'CustomTool', input: {} }],
      };

      const result = reverseRemapOAuthToolNames(input);

      expect(result.content[0].name).toBe('CustomTool');
    });
  });

  describe('reverseRemapOAuthToolNamesFromStreamLine', () => {
    test('remaps tool names in SSE stream lines', () => {
      const line = 'data: {"content_block": {"type": "tool_use", "name": "Bash"}}';

      const result = reverseRemapOAuthToolNamesFromStreamLine(line);

      expect(result).toContain('"name":"bash"');
    });

    test('handles tool_reference in stream lines', () => {
      const line = 'data: {"content_block": {"type": "tool_reference", "tool_name": "Read"}}';

      const result = reverseRemapOAuthToolNamesFromStreamLine(line);

      expect(result).toContain('"tool_name":"read"');
    });

    test('returns original line for non-data lines', () => {
      const line = 'event: message_stop';

      const result = reverseRemapOAuthToolNamesFromStreamLine(line);

      expect(result).toBe(line);
    });

    test('returns original line for invalid JSON', () => {
      const line = 'data: {invalid json}';

      const result = reverseRemapOAuthToolNamesFromStreamLine(line);

      expect(result).toBe(line);
    });
  });

  describe('injectClaudeCodeSystemPrompt', () => {
    test('injects billing header and Claude Code system prompt', () => {
      const input = {
        system: [{ type: 'text', text: 'User system prompt' }],
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const result = injectClaudeCodeSystemPrompt(input, { oauthMode: true });

      // Should have billing header as first system block
      expect(result.system[0].text).toMatch(/^x-anthropic-billing-header:/);

      // Should have agent identifier as second block
      expect(result.system[1].text).toBe(
        "You are Claude Code, Anthropic's official CLI for Claude."
      );

      // Should have static prompt sections as third block
      expect(result.system[2].text).toContain('You are an interactive agent');
    });

    test('avoids double injection', () => {
      const input = {
        system: [
          { type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.63' },
          { type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." },
        ],
        messages: [],
      };

      const result = injectClaudeCodeSystemPrompt(input);

      // Should return input unchanged
      expect(result.system).toHaveLength(2);
    });

    test('moves user system to first user message in oauth mode', () => {
      const input = {
        system: [{ type: 'text', text: 'Custom instructions' }],
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const result = injectClaudeCodeSystemPrompt(input, { oauthMode: true });

      // User message should contain sanitized system context
      expect(result.messages[0].content).toContain('system-reminder');
    });

    test('sanitizes forwarded system prompts in oauth mode', () => {
      const input = {
        system: [{ type: 'text', text: 'You are OpenCode, the best coding agent!' }],
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const result = injectClaudeCodeSystemPrompt(input, { oauthMode: true });

      // Should not contain original branding
      expect(result.messages[0].content).not.toContain('OpenCode');

      // Should contain sanitized neutral content
      expect(result.messages[0].content).toContain('Use the available tools');
    });
  });

  describe('applyClaudeOAuthTransform', () => {
    test('applies all transforms for OAuth tokens', () => {
      const payload = {
        tools: [{ name: 'bash' }],
        system: [{ type: 'text', text: 'User system' }],
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const { payload: result, context } = applyClaudeOAuthTransform(
        payload,
        'sk-ant-oat-test-token'
      );

      expect(context.isOAuth).toBe(true);
      expect(context.toolNamesRemapped).toBe(true);

      // Tool names should be remapped
      expect(result.tools[0].name).toBe('Bash');

      // System should have billing header
      expect(result.system[0].text).toMatch(/^x-anthropic-billing-header:/);

      // CCH should be present (not 00000)
      expect(result.system[0].text).toMatch(/cch=[0-9a-f]{5};/);
    });

    test('does not apply transforms for non-OAuth tokens', () => {
      const payload = {
        tools: [{ name: 'bash' }],
        messages: [],
      };

      const { payload: result, context } = applyClaudeOAuthTransform(
        payload,
        'sk-ant-api03-test-key'
      );

      expect(context.isOAuth).toBe(false);
      expect(context.toolNamesRemapped).toBe(false);
      expect(result.tools[0].name).toBe('bash');
    });
  });
});
