import { describe, it, expect } from 'vitest';
import { parseGeminiRequest } from '../request-parser';

// Helper to get first element with type narrowing
function first<T>(arr: T[]): T {
  return arr[0] as T;
}

describe('Gemini Request Parser', () => {
  describe('Gap 1: systemInstruction handling', () => {
    it('should parse systemInstruction with simple text content', async () => {
      const input = {
        systemInstruction: {
          role: 'system',
          parts: [{ text: 'You are a helpful assistant.' }],
        },
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
        model: 'gemini-2.0-flash',
      };

      const result = await parseGeminiRequest(input);

      expect(result.systemInstruction).toBeDefined();
      expect(result.systemInstruction?.role).toBe('system');
      expect(result.systemInstruction?.content).toBe('You are a helpful assistant.');
    });

    it('should parse systemInstruction with complex content', async () => {
      const input = {
        systemInstruction: {
          role: 'system',
          parts: [{ text: 'You are a helpful assistant.' }, { text: 'Always be polite.' }],
        },
        contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
        model: 'gemini-2.0-flash',
      };

      const result = await parseGeminiRequest(input);

      expect(result.systemInstruction).toBeDefined();
      expect(result.systemInstruction?.role).toBe('system');
      expect(Array.isArray(result.systemInstruction?.content)).toBe(true);
    });

    it('should handle missing systemInstruction gracefully', async () => {
      const input = {
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
        model: 'gemini-2.0-flash',
      };

      const result = await parseGeminiRequest(input);

      expect(result.systemInstruction).toBeUndefined();
      expect(result.messages).toHaveLength(1);
    });
  });

  describe('Gap 3: toolConfig handling', () => {
    it('should parse toolConfig with mode auto', async () => {
      const input = {
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
        model: 'gemini-2.0-flash',
        toolConfig: { functionCallingConfig: { mode: 'auto' } },
      };

      const result = await parseGeminiRequest(input);

      expect(result.toolConfig).toBeDefined();
      expect(result.toolConfig?.mode).toBe('auto');
    });

    it('should parse toolConfig with mode none', async () => {
      const input = {
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
        model: 'gemini-2.0-flash',
        toolConfig: { functionCallingConfig: { mode: 'none' } },
      };

      const result = await parseGeminiRequest(input);

      expect(result.toolConfig).toBeDefined();
      expect(result.toolConfig?.mode).toBe('none');
    });

    it('should parse toolConfig with mode any', async () => {
      const input = {
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
        model: 'gemini-2.0-flash',
        toolConfig: { functionCallingConfig: { mode: 'any' } },
      };

      const result = await parseGeminiRequest(input);

      expect(result.toolConfig).toBeDefined();
      expect(result.toolConfig?.mode).toBe('any');
    });

    it('should parse toolConfig with functionCallingPreference', async () => {
      const input = {
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
        model: 'gemini-2.0-flash',
        toolConfig: { functionCallingConfig: { mode: 'auto', functionCallingPreference: 'auto' } },
      };

      const result = await parseGeminiRequest(input);

      expect(result.toolConfig).toBeDefined();
      expect(result.toolConfig?.mode).toBe('auto');
      expect(result.toolConfig?.functionCallingPreference).toBe('auto');
    });

    it('should handle missing toolConfig gracefully', async () => {
      const input = {
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
        model: 'gemini-2.0-flash',
      };

      const result = await parseGeminiRequest(input);

      expect(result.toolConfig).toBeUndefined();
    });
  });

  describe('Gap 4: parametersJsonSchema support', () => {
    it('should parse function declarations with parametersJsonSchema', async () => {
      const input = {
        contents: [{ role: 'user', parts: [{ text: 'Get weather' }] }],
        model: 'gemini-2.0-flash',
        tools: [
          {
            functionDeclarations: [
              {
                name: 'get_weather',
                description: 'Get weather',
                parametersJsonSchema: {
                  type: 'object',
                  properties: { location: { type: 'string' } },
                  required: ['location'],
                },
              },
            ],
          },
        ],
      };

      const result = await parseGeminiRequest(input);
      const tools = result.tools!;

      expect(tools).toBeDefined();
      expect(tools.length).toBe(1);
      const tool = first(tools);
      expect(tool.type).toBe('function');
      expect(tool.function).toBeDefined();
      if (tool.function) {
        expect(tool.function.name).toBe('get_weather');
        expect(tool.function.parametersJsonSchema).toBeDefined();
        expect(tool.function.parametersJsonSchema?.type).toBe('object');
      }
    });

    it('should parse function declarations with legacy parameters', async () => {
      const input = {
        contents: [{ role: 'user', parts: [{ text: 'Get weather' }] }],
        model: 'gemini-2.0-flash',
        tools: [
          {
            functionDeclarations: [
              {
                name: 'get_weather',
                description: 'Get weather',
                parameters: {
                  type: 'object',
                  properties: { location: { type: 'string' } },
                  required: ['location'],
                },
              },
            ],
          },
        ],
      };

      const result = await parseGeminiRequest(input);
      const tools = result.tools!;

      expect(tools).toBeDefined();
      expect(tools.length).toBe(1);
      const tool = first(tools);
      expect(tool.type).toBe('function');
      expect(tool.function).toBeDefined();
      if (tool.function) {
        expect(tool.function.parameters).toBeDefined();
      }
    });

    it('should parse both parametersJsonSchema and parameters when both present', async () => {
      const input = {
        contents: [{ role: 'user', parts: [{ text: 'Get weather' }] }],
        model: 'gemini-2.0-flash',
        tools: [
          {
            functionDeclarations: [
              {
                name: 'get_weather',
                parametersJsonSchema: {
                  type: 'object',
                  properties: { location: { type: 'string' } },
                },
                parameters: { type: 'object', properties: { city: { type: 'string' } } },
              },
            ],
          },
        ],
      };

      const result = await parseGeminiRequest(input);
      const tools = result.tools!;

      expect(tools).toBeDefined();
      expect(tools.length).toBe(1);
      const tool = first(tools);
      expect(tool.function).toBeDefined();
      if (tool.function) {
        expect(tool.function.parametersJsonSchema).toBeDefined();
        expect(tool.function.parameters).toBeDefined();
      }
    });
  });

  describe('Gap 5: Google built-in tools', () => {
    it('should parse googleSearch tool', async () => {
      const input = {
        contents: [{ role: 'user', parts: [{ text: 'Search' }] }],
        model: 'gemini-2.0-flash',
        tools: [{ googleSearch: {} }],
      };

      const result = await parseGeminiRequest(input);
      const tools = result.tools!;

      expect(tools).toBeDefined();
      expect(tools.length).toBe(1);
      expect(first(tools).type).toBe('googleSearch');
    });

    it('should parse codeExecution tool', async () => {
      const input = {
        contents: [{ role: 'user', parts: [{ text: 'Run code' }] }],
        model: 'gemini-2.0-flash',
        tools: [{ codeExecution: {} }],
      };

      const result = await parseGeminiRequest(input);
      const tools = result.tools!;

      expect(tools).toBeDefined();
      expect(tools.length).toBe(1);
      expect(first(tools).type).toBe('codeExecution');
    });

    it('should parse urlContext tool', async () => {
      const input = {
        contents: [{ role: 'user', parts: [{ text: 'Process URL' }] }],
        model: 'gemini-2.0-flash',
        tools: [{ urlContext: {} }],
      };

      const result = await parseGeminiRequest(input);
      const tools = result.tools!;

      expect(tools).toBeDefined();
      expect(tools.length).toBe(1);
      expect(first(tools).type).toBe('urlContext');
    });

    it('should parse mixed function declarations and built-in tools', async () => {
      const input = {
        contents: [{ role: 'user', parts: [{ text: 'Do something' }] }],
        model: 'gemini-2.0-flash',
        tools: [
          { functionDeclarations: [{ name: 'my_function', description: 'A function' }] },
          { googleSearch: {} },
          { codeExecution: {} },
        ],
      };

      const result = await parseGeminiRequest(input);
      const tools = result.tools!;

      expect(tools).toBeDefined();
      expect(tools.length).toBe(3);
      expect(first(tools).type).toBe('function');
      expect(tools[1]!.type).toBe('googleSearch');
      expect(tools[2]!.type).toBe('codeExecution');
    });
  });
});
