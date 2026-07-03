import { describe, it, expect } from 'vitest';
import { anthropicRequestToContext } from '../anthropic-to-context';

// @earendil-works/pi-ai and utils/logger are globally mocked in test/vitest.setup.ts

describe('anthropicRequestToContext', () => {
  describe('system prompt', () => {
    it('maps a string system to systemPrompt', () => {
      const result = anthropicRequestToContext({
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'Hi' }],
        system: 'You are helpful.',
      });
      expect(result.context.systemPrompt).toBe('You are helpful.');
    });

    it('concatenates system content blocks', () => {
      const result = anthropicRequestToContext({
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'Hi' }],
        system: [
          { type: 'text', text: 'Part one.' },
          { type: 'text', text: 'Part two.' },
        ],
      });
      expect(result.context.systemPrompt).toBe('Part one.\n\nPart two.');
    });

    it('omits systemPrompt when system is absent', () => {
      const result = anthropicRequestToContext({
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'Hi' }],
      });
      expect(result.context.systemPrompt).toBeUndefined();
    });
  });

  describe('user messages', () => {
    it('maps string content to UserMessage', () => {
      const result = anthropicRequestToContext({
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'Hello' }],
      });
      const msg = result.context.messages[0]!;
      expect(msg.role).toBe('user');
      expect(msg.content).toBe('Hello');
    });

    it('maps text blocks to TextContent[]', () => {
      const result = anthropicRequestToContext({
        model: 'claude-opus-4-6',
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Hello' }],
          },
        ],
      });
      const msg = result.context.messages[0]!;
      expect(Array.isArray(msg.content)).toBe(true);
      expect((msg.content as any[])[0]).toEqual({ type: 'text', text: 'Hello' });
    });

    it('maps base64 image blocks to ImageContent', () => {
      const result = anthropicRequestToContext({
        model: 'claude-opus-4-6',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/webp', data: 'abc==' },
              },
            ],
          },
        ],
      });
      const content = result.context.messages[0]!.content as any[];
      expect(content[0]).toEqual({ type: 'image', mimeType: 'image/webp', data: 'abc==' });
    });

    it('throws for URL image source', () => {
      expect(() =>
        anthropicRequestToContext({
          model: 'claude-opus-4-6',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: { type: 'url', url: 'https://example.com/img.png' },
                },
              ],
            },
          ],
        })
      ).toThrow();
    });

    it('extracts tool_result blocks into ToolResultMessages', () => {
      const result = anthropicRequestToContext({
        model: 'claude-opus-4-6',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_1',
                content: 'Result text',
              },
            ],
          },
        ],
      });
      const tr = result.context.messages[0]!;
      expect(tr.role).toBe('toolResult');
      expect((tr as any).toolCallId).toBe('toolu_1');
      expect((tr as any).content[0]).toEqual({ type: 'text', text: 'Result text' });
    });
  });

  describe('assistant messages', () => {
    it('maps string content to AssistantMessage', () => {
      const result = anthropicRequestToContext({
        model: 'claude-opus-4-6',
        messages: [
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello!' },
        ],
      });
      const asst = result.context.messages[1]!;
      expect(asst.role).toBe('assistant');
      expect((asst.content as any[])[0]).toEqual({ type: 'text', text: 'Hello!' });
    });

    it('preserves thinking blocks in assistant history', () => {
      const result = anthropicRequestToContext({
        model: 'claude-opus-4-6',
        messages: [
          { role: 'user', content: 'Think!' },
          {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'My thought' },
              { type: 'text', text: 'Answer' },
            ],
          },
        ],
      });
      const blocks = result.context.messages[1]!.content as any[];
      expect(blocks.find((b: any) => b.type === 'thinking')?.thinking).toBe('My thought');
    });

    it('REGRESSION: preserves the thinking block signature in assistant history', () => {
      // Without this, a thinking block echoed back in a follow-up request (e.g.
      // multi-turn tool use with extended thinking) loses its signature and
      // Anthropic rejects it as tampered/missing on the next turn.
      const result = anthropicRequestToContext({
        model: 'claude-opus-4-6',
        messages: [
          { role: 'user', content: 'Think!' },
          {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'My thought', signature: 'sig-xyz' },
              { type: 'text', text: 'Answer' },
            ],
          },
        ],
      });
      const blocks = result.context.messages[1]!.content as any[];
      expect(blocks.find((b: any) => b.type === 'thinking')?.thinkingSignature).toBe('sig-xyz');
    });

    it('maps tool_use blocks to ToolCall', () => {
      const result = anthropicRequestToContext({
        model: 'claude-opus-4-6',
        messages: [
          { role: 'user', content: 'Use a tool' },
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'toolu_1', name: 'search', input: { q: 'cats' } }],
          },
        ],
      });
      const tc = (result.context.messages[1]!.content as any[]).find(
        (b: any) => b.type === 'toolCall'
      );
      expect(tc).toMatchObject({ type: 'toolCall', id: 'toolu_1', name: 'search' });
      expect(tc.arguments).toEqual({ q: 'cats' });
    });
  });

  describe('tools', () => {
    it('converts tool definitions via jsonSchemaToTypeBox', () => {
      const result = anthropicRequestToContext({
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'Hi' }],
        tools: [
          {
            name: 'calculator',
            description: 'Compute',
            input_schema: { type: 'object', properties: { x: { type: 'number' } } },
          },
        ],
      });
      expect(result.context.tools).toHaveLength(1);
      expect(result.context.tools![0]!.name).toBe('calculator');
      expect(result.toolsDefined).toBe(1);
    });
  });

  describe('reasoning effort', () => {
    it('preserves the raw budget on the reasoning intent for round-trip fidelity', () => {
      const result = anthropicRequestToContext({
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'Think' }],
        thinking: { type: 'enabled', budget_tokens: 16000 },
      });
      expect(result.generationIntent.reasoning).toEqual({
        effort: 'high',
        budgetTokens: 16000,
        enabled: true,
        source: 'client',
      });
    });

    it('maps thinking.type=adaptive to an adaptive intent (no pinned effort)', () => {
      const result = anthropicRequestToContext({
        model: 'claude-sonnet-5',
        messages: [{ role: 'user', content: 'Think' }],
        thinking: { type: 'adaptive', display: 'summarized' },
      });
      expect(result.generationIntent.reasoning).toEqual({
        adaptive: true,
        enabled: true,
        visibility: 'summary',
        source: 'client',
      });
      // Adaptive must NOT pin a concrete effort at the parser layer — the
      // egress decides whether to pass through or flatten.
      expect(result.generationIntent.reasoning.effort).toBeUndefined();
    });

    it('maps adaptive display=raw to full visibility', () => {
      const result = anthropicRequestToContext({
        model: 'claude-sonnet-5',
        messages: [{ role: 'user', content: 'Think' }],
        thinking: { type: 'adaptive', display: 'raw' },
      });
      expect(result.generationIntent.reasoning).toEqual({
        adaptive: true,
        enabled: true,
        visibility: 'full',
        source: 'client',
      });
    });

    it('maps adaptive with no display to a bare adaptive intent', () => {
      const result = anthropicRequestToContext({
        model: 'claude-sonnet-5',
        messages: [{ role: 'user', content: 'Think' }],
        thinking: { type: 'adaptive' },
      });
      expect(result.generationIntent.reasoning).toEqual({
        adaptive: true,
        enabled: true,
        source: 'client',
      });
    });

    it('maps enabled type with no budget_tokens to an adaptive intent', () => {
      const result = anthropicRequestToContext({
        model: 'claude-sonnet-5',
        messages: [{ role: 'user', content: 'Think' }],
        thinking: { type: 'enabled' },
      });
      expect(result.generationIntent.reasoning).toEqual({
        adaptive: true,
        enabled: true,
        source: 'client',
      });
    });

    it('builds an explicit-disable intent when thinking.type is disabled', () => {
      const result = anthropicRequestToContext({
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'No think' }],
        thinking: { type: 'disabled' },
      });
      expect(result.generationIntent.reasoning).toEqual({ enabled: false, source: 'client' });
    });

    it('leaves the reasoning intent empty when thinking is absent', () => {
      const result = anthropicRequestToContext({
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'No think' }],
      });
      expect(result.generationIntent.reasoning).toEqual({ source: 'client' });
    });
  });

  describe('tool_choice mapping', () => {
    it('maps { type: "tool", name: "fn" } to function format', () => {
      const result = anthropicRequestToContext({
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'Hi' }],
        tool_choice: { type: 'tool', name: 'search' },
      });
      expect(result.toolChoice).toEqual({ type: 'function', function: { name: 'search' } });
    });

    it('maps string type to string', () => {
      const result = anthropicRequestToContext({
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'Hi' }],
        tool_choice: { type: 'auto' },
      });
      expect(result.toolChoice).toBe('auto');
    });
  });

  describe('streaming and options', () => {
    it('sets streaming true', () => {
      const result = anthropicRequestToContext({
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      });
      expect(result.streaming).toBe(true);
    });

    it('includes max_tokens on the generation intent', () => {
      const result = anthropicRequestToContext({
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1024,
      });
      expect(result.generationIntent.maxTokens).toBe(1024);
    });

    it('counts user and assistant messages only', () => {
      const result = anthropicRequestToContext({
        model: 'claude-opus-4-6',
        messages: [
          { role: 'user', content: 'u1' },
          { role: 'assistant', content: 'a1' },
          { role: 'user', content: 'u2' },
        ],
      });
      expect(result.messageCount).toBe(3);
    });
  });
});
