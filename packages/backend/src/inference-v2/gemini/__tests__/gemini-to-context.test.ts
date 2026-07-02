import { describe, it, expect } from 'vitest';
import { geminiRequestToContext } from '../gemini-to-context';

// @earendil-works/pi-ai and utils/logger are globally mocked in test/vitest.setup.ts

describe('geminiRequestToContext', () => {
  describe('systemInstruction', () => {
    it('maps systemInstruction.parts text to systemPrompt', () => {
      const result = geminiRequestToContext(
        {
          model: 'gemini-2.5-pro',
          systemInstruction: { parts: [{ text: 'Be helpful.' }] },
          contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
        },
        false
      );
      expect(result.context.systemPrompt).toBe('Be helpful.');
    });

    it('concatenates multiple system instruction parts', () => {
      const result = geminiRequestToContext(
        {
          model: 'gemini-2.5-pro',
          systemInstruction: { parts: [{ text: 'Part one.' }, { text: 'Part two.' }] },
          contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
        },
        false
      );
      expect(result.context.systemPrompt).toBe('Part one.\n\nPart two.');
    });

    it('omits systemPrompt when no systemInstruction', () => {
      const result = geminiRequestToContext(
        { model: 'gemini-2.5-pro', contents: [{ role: 'user', parts: [{ text: 'Hi' }] }] },
        false
      );
      expect(result.context.systemPrompt).toBeUndefined();
    });
  });

  describe('user messages', () => {
    it('maps text part to UserMessage', () => {
      const result = geminiRequestToContext(
        { model: 'gemini-2.5-pro', contents: [{ role: 'user', parts: [{ text: 'Hello' }] }] },
        false
      );
      const msg = result.context.messages[0]!;
      expect(msg.role).toBe('user');
      expect(msg.content).toBe('Hello');
    });

    it('maps inlineData part to ImageContent', () => {
      const result = geminiRequestToContext(
        {
          model: 'gemini-2.5-pro',
          contents: [
            {
              role: 'user',
              parts: [{ inlineData: { mimeType: 'image/jpeg', data: 'base64data' } }],
            },
          ],
        },
        false
      );
      const content = result.context.messages[0]!.content as any[];
      expect(content[0]).toEqual({ type: 'image', mimeType: 'image/jpeg', data: 'base64data' });
    });

    it('simplifies single text part to plain string', () => {
      const result = geminiRequestToContext(
        { model: 'gemini-2.5-pro', contents: [{ role: 'user', parts: [{ text: 'Simple' }] }] },
        false
      );
      expect(result.context.messages[0]!.content).toBe('Simple');
    });
  });

  describe('model (assistant) messages', () => {
    it('maps text part to AssistantMessage with TextContent', () => {
      const result = geminiRequestToContext(
        {
          model: 'gemini-2.5-pro',
          contents: [
            { role: 'user', parts: [{ text: 'Hi' }] },
            { role: 'model', parts: [{ text: 'Hello!' }] },
          ],
        },
        false
      );
      const asst = result.context.messages[1]!;
      expect(asst.role).toBe('assistant');
      const text = (asst.content as any[]).find((b: any) => b.type === 'text');
      expect(text?.text).toBe('Hello!');
    });

    it('maps thought:true part to ThinkingContent', () => {
      const result = geminiRequestToContext(
        {
          model: 'gemini-2.5-pro',
          contents: [
            { role: 'user', parts: [{ text: 'Think' }] },
            { role: 'model', parts: [{ text: 'Deep thought', thought: true }, { text: 'Answer' }] },
          ],
        },
        false
      );
      const asst = result.context.messages[1]!;
      const thinking = (asst.content as any[]).find((b: any) => b.type === 'thinking');
      expect(thinking?.thinking).toBe('Deep thought');
    });

    it('maps functionCall part to ToolCall', () => {
      const result = geminiRequestToContext(
        {
          model: 'gemini-2.5-pro',
          contents: [
            { role: 'user', parts: [{ text: 'Use a tool' }] },
            {
              role: 'model',
              parts: [{ functionCall: { name: 'search', args: { q: 'cats' } } }],
            },
          ],
        },
        false
      );
      const asst = result.context.messages[1]!;
      const tc = (asst.content as any[]).find((b: any) => b.type === 'toolCall');
      expect(tc).toMatchObject({ type: 'toolCall', name: 'search' });
      expect(tc.arguments).toEqual({ q: 'cats' });
    });

    it('preserves thoughtSignature on functionCall parts (top-level)', () => {
      const result = geminiRequestToContext(
        {
          model: 'gemini-3.5-flash',
          contents: [
            { role: 'user', parts: [{ text: 'Use a tool' }] },
            {
              role: 'model',
              parts: [
                {
                  functionCall: { name: 'bash', args: { command: 'ls' } },
                  thoughtSignature: 'SIGBASE64PAYLOAD',
                },
              ],
            },
          ],
        },
        false
      );
      const asst = result.context.messages[1]!;
      const tc = (asst.content as any[]).find((b: any) => b.type === 'toolCall');
      expect(tc.thoughtSignature).toBe('SIGBASE64PAYLOAD');
    });

    it('preserves thoughtSignature nested under functionCall', () => {
      const result = geminiRequestToContext(
        {
          model: 'gemini-3.5-flash',
          contents: [
            { role: 'user', parts: [{ text: 'Use a tool' }] },
            {
              role: 'model',
              parts: [
                {
                  functionCall: {
                    name: 'bash',
                    args: { command: 'ls' },
                    thoughtSignature: 'NESTEDSIG',
                  },
                },
              ],
            },
          ],
        },
        false
      );
      const asst = result.context.messages[1]!;
      const tc = (asst.content as any[]).find((b: any) => b.type === 'toolCall');
      expect(tc.thoughtSignature).toBe('NESTEDSIG');
    });

    it('propagates a shared thoughtSignature to sibling tool calls in a parallel turn', () => {
      // Gemini only puts thoughtSignature on the first functionCall of a
      // parallel tool-call turn; siblings share the same thought context.
      const result = geminiRequestToContext(
        {
          model: 'gemini-3.5-flash',
          contents: [
            { role: 'user', parts: [{ text: 'Two tools' }] },
            {
              role: 'model',
              parts: [{ functionCall: { name: 'fn1', args: {} }, thoughtSignature: 'SHAREDSIG' }],
            },
            { role: 'model', parts: [{ functionCall: { name: 'fn2', args: {} } }] },
          ],
        },
        false
      );
      const assistants = result.context.messages.filter((m) => m.role === 'assistant');
      expect(assistants).toHaveLength(1);
      const toolCalls = (assistants[0]!.content as any[]).filter((b: any) => b.type === 'toolCall');
      expect(toolCalls).toHaveLength(2);
      expect(toolCalls[0].thoughtSignature).toBe('SHAREDSIG');
      expect(toolCalls[1].thoughtSignature).toBe('SHAREDSIG');
    });

    it('preserves thinkingSignature on thought:true parts', () => {
      const result = geminiRequestToContext(
        {
          model: 'gemini-3.5-flash',
          contents: [
            { role: 'user', parts: [{ text: 'Think' }] },
            {
              role: 'model',
              parts: [
                { text: 'Deep thought', thought: true, thoughtSignature: 'THINKSIG' },
                { text: 'Answer' },
              ],
            },
          ],
        },
        false
      );
      const asst = result.context.messages[1]!;
      const thinking = (asst.content as any[]).find((b: any) => b.type === 'thinking');
      expect(thinking?.thinking).toBe('Deep thought');
      expect(thinking?.thinkingSignature).toBe('THINKSIG');
    });

    it('normalizes URL-safe base64 thoughtSignature to standard base64 on functionCall parts', () => {
      // Gemini 3.x emits the signature as URL-safe base64 (- and _). pi-ai's
      // outbound serializer only accepts standard base64 (+ and /) and drops
      // anything else, so we must translate at capture or the next turn 400s.
      // `_--_` (bytes ff ef bf) is a length-4 URL-safe value → standard `/++/`.
      const urlSafe = '_--_';
      const result = geminiRequestToContext(
        {
          model: 'gemini-3.5-flash',
          contents: [
            { role: 'user', parts: [{ text: 'Use a tool' }] },
            {
              role: 'model',
              parts: [
                {
                  functionCall: { name: 'list_files', args: {} },
                  thoughtSignature: urlSafe,
                },
              ],
            },
          ],
        },
        false
      );
      const asst = result.context.messages[1]!;
      const tc = (asst.content as any[]).find((b: any) => b.type === 'toolCall');
      expect(tc.thoughtSignature).toBe('/++/');
      // Byte-identical: URL-safe and standard base64 decode to the same bytes.
      expect(Buffer.from(tc.thoughtSignature, 'base64')).toEqual(
        Buffer.from(urlSafe.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
      );
    });

    it('restores stripped padding when normalizing an unpadded URL-safe signature', () => {
      // URL-safe base64 is commonly emitted WITHOUT `=` padding, and pi-ai's
      // validator rejects any value whose length is not a multiple of 4. The
      // normalizer must re-append padding so the signature survives.
      // `-_8` (bytes fb ff, len 3) → standard, padded `+/8=` (len 4).
      const unpadded = '-_8';
      const result = geminiRequestToContext(
        {
          model: 'gemini-3.5-flash',
          contents: [
            { role: 'user', parts: [{ text: 'Use a tool' }] },
            {
              role: 'model',
              parts: [
                {
                  functionCall: { name: 'list_files', args: {} },
                  thoughtSignature: unpadded,
                },
              ],
            },
          ],
        },
        false
      );
      const asst = result.context.messages[1]!;
      const tc = (asst.content as any[]).find((b: any) => b.type === 'toolCall');
      expect(tc.thoughtSignature).toBe('+/8=');
      // Valid standard base64: length is a multiple of 4.
      expect(tc.thoughtSignature.length % 4).toBe(0);
      // Byte-identical to the original decoded value.
      expect(Buffer.from(tc.thoughtSignature, 'base64')).toEqual(
        Buffer.from(unpadded, 'base64url')
      );
    });

    it('normalizes URL-safe base64 thinkingSignature on thought parts', () => {
      const result = geminiRequestToContext(
        {
          model: 'gemini-3.5-flash',
          contents: [
            { role: 'user', parts: [{ text: 'Think' }] },
            {
              role: 'model',
              parts: [{ text: 'Deep thought', thought: true, thoughtSignature: 'ab-cd_ef' }],
            },
          ],
        },
        false
      );
      const asst = result.context.messages[1]!;
      const thinking = (asst.content as any[]).find((b: any) => b.type === 'thinking');
      expect(thinking?.thinkingSignature).toBe('ab+cd/ef');
    });

    it('leaves a standard-base64 thoughtSignature unchanged', () => {
      const result = geminiRequestToContext(
        {
          model: 'gemini-3.5-flash',
          contents: [
            { role: 'user', parts: [{ text: 'Use a tool' }] },
            {
              role: 'model',
              parts: [
                {
                  functionCall: { name: 'bash', args: {} },
                  thoughtSignature: 'Standard+Base64/Value=',
                },
              ],
            },
          ],
        },
        false
      );
      const asst = result.context.messages[1]!;
      const tc = (asst.content as any[]).find((b: any) => b.type === 'toolCall');
      expect(tc.thoughtSignature).toBe('Standard+Base64/Value=');
    });

    it('merges consecutive model turns into one AssistantMessage', () => {
      const result = geminiRequestToContext(
        {
          model: 'gemini-2.5-pro',
          contents: [
            { role: 'user', parts: [{ text: 'Multi-tool' }] },
            { role: 'model', parts: [{ functionCall: { name: 'fn1', args: {} } }] },
            { role: 'model', parts: [{ functionCall: { name: 'fn2', args: {} } }] },
          ],
        },
        false
      );
      const assistants = result.context.messages.filter((m) => m.role === 'assistant');
      expect(assistants).toHaveLength(1);
      const toolCalls = (assistants[0]!.content as any[]).filter((b: any) => b.type === 'toolCall');
      expect(toolCalls).toHaveLength(2);
    });
  });

  describe('functionResponse (tool results)', () => {
    it('maps functionResponse part to ToolResultMessage', () => {
      const result = geminiRequestToContext(
        {
          model: 'gemini-2.5-pro',
          contents: [
            { role: 'user', parts: [{ text: 'Run tool' }] },
            { role: 'model', parts: [{ functionCall: { name: 'fn', args: {} } }] },
            {
              role: 'user',
              parts: [{ functionResponse: { name: 'fn', response: { result: 42 } } }],
            },
          ],
        },
        false
      );
      const tr = result.context.messages.find((m) => m.role === 'toolResult');
      expect(tr).toBeDefined();
      expect((tr as any).toolName).toBe('fn');
      expect((tr as any).toolCallId).toBe('fn');
    });
  });

  describe('tools', () => {
    it('parses functionDeclarations into pi-ai Tool[]', () => {
      const result = geminiRequestToContext(
        {
          model: 'gemini-2.5-pro',
          contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
          tools: [
            {
              functionDeclarations: [
                {
                  name: 'search',
                  description: 'Search the web',
                  parameters: { type: 'object', properties: { q: { type: 'string' } } },
                },
              ],
            },
          ],
        },
        false
      );
      expect(result.context.tools).toHaveLength(1);
      expect(result.context.tools![0]!.name).toBe('search');
      expect(result.toolsDefined).toBe(1);
    });
  });

  describe('reasoning / thinkingConfig', () => {
    it('maps HIGH thinkingLevel to high effort', () => {
      const result = geminiRequestToContext(
        {
          model: 'gemini-2.5-pro',
          contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
          generationConfig: { thinkingConfig: { thinkingLevel: 'HIGH' } },
        },
        false
      );
      expect(result.generationIntent.reasoning.effort).toBe('high');
    });

    it('maps LOW thinkingLevel to low effort', () => {
      const result = geminiRequestToContext(
        {
          model: 'gemini-2.5-pro',
          contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
          generationConfig: { thinkingConfig: { thinkingLevel: 'LOW' } },
        },
        false
      );
      expect(result.generationIntent.reasoning.effort).toBe('low');
    });

    it('maps NONE thinkingLevel to a disabled intent', () => {
      const result = geminiRequestToContext(
        {
          model: 'gemini-2.5-pro',
          contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
          generationConfig: { thinkingConfig: { thinkingLevel: 'NONE' } },
        },
        false
      );
      expect(result.generationIntent.reasoning.effort).toBeUndefined();
      expect(result.generationIntent.reasoning.enabled).toBe(false);
    });

    it('maps thinkingBudget > 10000 to high', () => {
      const result = geminiRequestToContext(
        {
          model: 'gemini-2.5-pro',
          contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
          generationConfig: { thinkingConfig: { thinkingBudget: 12000 } },
        },
        false
      );
      expect(result.generationIntent.reasoning.effort).toBe('high');
    });

    it('maps includeThoughts to reasoning visibility', () => {
      const visible = geminiRequestToContext(
        {
          model: 'gemini-2.5-pro',
          contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
          generationConfig: { thinkingConfig: { thinkingLevel: 'HIGH', includeThoughts: true } },
        },
        false
      );
      expect(visible.generationIntent.reasoning.visibility).toBe('summary');

      const hidden = geminiRequestToContext(
        {
          model: 'gemini-2.5-pro',
          contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
          generationConfig: { thinkingConfig: { thinkingLevel: 'HIGH', includeThoughts: false } },
        },
        false
      );
      expect(hidden.generationIntent.reasoning.visibility).toBe('hidden');
    });
  });

  describe('streaming flag', () => {
    it('passes through streaming=true from caller', () => {
      const result = geminiRequestToContext(
        { model: 'gemini-2.5-pro', contents: [{ role: 'user', parts: [{ text: 'Hi' }] }] },
        true
      );
      expect(result.streaming).toBe(true);
    });

    it('passes through streaming=false from caller', () => {
      const result = geminiRequestToContext(
        { model: 'gemini-2.5-pro', contents: [{ role: 'user', parts: [{ text: 'Hi' }] }] },
        false
      );
      expect(result.streaming).toBe(false);
    });
  });

  describe('generationConfig options', () => {
    it('maps maxOutputTokens to the generation intent', () => {
      const result = geminiRequestToContext(
        {
          model: 'gemini-2.5-pro',
          contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
          generationConfig: { maxOutputTokens: 512 },
        },
        false
      );
      expect(result.generationIntent.maxTokens).toBe(512);
    });

    it('maps temperature to the generation intent', () => {
      const result = geminiRequestToContext(
        {
          model: 'gemini-2.5-pro',
          contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
          generationConfig: { temperature: 0.7 },
        },
        false
      );
      expect(result.generationIntent.temperature).toBe(0.7);
    });
  });
});
