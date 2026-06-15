import { describe, it, expect } from 'vitest';
import { responsesToContext, normalizeResponsesInput } from '../responses-to-context';

// @earendil-works/pi-ai and utils/logger are globally mocked in test/vitest.setup.ts

describe('normalizeResponsesInput', () => {
  it('returns an array unchanged', () => {
    const arr = [{ type: 'message', role: 'user', content: [] }];
    expect(normalizeResponsesInput(arr)).toEqual(arr);
  });

  it('coerces role-only message items to type:message', () => {
    const result = normalizeResponsesInput([{ role: 'user', content: 'Hello' }]);
    expect(result).toEqual([{ type: 'message', role: 'user', content: 'Hello' }]);
  });

  it('wraps a string in a user message item', () => {
    const result = normalizeResponsesInput('Hello');
    expect(result).toHaveLength(1);
    expect(result[0]!.role).toBe('user');
    expect(result[0]!.content[0]).toEqual({ type: 'input_text', text: 'Hello' });
  });
});

describe('responsesToContext', () => {
  describe('system messages', () => {
    it('maps type:message role:system to systemPrompt', () => {
      const result = responsesToContext({
        model: 'gpt-4',
        input: [
          {
            type: 'message',
            role: 'system',
            content: [{ type: 'input_text', text: 'Be helpful.' }],
          },
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hi' }] },
        ],
      });
      expect(result.context.systemPrompt).toBe('Be helpful.');
    });
  });

  describe('user messages', () => {
    it('maps role-only OpenCode-style input messages', () => {
      const result = responsesToContext({
        model: 'gpt-4',
        input: [
          { role: 'developer', content: 'Use terse answers.' },
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Hello' }],
          },
        ],
      });
      expect(result.context.systemPrompt).toBe('Use terse answers.');
      expect(result.context.messages).toHaveLength(1);
      expect(result.context.messages[0]!.role).toBe('user');
    });

    it('maps input_text to UserMessage', () => {
      const result = responsesToContext({
        model: 'gpt-4',
        input: [
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hello' }] },
        ],
      });
      const msg = result.context.messages[0]!;
      expect(msg.role).toBe('user');
      expect(
        typeof msg.content === 'string' ? msg.content : (msg.content as any[])[0]
      ).toBeTruthy();
    });

    it('maps base64 input_image to ImageContent', () => {
      const result = responsesToContext({
        model: 'gpt-4',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'input_image',
                image_url: 'data:image/png;base64,abc123',
              },
            ],
          },
        ],
      });
      const content = result.context.messages[0]!.content as any[];
      expect(content[0]).toMatchObject({ type: 'image', mimeType: 'image/png', data: 'abc123' });
    });
  });

  describe('assistant messages', () => {
    it('maps output_text to AssistantMessage text', () => {
      const result = responsesToContext({
        model: 'gpt-4',
        input: [
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hi' }] },
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Hello!' }],
          },
        ],
      });
      const asst = result.context.messages[1]!;
      expect(asst.role).toBe('assistant');
      const textBlock = (asst.content as any[]).find((b: any) => b.type === 'text');
      expect(textBlock?.text).toBe('Hello!');
    });
  });

  describe('function_call items', () => {
    it('accumulates standalone function_call into an AssistantMessage', () => {
      const result = responsesToContext({
        model: 'gpt-4',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Do something' }],
          },
          {
            type: 'function_call',
            id: 'fc_1',
            call_id: 'c1',
            name: 'search',
            arguments: '{"q":"cats"}',
          },
          { type: 'function_call_output', call_id: 'c1', output: 'result' },
        ],
      });
      // The function_call should have been flushed into an assistant turn
      const asst = result.context.messages.find((m) => m.role === 'assistant');
      expect(asst).toBeDefined();
      const tc = (asst!.content as any[]).find((b: any) => b.type === 'toolCall');
      expect(tc).toMatchObject({ name: 'search' });
    });

    it('maps function_call_output to ToolResultMessage', () => {
      const result = responsesToContext({
        model: 'gpt-4',
        input: [
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Do' }] },
          { type: 'function_call', id: 'fc_1', call_id: 'c1', name: 'fn', arguments: '{}' },
          { type: 'function_call_output', call_id: 'c1', output: 'Done' },
        ],
      });
      const tr = result.context.messages.find((m) => m.role === 'toolResult');
      expect(tr).toBeDefined();
      expect((tr as any).toolCallId).toBe('c1');
    });
  });

  describe('tools', () => {
    it('parses tools array', () => {
      const result = responsesToContext({
        model: 'gpt-4',
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hi' }] }],
        tools: [
          {
            type: 'function',
            name: 'search',
            description: 'Search',
            parameters: { type: 'object' },
          },
        ],
      });
      expect(result.context.tools).toHaveLength(1);
      expect(result.context.tools![0]!.name).toBe('search');
      expect(result.toolsDefined).toBe(1);
    });
  });

  describe('reasoning and streaming', () => {
    it('forwards reasoning.effort', () => {
      const result = responsesToContext({
        model: 'gpt-4',
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hi' }] }],
        reasoning: { effort: 'high' },
      });
      expect(result.reasoningEffort).toBe('high');
    });

    it('sets wantsSummary from reasoning.summary', () => {
      const result = responsesToContext({
        model: 'gpt-4',
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hi' }] }],
        reasoning: { summary: 'auto' },
      });
      expect(result.wantsSummary).toBe(true);
    });

    it('sets streaming true when stream is true', () => {
      const result = responsesToContext({
        model: 'gpt-4',
        stream: true,
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hi' }] }],
      });
      expect(result.streaming).toBe(true);
    });
  });
});
