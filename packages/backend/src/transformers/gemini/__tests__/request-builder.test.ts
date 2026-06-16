import { describe, it, expect } from 'vitest';
import { buildGeminiRequest } from '../request-builder';
import { parseGeminiRequest } from '../request-parser';
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

  describe('thinkingConfig building', () => {
    it('should emit camelCase thinkingLevel from effort', async () => {
      // SDK ThinkingConfig uses camelCase: includeThoughts, thinkingBudget, thinkingLevel
      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Think' }],
        model: 'gemini-2.5-flash',
        reasoning: { enabled: true, effort: 'medium' },
      };

      const result = await buildGeminiRequest(request);

      expect(result.generationConfig?.thinkingConfig).toBeDefined();
      expect(result.generationConfig?.thinkingConfig?.thinkingLevel).toBe('MEDIUM');
      expect(result.generationConfig?.thinkingConfig?.includeThoughts).toBe(true);
    });

    it('should emit camelCase thinkingBudget from max_tokens', async () => {
      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Think' }],
        model: 'gemini-2.5-flash',
        reasoning: { enabled: true, max_tokens: 8192 },
      };

      const result = await buildGeminiRequest(request);

      expect(result.generationConfig?.thinkingConfig?.thinkingBudget).toBe(8192);
    });

    it('should NOT emit snake_case thinking_budget or include_thoughts', async () => {
      // Guards against re-introducing the snake_case bug on the outbound path
      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Think' }],
        model: 'gemini-2.5-flash',
        reasoning: { enabled: true, effort: 'high', max_tokens: 4096 },
      };

      const result = await buildGeminiRequest(request);
      const tc = result.generationConfig?.thinkingConfig as any;

      expect(tc).toBeDefined();
      expect(tc.thinking_budget).toBeUndefined();
      expect(tc.include_thoughts).toBeUndefined();
      expect(tc.thinking_level).toBeUndefined();
    });

    it('should round-trip thinking config through parser then builder', async () => {
      // Reproduces the bug from the trace: Python SDK sends snake_case thinkingConfig,
      // parser must normalise to unified, builder must emit camelCase to the SDK.
      const rawRequest = {
        contents: [{ role: 'user', parts: [{ text: 'Think about this' }] }],
        model: 'gemini-2.5-flash',
        generationConfig: {
          thinkingConfig: {
            include_thoughts: true,
            thinking_level: 'MEDIUM',
          },
        },
      };

      const unified = await parseGeminiRequest(rawRequest);
      const rebuilt = await buildGeminiRequest(unified);

      const tc = rebuilt.generationConfig?.thinkingConfig;
      expect(tc).toBeDefined();
      // Builder must emit camelCase (SDK ThinkingConfig field names)
      expect(tc?.includeThoughts).toBe(true);
      expect(tc?.thinkingLevel).toBe('MEDIUM');
    });

    it('should not emit thinkingConfig when reasoning is absent', async () => {
      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gemini-2.5-flash',
      };

      const result = await buildGeminiRequest(request);

      expect(result.generationConfig?.thinkingConfig).toBeUndefined();
    });

    it('should not emit thinkingConfig when reasoning.enabled is false', async () => {
      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gemini-2.5-flash',
        reasoning: { enabled: false },
      };

      const result = await buildGeminiRequest(request);

      expect(result.generationConfig?.thinkingConfig).toBeUndefined();
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
