import { describe, it, expect } from 'vitest';
import { openaiRequestToContext } from '../openai-to-context';

// @earendil-works/pi-ai and utils/logger are globally mocked in test/vitest.setup.ts

describe('openaiRequestToContext', () => {
  describe('system messages', () => {
    it('collapses a single system message into systemPrompt', () => {
      const result = openaiRequestToContext({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hi' },
        ],
      });
      expect(result.context.systemPrompt).toBe('You are helpful.');
    });

    it('concatenates multiple system messages with \\n\\n', () => {
      const result = openaiRequestToContext({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'Instruction one.' },
          { role: 'system', content: 'Instruction two.' },
          { role: 'user', content: 'Hi' },
        ],
      });
      expect(result.context.systemPrompt).toBe('Instruction one.\n\nInstruction two.');
    });

    it('treats developer role as system', () => {
      const result = openaiRequestToContext({
        model: 'gpt-4',
        messages: [
          { role: 'developer', content: 'Dev instructions.' },
          { role: 'user', content: 'Hi' },
        ],
      });
      expect(result.context.systemPrompt).toBe('Dev instructions.');
    });

    it('omits systemPrompt when no system messages', () => {
      const result = openaiRequestToContext({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      });
      expect(result.context.systemPrompt).toBeUndefined();
    });
  });

  describe('user messages', () => {
    it('maps plain string content to UserMessage', () => {
      const result = openaiRequestToContext({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      });
      const msg = result.context.messages[0]!;
      expect(msg.role).toBe('user');
      expect(msg.content).toBe('Hello');
    });

    it('maps array text parts to UserMessage with TextContent[]', () => {
      const result = openaiRequestToContext({
        model: 'gpt-4',
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Hello world' }],
          },
        ],
      });
      const msg = result.context.messages[0]!;
      expect(Array.isArray(msg.content)).toBe(true);
      expect((msg.content as any[])[0]).toEqual({ type: 'text', text: 'Hello world' });
    });

    it('maps base64 image_url to ImageContent', () => {
      const dataUri = 'data:image/png;base64,abc123';
      const result = openaiRequestToContext({
        model: 'gpt-4',
        messages: [
          {
            role: 'user',
            content: [{ type: 'image_url', image_url: { url: dataUri } }],
          },
        ],
      });
      const content = result.context.messages[0]!.content as any[];
      expect(content[0]).toEqual({ type: 'image', mimeType: 'image/png', data: 'abc123' });
    });

    it('throws 400 for URL image (not base64)', () => {
      expect(() =>
        openaiRequestToContext({
          model: 'gpt-4',
          messages: [
            {
              role: 'user',
              content: [{ type: 'image_url', image_url: { url: 'https://example.com/img.png' } }],
            },
          ],
        })
      ).toThrow();
    });
  });

  describe('assistant messages', () => {
    it('maps string content to AssistantMessage', () => {
      const result = openaiRequestToContext({
        model: 'gpt-4',
        messages: [
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello!' },
        ],
      });
      const asst = result.context.messages[1]!;
      expect(asst.role).toBe('assistant');
      const content = asst.content as any[];
      expect(content[0]).toEqual({ type: 'text', text: 'Hello!' });
    });

    it('maps tool_calls to ToolCall content blocks', () => {
      const result = openaiRequestToContext({
        model: 'gpt-4',
        messages: [
          { role: 'user', content: 'What time?' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'get_time', arguments: '{"tz":"UTC"}' },
              },
            ],
          },
        ],
      });
      const asst = result.context.messages[1]!;
      const tc = (asst.content as any[]).find((b: any) => b.type === 'toolCall');
      expect(tc).toMatchObject({ type: 'toolCall', id: 'call_1', name: 'get_time' });
      expect(tc.arguments).toEqual({ tz: 'UTC' });
    });
  });

  describe('tool messages', () => {
    it('maps tool role to ToolResultMessage', () => {
      const result = openaiRequestToContext({
        model: 'gpt-4',
        messages: [
          { role: 'user', content: 'Hi' },
          { role: 'tool', tool_call_id: 'call_1', name: 'get_time', content: '{"time":"12:00"}' },
        ],
      });
      const tr = result.context.messages[1]!;
      expect(tr.role).toBe('toolResult');
      expect((tr as any).toolCallId).toBe('call_1');
      expect((tr as any).content[0]).toEqual({ type: 'text', text: '{"time":"12:00"}' });
    });
  });

  describe('tools', () => {
    it('parses tools array into pi-ai Tool[]', () => {
      const result = openaiRequestToContext({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'search',
              description: 'Search the web',
              parameters: { type: 'object', properties: { q: { type: 'string' } } },
            },
          },
        ],
      });
      expect(result.context.tools).toHaveLength(1);
      expect(result.context.tools![0]!.name).toBe('search');
      expect(result.toolsDefined).toBe(1);
    });

    it('sets tools to undefined when empty array', () => {
      const result = openaiRequestToContext({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        tools: [],
      });
      expect(result.context.tools).toBeUndefined();
      expect(result.toolsDefined).toBe(0);
    });
  });

  describe('stream options and flags', () => {
    it('sets streaming true when body.stream is true', () => {
      const result = openaiRequestToContext({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      });
      expect(result.streaming).toBe(true);
    });

    it('sets streaming false by default', () => {
      const result = openaiRequestToContext({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      });
      expect(result.streaming).toBe(false);
    });

    it('picks up max_completion_tokens over max_tokens', () => {
      const result = openaiRequestToContext({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        max_completion_tokens: 512,
        max_tokens: 1024,
      });
      expect(result.generationIntent.maxTokens).toBe(512);
    });

    it('falls back to max_tokens', () => {
      const result = openaiRequestToContext({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 256,
      });
      expect(result.generationIntent.maxTokens).toBe(256);
    });

    it('builds reasoningIntent from reasoning_effort', () => {
      const result = openaiRequestToContext({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        reasoning_effort: 'low',
      });
      expect(result.generationIntent.reasoning).toEqual({
        effort: 'low',
        enabled: true,
        source: 'client',
      });
    });

    it('maps reasoning_effort=none to an explicit-disable intent', () => {
      const result = openaiRequestToContext({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        reasoning_effort: 'none',
      });
      expect(result.generationIntent.reasoning).toEqual({ enabled: false, source: 'client' });
    });

    it('leaves reasoningIntent empty when no reasoning field is present', () => {
      const result = openaiRequestToContext({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      });
      expect(result.generationIntent.reasoning).toEqual({ source: 'client' });
    });

    it('captures verbosity and service_tier on the generation intent', () => {
      const result = openaiRequestToContext({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        verbosity: 'high',
        service_tier: 'flex',
      });
      expect(result.generationIntent.verbosity).toBe('high');
      expect(result.generationIntent.serviceTier).toBe('flex');
    });

    it('forwards tool_choice', () => {
      const result = openaiRequestToContext({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        tool_choice: 'auto',
      });
      expect(result.toolChoice).toBe('auto');
    });

    it('counts non-system messages', () => {
      const result = openaiRequestToContext({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'u1' },
          { role: 'assistant', content: 'a1' },
          { role: 'user', content: 'u2' },
        ],
      });
      expect(result.messageCount).toBe(3);
    });
  });
});
