import { describe, it, expect } from 'vitest';
import { convertLanguageModelToolsToToolSet, convertLanguageModelToolChoice } from '../tools/converter.js';
import type { LanguageModelV2FunctionTool } from '@ai-sdk/provider';

describe('convertLanguageModelToolsToToolSet', () => {
  it('should convert a basic tool', () => {
    const tools: LanguageModelV2FunctionTool[] = [
      {
        type: 'function',
        name: 'get_weather',
        description: 'Get weather for a location',
        inputSchema: {
          type: 'object',
          properties: {
            location: { type: 'string' },
          },
          required: ['location'],
        },
      },
    ];

    const toolSet = convertLanguageModelToolsToToolSet(tools);

    expect(toolSet).toBeDefined();
    expect(toolSet!.get_weather).toBeDefined();
    expect(toolSet!.get_weather.description).toBe('Get weather for a location');
  });

  it('should return undefined for empty array', () => {
    const toolSet = convertLanguageModelToolsToToolSet([]);

    expect(toolSet).toBeUndefined();
  });

  it('should return undefined for undefined input', () => {
    const toolSet = convertLanguageModelToolsToToolSet(undefined);

    expect(toolSet).toBeUndefined();
  });

  it('should convert multiple tools', () => {
    const tools: LanguageModelV2FunctionTool[] = [
      {
        type: 'function',
        name: 'tool1',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        type: 'function',
        name: 'tool2',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        type: 'function',
        name: 'tool3',
        inputSchema: { type: 'object', properties: {} },
      },
    ];

    const toolSet = convertLanguageModelToolsToToolSet(tools);

    expect(toolSet).toBeDefined();
    expect(Object.keys(toolSet!)).toHaveLength(3);
    expect(toolSet!.tool1).toBeDefined();
    expect(toolSet!.tool2).toBeDefined();
    expect(toolSet!.tool3).toBeDefined();
  });

  it('should handle tool without description', () => {
    const tools: LanguageModelV2FunctionTool[] = [
      {
        type: 'function',
        name: 'my_tool',
        inputSchema: { type: 'object', properties: {} },
      },
    ];

    const toolSet = convertLanguageModelToolsToToolSet(tools);

    expect(toolSet).toBeDefined();
    expect(toolSet!.my_tool).toBeDefined();
    // Default description when missing
    expect(toolSet!.my_tool.description).toBe('Tool: my_tool');
  });

  it('should set type to object if missing', () => {
    const tools: LanguageModelV2FunctionTool[] = [
      {
        type: 'function',
        name: 'my_tool',
        inputSchema: {
          properties: {
            param: { type: 'string' },
          },
        } as any, // Missing type field
      },
    ];

    const toolSet = convertLanguageModelToolsToToolSet(tools);

    expect(toolSet).toBeDefined();
    expect(toolSet!.my_tool).toBeDefined();
  });

  it('should set type to object if type is None', () => {
    const tools: LanguageModelV2FunctionTool[] = [
      {
        type: 'function',
        name: 'my_tool',
        inputSchema: {
          type: 'None' as any,
          properties: {},
        },
      },
    ];

    const toolSet = convertLanguageModelToolsToToolSet(tools);

    expect(toolSet).toBeDefined();
    expect(toolSet!.my_tool).toBeDefined();
  });

  it('should add properties if missing', () => {
    const tools: LanguageModelV2FunctionTool[] = [
      {
        type: 'function',
        name: 'my_tool',
        inputSchema: {
          type: 'object',
        } as any, // Missing properties
      },
    ];

    const toolSet = convertLanguageModelToolsToToolSet(tools);

    expect(toolSet).toBeDefined();
    expect(toolSet!.my_tool).toBeDefined();
  });

  it('should skip tool without inputSchema', () => {
    const tools: LanguageModelV2FunctionTool[] = [
      {
        type: 'function',
        name: 'valid_tool',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        type: 'function',
        name: 'invalid_tool',
      } as any, // Missing inputSchema
    ];

    const toolSet = convertLanguageModelToolsToToolSet(tools);

    expect(toolSet).toBeDefined();
    expect(Object.keys(toolSet!)).toHaveLength(1);
    expect(toolSet!.valid_tool).toBeDefined();
    expect(toolSet!.invalid_tool).toBeUndefined();
  });

  it('should skip tool without name', () => {
    const tools: LanguageModelV2FunctionTool[] = [
      {
        type: 'function',
        name: 'valid_tool',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        type: 'function',
        inputSchema: { type: 'object', properties: {} },
      } as any, // Missing name
    ];

    const toolSet = convertLanguageModelToolsToToolSet(tools);

    expect(toolSet).toBeDefined();
    expect(Object.keys(toolSet!)).toHaveLength(1);
    expect(toolSet!.valid_tool).toBeDefined();
  });

  it('should skip invalid tool objects', () => {
    const tools: any[] = [
      {
        type: 'function',
        name: 'valid_tool',
        inputSchema: { type: 'object', properties: {} },
      },
      null, // Invalid
      'string', // Invalid
      123, // Invalid
    ];

    const toolSet = convertLanguageModelToolsToToolSet(tools);

    expect(toolSet).toBeDefined();
    expect(Object.keys(toolSet!)).toHaveLength(1);
  });

  it('should skip provider-defined tools', () => {
    const tools: any[] = [
      {
        type: 'function',
        name: 'function_tool',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        type: 'web_search', // Provider-defined tool (no inputSchema)
      },
    ];

    const toolSet = convertLanguageModelToolsToToolSet(tools);

    expect(toolSet).toBeDefined();
    expect(Object.keys(toolSet!)).toHaveLength(1);
    expect(toolSet!.function_tool).toBeDefined();
  });

  it('should return undefined when all tools are invalid', () => {
    const tools: any[] = [
      null,
      { type: 'function' }, // No name
      { name: 'test' }, // No inputSchema
    ];

    const toolSet = convertLanguageModelToolsToToolSet(tools);

    expect(toolSet).toBeUndefined();
  });
});

describe('convertLanguageModelToolChoice', () => {
  it('should convert auto', () => {
    const toolChoice = convertLanguageModelToolChoice(
      { type: 'auto' },
      new Set(['tool1', 'tool2'])
    );

    expect(toolChoice).toBe('auto');
  });

  it('should convert none', () => {
    const toolChoice = convertLanguageModelToolChoice(
      { type: 'none' },
      new Set(['tool1', 'tool2'])
    );

    expect(toolChoice).toBe('none');
  });

  it('should convert required', () => {
    const toolChoice = convertLanguageModelToolChoice(
      { type: 'required' },
      new Set(['tool1', 'tool2'])
    );

    expect(toolChoice).toBe('required');
  });

  it('should convert specific tool', () => {
    const toolChoice = convertLanguageModelToolChoice(
      { type: 'tool', toolName: 'get_weather' },
      new Set(['get_weather', 'get_time'])
    );

    expect(toolChoice).toMatchObject({
      type: 'tool',
      toolName: 'get_weather',
    });
  });

  it('should return undefined for invalid tool name', () => {
    const toolChoice = convertLanguageModelToolChoice(
      { type: 'tool', toolName: 'invalid_tool' },
      new Set(['get_weather', 'get_time'])
    );

    expect(toolChoice).toBeUndefined();
  });

  it('should return undefined for undefined input', () => {
    const toolChoice = convertLanguageModelToolChoice(
      undefined,
      new Set(['tool1'])
    );

    expect(toolChoice).toBeUndefined();
  });

  it('should handle empty function tools set', () => {
    const toolChoice = convertLanguageModelToolChoice(
      { type: 'tool', toolName: 'my_tool' },
      new Set()
    );

    expect(toolChoice).toBeUndefined();
  });

  it('should validate tool exists in function tools for specific choice', () => {
    const toolChoice = convertLanguageModelToolChoice(
      { type: 'tool', toolName: 'provider_tool' },
      new Set(['function_tool1', 'function_tool2'])
    );

    // Should return undefined because provider_tool is not in the function tools set
    expect(toolChoice).toBeUndefined();
  });

  it('should allow any tool name for auto/none/required', () => {
    // These should work regardless of the function tools set
    expect(
      convertLanguageModelToolChoice({ type: 'auto' }, new Set())
    ).toBe('auto');
    
    expect(
      convertLanguageModelToolChoice({ type: 'none' }, new Set())
    ).toBe('none');
    
    expect(
      convertLanguageModelToolChoice({ type: 'required' }, new Set())
    ).toBe('required');
  });
});
