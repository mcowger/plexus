import { describe, expect, it } from 'vitest';
import { buildGeminiRequest } from '../request-builder';
import {
  appendUserAfterTextOnlyModelTail,
  ensureContentsEndWithUser,
  isTextOnlyModelContent,
} from '../utils/model-tail';
import type { UnifiedChatRequest } from '../../../types/unified';

describe('Gemini model-tail normalization', () => {
  describe('isTextOnlyModelContent', () => {
    it('returns true for a text-only model turn', () => {
      expect(isTextOnlyModelContent({ role: 'model', parts: [{ text: 'stored' }] })).toBe(true);
    });

    it('returns true for text plus thought metadata', () => {
      expect(
        isTextOnlyModelContent({
          role: 'model',
          parts: [{ text: 'stored', thought: true, thoughtSignature: 'aGVsbG8=' }],
        })
      ).toBe(true);
    });

    it('returns false for non-model roles', () => {
      expect(isTextOnlyModelContent({ role: 'user', parts: [{ text: 'hi' }] })).toBe(false);
    });

    it('returns false for empty parts', () => {
      expect(isTextOnlyModelContent({ role: 'model', parts: [] })).toBe(false);
    });

    it('returns false for functionCall tails', () => {
      expect(
        isTextOnlyModelContent({
          role: 'model',
          parts: [{ functionCall: { name: 'lookup', args: {} } }],
        })
      ).toBe(false);
    });

    it('returns false for media tails', () => {
      expect(
        isTextOnlyModelContent({
          role: 'model',
          parts: [{ inlineData: { mimeType: 'image/png', data: 'abcd' } }],
        })
      ).toBe(false);
    });

    it('returns false for text parts with disallowed keys', () => {
      expect(
        isTextOnlyModelContent({
          role: 'model',
          parts: [{ text: 'stored', media_resolution: 'low' }],
        })
      ).toBe(false);
    });
  });

  describe('appendUserAfterTextOnlyModelTail', () => {
    it('appends a "." user turn after a text-only model tail', () => {
      const contents = [
        { role: 'user', parts: [{ text: 'Remember cobalt' }] },
        { role: 'model', parts: [{ text: 'stored' }] },
      ];
      const result = appendUserAfterTextOnlyModelTail(contents);
      expect(result).toHaveLength(3);
      expect(result[2]).toEqual({ role: 'user', parts: [{ text: '.' }] });
      // Does not mutate the input
      expect(contents).toHaveLength(2);
    });

    it('leaves user tails unchanged', () => {
      const contents = [
        { role: 'user', parts: [{ text: 'hi' }] },
        { role: 'model', parts: [{ text: 'stored' }] },
        { role: 'user', parts: [{ text: 'what was it?' }] },
      ];
      expect(appendUserAfterTextOnlyModelTail(contents)).toBe(contents);
    });

    it('leaves functionCall tails unchanged', () => {
      const contents = [
        { role: 'user', parts: [{ text: 'Look up cobalt' }] },
        { role: 'model', parts: [{ functionCall: { name: 'lookup', args: {} } }] },
      ];
      expect(appendUserAfterTextOnlyModelTail(contents)).toBe(contents);
    });
  });

  describe('ensureContentsEndWithUser', () => {
    it('mutates in place and returns true when appended', () => {
      const contents: any[] = [{ role: 'model', parts: [{ text: 'stored' }] }];
      expect(ensureContentsEndWithUser(contents)).toBe(true);
      expect(contents).toHaveLength(2);
      expect(contents[1]).toEqual({ role: 'user', parts: [{ text: '.' }] });
    });

    it('returns false for user tails', () => {
      const contents: any[] = [{ role: 'user', parts: [{ text: 'hi' }] }];
      expect(ensureContentsEndWithUser(contents)).toBe(false);
      expect(contents).toHaveLength(1);
    });
  });

  describe('buildGeminiRequest', () => {
    it('appends a synthetic user turn when messages end on an assistant turn', async () => {
      const request: UnifiedChatRequest = {
        messages: [
          { role: 'user', content: 'Remember cobalt' },
          { role: 'assistant', content: 'stored' },
        ],
        model: 'gemini-3.8-flash',
      };
      const result = await buildGeminiRequest(request);
      expect(result.contents).toHaveLength(3);
      expect(result.contents[2]!.role).toBe('user');
      expect(result.contents[2]!.parts).toEqual([{ text: '.' }]);
    });

    it('leaves user-final histories unchanged', async () => {
      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'hello' }],
        model: 'gemini-3.8-flash',
      };
      const result = await buildGeminiRequest(request);
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0]!.role).toBe('user');
    });

    it('leaves tool-call tails unchanged', async () => {
      const request: UnifiedChatRequest = {
        messages: [
          { role: 'user', content: 'Look up cobalt' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call-1',
                type: 'function',
                function: { name: 'lookup', arguments: '{}' },
              },
            ],
          },
        ],
        model: 'gemini-3.8-flash',
      };
      const result = await buildGeminiRequest(request);
      const last = result.contents[result.contents.length - 1]!;
      expect(last.role).toBe('model');
      expect(last.parts!.some((p: any) => p.functionCall)).toBe(true);
    });
  });
});
