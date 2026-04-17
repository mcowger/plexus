import { describe, it, expect } from 'vitest';
import { buildGeminiRequest } from '../request-builder';
import type { UnifiedChatRequest, UnifiedToolConfig } from '../../../types/unified';

// Helper to get first element with type narrowing
function first<T>(arr: T[]): T {
  return arr[0] as T;
}

describe('Gemini Request Builder', () => {
  describe('Gap 1: systemInstruction handling', () => {
    it('should output systemInstruction when provided in unified request', async () => {
      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gemini-2.0-flash',
        systemInstruction: { role: 'system', content: 'You are helpful.' },
      };

      const result = await buildGeminiRequest(request);

      expect(result.systemInstruction).toBeDefined();
      expect(result.systemInstruction!.role).toBe('system');
      expect(result.systemInstruction!.parts).toBeDefined();
      expect(result.systemInstruction!.parts![0]!.text).toBe('You are helpful.');
    });

    it('should output systemInstruction with complex content', async () => {
      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Hi' }],
        model: 'gemini-2.0-flash',
        systemInstruction: { role: 'system', content: [{ type: 'text', text: 'System message' }] },
      };

      const result = await buildGeminiRequest(request);

      expect(result.systemInstruction).toBeDefined();
      expect(result.systemInstruction!.role).toBe('system');
    });

    it('should not duplicate system messages when systemInstruction is provided', async () => {
      const request: UnifiedChatRequest = {
        messages: [
          { role: 'system', content: 'This should be skipped' },
          { role: 'user', content: 'Hello' },
        ],
        model: 'gemini-2.0-flash',
        systemInstruction: { role: 'system', content: 'Explicit system instruction' },
      };

      const result = await buildGeminiRequest(request);

      expect(result.systemInstruction).toBeDefined();
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0]!.role).toBe('user');
    });
  });

  describe('Gap 3: toolConfig handling', () => {
    it('should output toolConfig with mode auto', async () => {
      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gemini-2.0-flash',
        toolConfig: { mode: 'auto' } as UnifiedToolConfig,
      };

      const result = await buildGeminiRequest(request);

      expect(result.toolConfig).toBeDefined();
      expect(result.toolConfig!.functionCallingConfig).toBeDefined();
      expect(result.toolConfig!.functionCallingConfig!.mode).toBe('auto');
    });

    it('should output toolConfig with mode none', async () => {
      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gemini-2.0-flash',
        toolConfig: { mode: 'none' } as UnifiedToolConfig,
      };

      const result = await buildGeminiRequest(request);

      expect(result.toolConfig).toBeDefined();
      expect(result.toolConfig!.functionCallingConfig!.mode).toBe('none');
    });

    it('should output toolConfig with mode any', async () => {
      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gemini-2.0-flash',
        toolConfig: { mode: 'any' } as UnifiedToolConfig,
      };

      const result = await buildGeminiRequest(request);

      expect(result.toolConfig).toBeDefined();
      expect(result.toolConfig!.functionCallingConfig!.mode).toBe('any');
    });

    it('should output toolConfig with functionCallingPreference', async () => {
      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gemini-2.0-flash',
        toolConfig: { mode: 'auto', functionCallingPreference: 'auto' } as UnifiedToolConfig,
      };

      const result = await buildGeminiRequest(request);

      expect(result.toolConfig).toBeDefined();
      expect(result.toolConfig!.functionCallingConfig!.mode).toBe('auto');
      expect(result.toolConfig!.functionCallingConfig!.functionCallingPreference).toBe('auto');
    });

    it('should handle missing toolConfig gracefully', async () => {
      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gemini-2.0-flash',
      };

      const result = await buildGeminiRequest(request);

      expect(result.toolConfig).toBeUndefined();
    });
  });

  describe('Gap 4: parametersJsonSchema support', () => {
    it('should output parametersJsonSchema when available', async () => {
      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Get weather' }],
        model: 'gemini-2.0-flash',
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get weather for a location',
              parametersJsonSchema: {
                type: 'object' as const,
                properties: { location: { type: 'string' as const } },
                required: ['location'],
              },
            },
          },
        ],
      };

      const result = await buildGeminiRequest(request);
      const tools = result.tools!;

      expect(tools).toBeDefined();
      expect(tools.length).toBeGreaterThan(0);
      const funcTool = tools.find((t) => t.functionDeclarations);
      expect(funcTool).toBeDefined();
      expect(funcTool!.functionDeclarations).toBeDefined();
      const decl = first(funcTool!.functionDeclarations!);
      expect(decl.parametersJsonSchema).toBeDefined();
      expect((decl.parametersJsonSchema as any).type).toBe('object');
    });

    it('should output legacy parameters when parametersJsonSchema not available', async () => {
      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Get weather' }],
        model: 'gemini-2.0-flash',
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get weather for a location',
              parameters: {
                type: 'object' as const,
                properties: { location: { type: 'string' as const } },
                required: ['location'],
              },
            },
          },
        ],
      };

      const result = await buildGeminiRequest(request);
      const tools = result.tools!;

      expect(tools).toBeDefined();
      const funcTool = tools.find((t) => t.functionDeclarations);
      expect(funcTool).toBeDefined();
      const decl = first(funcTool!.functionDeclarations!);
      expect(decl.parameters).toBeDefined();
    });

    it('should prefer parametersJsonSchema over parameters when both available', async () => {
      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Get weather' }],
        model: 'gemini-2.0-flash',
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              parametersJsonSchema: {
                type: 'object' as const,
                properties: { location: { type: 'string' as const } },
              },
              parameters: {
                type: 'object' as const,
                properties: { city: { type: 'string' as const } },
              },
            },
          },
        ],
      };

      const result = await buildGeminiRequest(request);
      const tools = result.tools!;

      const funcTool = tools.find((t) => t.functionDeclarations);
      const decl = first(funcTool!.functionDeclarations!);
      // When both are available, parametersJsonSchema should be preferred
      expect(decl.parametersJsonSchema).toBeDefined();
      // parameters is not output when parametersJsonSchema is present
      expect(decl.parameters).toBeUndefined();
    });
  });

  describe('Gap 5: Google built-in tools', () => {
    it('should output googleSearch tool', async () => {
      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Search' }],
        model: 'gemini-2.0-flash',
        tools: [{ type: 'googleSearch', googleSearch: {} }],
      };

      const result = await buildGeminiRequest(request);
      const tools = result.tools!;

      expect(tools).toBeDefined();
      const searchTool = tools.find((t) => t.googleSearch);
      expect(searchTool).toBeDefined();
      expect(searchTool!.googleSearch).toEqual({});
    });

    it('should output codeExecution tool', async () => {
      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Run code' }],
        model: 'gemini-2.0-flash',
        tools: [{ type: 'codeExecution', codeExecution: {} }],
      };

      const result = await buildGeminiRequest(request);
      const tools = result.tools!;

      expect(tools).toBeDefined();
      const execTool = tools.find((t) => t.codeExecution);
      expect(execTool).toBeDefined();
      expect(execTool!.codeExecution).toEqual({});
    });

    it('should output urlContext tool', async () => {
      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Process URL' }],
        model: 'gemini-2.0-flash',
        tools: [{ type: 'urlContext', urlContext: {} }],
      };

      const result = await buildGeminiRequest(request);
      const tools = result.tools!;

      expect(tools).toBeDefined();
      const urlTool = tools.find((t) => t.urlContext);
      expect(urlTool).toBeDefined();
      expect(urlTool!.urlContext).toEqual({});
    });

    it('should output mixed function declarations and built-in tools', async () => {
      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Do something' }],
        model: 'gemini-2.0-flash',
        tools: [
          { type: 'function', function: { name: 'my_function', description: 'A function' } },
          { type: 'googleSearch', googleSearch: {} },
          { type: 'codeExecution', codeExecution: {} },
        ],
      };

      const result = await buildGeminiRequest(request);
      const tools = result.tools!;

      expect(tools).toBeDefined();
      expect(tools.length).toBeGreaterThanOrEqual(3);
      expect(tools.some((t) => t.functionDeclarations)).toBe(true);
      expect(tools.some((t) => t.googleSearch)).toBe(true);
      expect(tools.some((t) => t.codeExecution)).toBe(true);
    });
  });
});
