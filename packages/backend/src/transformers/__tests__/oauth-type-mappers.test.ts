/**
 * Regression tests for unifiedToContext / unifiedToolToPiAi schema conversion.
 *
 * Previously, the 'array' case used Type.Array(Type.Any()), which produced
 * `items: {}` — silently dropping all nested object structure (properties,
 * required, additionalProperties).  The 'object' case was missing entirely,
 * causing nested objects to become Type.Any() as well.
 *
 * This caused models to ignore required fields like `header` and
 * `options[*].description` on the OpenCode `question` tool, producing invalid
 * tool calls that failed Zod validation.
 */

import { describe, expect, test } from 'bun:test';
import { unifiedToContext, normalizeContextMessages } from '../oauth/type-mappers';
import type { UnifiedChatRequest } from '../../types/unified';

// The full input_schema for OpenCode's `question` tool — the real-world trigger
// for this bug.
const QUESTION_TOOL_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object' as const,
  properties: {
    questions: {
      description: 'Questions to ask',
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { description: 'Complete question', type: 'string' },
          header: { description: 'Very short label (max 30 chars)', type: 'string' },
          options: {
            description: 'Available choices',
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { description: 'Display text (1-5 words, concise)', type: 'string' },
                description: { description: 'Explanation of choice', type: 'string' },
              },
              required: ['label', 'description'],
              additionalProperties: false,
            },
          },
          multiple: { description: 'Allow selecting multiple choices', type: 'boolean' },
        },
        required: ['question', 'header', 'options'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
};

function buildRequest(toolSchema: typeof QUESTION_TOOL_SCHEMA): UnifiedChatRequest {
  return {
    model: 'claude-test',
    messages: [{ role: 'user', content: 'hello' }],
    tools: [
      {
        type: 'function',
        function: {
          name: 'question',
          description: 'Ask the user questions',
          parameters: toolSchema,
        },
      },
    ],
  };
}

function getParams(schema: typeof QUESTION_TOOL_SCHEMA): any {
  const context = unifiedToContext(buildRequest(schema));
  expect(context.tools).toBeDefined();
  expect(context.tools!.length).toBeGreaterThan(0);
  return context.tools![0]!.parameters as any;
}

describe('unifiedToolToPiAi — nested schema preservation', () => {
  test('array items schema is not dropped (regression: Type.Array(Type.Any()))', () => {
    const params = getParams(QUESTION_TOOL_SCHEMA);

    // Top-level questions property must be an array
    expect(params.properties.questions.type).toBe('array');

    // items must not be empty — the old bug produced `items: {}`
    const items = params.properties.questions.items;
    expect(items).toBeDefined();
    expect(Object.keys(items).length).toBeGreaterThan(0);
  });

  test('nested object properties are preserved inside array items', () => {
    const params = getParams(QUESTION_TOOL_SCHEMA);
    const items = params.properties.questions.items;

    // The items object must have its properties
    expect(items.properties).toBeDefined();
    expect(items.properties.question).toBeDefined();
    expect(items.properties.header).toBeDefined();
    expect(items.properties.options).toBeDefined();
    expect(items.properties.multiple).toBeDefined();
  });

  test('required array on nested object items is preserved', () => {
    const params = getParams(QUESTION_TOOL_SCHEMA);
    const items = params.properties.questions.items;

    // required must list question, header, and options — not be missing
    expect(items.required).toEqual(['question', 'header', 'options']);
  });

  test('additionalProperties on nested object items is preserved', () => {
    const params = getParams(QUESTION_TOOL_SCHEMA);
    const items = params.properties.questions.items;

    expect(items.additionalProperties).toBe(false);
  });

  test('doubly-nested array-of-object schema (options items) is preserved', () => {
    const params = getParams(QUESTION_TOOL_SCHEMA);
    const optionsItems = params.properties.questions.items.properties.options.items;

    // options items must have its own properties
    expect(optionsItems).toBeDefined();
    expect(optionsItems.properties?.label).toBeDefined();
    expect(optionsItems.properties?.description).toBeDefined();
  });

  test('required on doubly-nested options items is preserved', () => {
    const params = getParams(QUESTION_TOOL_SCHEMA);
    const optionsItems = params.properties.questions.items.properties.options.items;

    expect(optionsItems.required).toEqual(['label', 'description']);
  });

  test('additionalProperties on doubly-nested options items is preserved', () => {
    const params = getParams(QUESTION_TOOL_SCHEMA);
    const optionsItems = params.properties.questions.items.properties.options.items;

    expect(optionsItems.additionalProperties).toBe(false);
  });

  test('scalar types within nested objects are correctly typed', () => {
    const params = getParams(QUESTION_TOOL_SCHEMA);
    const itemProps = params.properties.questions.items.properties;

    expect(itemProps.question.type).toBe('string');
    expect(itemProps.header.type).toBe('string');
    expect(itemProps.multiple.type).toBe('boolean');
    expect(itemProps.options.type).toBe('array');
  });

  test('descriptions are preserved at all nesting levels', () => {
    const params = getParams(QUESTION_TOOL_SCHEMA);

    expect(params.properties.questions.description).toBe('Questions to ask');
    expect(params.properties.questions.items.properties.question.description).toBe(
      'Complete question'
    );
    expect(params.properties.questions.items.properties.header.description).toBe(
      'Very short label (max 30 chars)'
    );
    expect(params.properties.questions.items.properties.options.description).toBe(
      'Available choices'
    );
    expect(
      params.properties.questions.items.properties.options.items.properties.label.description
    ).toBe('Display text (1-5 words, concise)');
    expect(
      params.properties.questions.items.properties.options.items.properties.description.description
    ).toBe('Explanation of choice');
  });

  test('top-level tool parameters structure is intact', () => {
    const params = getParams(QUESTION_TOOL_SCHEMA);

    expect(params.type).toBe('object');
    expect(params.required).toEqual(['questions']);
    expect(params.additionalProperties).toBe(false);
  });
});

/**
 * Regression test for thinking-block ordering in assistant message history.
 *
 * Bug: When an assistant message contained both a thinking block and tool_use
 * blocks, unifiedMessageToAssistantMessage placed the thinking block AFTER
 * the toolCall blocks. Anthropic's API requires thinking to come BEFORE
 * tool_use in the content array, otherwise it returns:
 *   400 "tool_use ids were found without tool_result blocks immediately after"
 *
 * Fix: Move the thinking block push to the top of the content array.
 */
describe('unifiedToContext — thinking block ordering (regression)', () => {
  test('thinking block appears before toolCall blocks in assistant messages', () => {
    const request: UnifiedChatRequest = {
      model: 'claude-sonnet-4-6',
      messages: [
        { role: 'user', content: 'What is the weather in Paris?' },
        {
          role: 'assistant',
          content: '',
          thinking: {
            content: 'I need to call the weather tool to get this information.',
            signature: 'EqoBCkgIARgCIkDrealSignatureHere==',
          },
          tool_calls: [
            {
              id: 'toolu_bdrk_013JTDbmRhmyrKxhKR9Q2e1y',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: '{"location":"Paris"}',
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'toolu_bdrk_013JTDbmRhmyrKxhKR9Q2e1y',
          name: 'get_weather',
          content: 'Sunny, 22°C',
        },
        { role: 'user', content: 'Thanks, what about London?' },
      ],
    };

    const context = unifiedToContext(request);

    // Find the assistant message (index 1 after user message at index 0)
    const assistantMsg = context.messages[1] as any;
    expect(assistantMsg.role).toBe('assistant');

    const contentTypes = (assistantMsg.content as any[]).map((b: any) => b.type);

    // thinking MUST appear in the content array
    expect(contentTypes).toContain('thinking');
    // toolCall MUST appear in the content array
    expect(contentTypes).toContain('toolCall');
    // thinking MUST come before toolCall (Anthropic API requirement)
    expect(contentTypes.indexOf('thinking')).toBeLessThan(contentTypes.indexOf('toolCall'));
  });

  test('thinking block content and signature are preserved', () => {
    const request: UnifiedChatRequest = {
      model: 'claude-sonnet-4-6',
      messages: [
        { role: 'user', content: 'hello' },
        {
          role: 'assistant',
          content: '',
          thinking: {
            content: 'Let me think about this.',
            signature: 'EqoBCkgIARgCIkDrealSignatureHere==',
          },
          tool_calls: [
            {
              id: 'toolu_01XYZ',
              type: 'function',
              function: { name: 'some_tool', arguments: '{}' },
            },
          ],
        },
      ],
    };

    const context = unifiedToContext(request);
    const assistantMsg = context.messages[1] as any;
    const thinkingBlock = (assistantMsg.content as any[]).find((b: any) => b.type === 'thinking');

    expect(thinkingBlock).toBeDefined();
    expect(thinkingBlock.thinking).toBe('Let me think about this.');
    expect(thinkingBlock.thinkingSignature).toBe('EqoBCkgIARgCIkDrealSignatureHere==');
  });

  test('assistant message without thinking still produces correct toolCall-only content', () => {
    const request: UnifiedChatRequest = {
      model: 'claude-sonnet-4-6',
      messages: [
        { role: 'user', content: 'hello' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'toolu_01ABC',
              type: 'function',
              function: { name: 'some_tool', arguments: '{"x":1}' },
            },
          ],
        },
      ],
    };

    const context = unifiedToContext(request);
    const assistantMsg = context.messages[1] as any;
    const contentTypes = (assistantMsg.content as any[]).map((b: any) => b.type);

    expect(contentTypes).not.toContain('thinking');
    expect(contentTypes).toContain('toolCall');
  });
});

/**
 * Regression tests for non-JSON tool call arguments in message history.
 *
 * Bug: When an assistant message in history contained a tool_call whose
 * `arguments` field was not valid JSON (e.g. raw patch text from an
 * `apply_patch` tool), `unifiedMessageToAssistantMessage` called
 * `JSON.parse(toolCall.function.arguments)` unconditionally and threw
 * "JSON Parse error: Unable to parse JSON string", aborting the entire
 * request transformation before it could reach the OAuth provider.
 *
 * Fix: Wrap the JSON.parse in a try/catch and fall back to
 * `{ _raw: arguments }` so the message is preserved and the request
 * can proceed.
 */
describe('unifiedToContext — non-JSON tool call arguments (regression)', () => {
  test('raw patch text in tool call arguments does not throw', () => {
    const request: UnifiedChatRequest = {
      model: 'gpt-5.4',
      messages: [
        { role: 'user', content: 'fix my code' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_abc123',
              type: 'function',
              function: {
                name: 'apply_patch',
                // Raw patch text — not JSON
                arguments:
                  '*** Begin Patch\n*** Update File: src/foo.ts\n-old line\n+new line\n*** End Patch',
              },
            },
          ],
        },
        { role: 'user', content: 'did it work?' },
      ],
    };

    expect(() => unifiedToContext(request)).not.toThrow();
  });

  test('non-JSON arguments are wrapped in { _raw } and passed through', () => {
    const rawPatch = '*** Begin Patch\n-old\n+new\n*** End Patch';
    const request: UnifiedChatRequest = {
      model: 'gpt-5.4',
      messages: [
        { role: 'user', content: 'hello' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_xyz',
              type: 'function',
              function: { name: 'apply_patch', arguments: rawPatch },
            },
          ],
        },
      ],
    };

    const context = unifiedToContext(request);
    const assistantMsg = context.messages[1] as any;
    const toolCallBlock = (assistantMsg.content as any[]).find((b: any) => b.type === 'toolCall');

    expect(toolCallBlock).toBeDefined();
    expect(toolCallBlock.arguments).toEqual({ _raw: rawPatch });
  });

  test('valid JSON arguments are still parsed normally', () => {
    const request: UnifiedChatRequest = {
      model: 'gpt-5.4',
      messages: [
        { role: 'user', content: 'hello' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_ok',
              type: 'function',
              function: { name: 'some_tool', arguments: '{"key":"value","num":42}' },
            },
          ],
        },
      ],
    };

    const context = unifiedToContext(request);
    const assistantMsg = context.messages[1] as any;
    const toolCallBlock = (assistantMsg.content as any[]).find((b: any) => b.type === 'toolCall');

    expect(toolCallBlock.arguments).toEqual({ key: 'value', num: 42 });
  });

  test('multiple tool calls — bad arguments in one do not break others', () => {
    const request: UnifiedChatRequest = {
      model: 'gpt-5.4',
      messages: [
        { role: 'user', content: 'hello' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_good',
              type: 'function',
              function: { name: 'good_tool', arguments: '{"x":1}' },
            },
            {
              id: 'call_bad',
              type: 'function',
              function: { name: 'apply_patch', arguments: 'not json at all' },
            },
          ],
        },
      ],
    };

    expect(() => unifiedToContext(request)).not.toThrow();

    const context = unifiedToContext(request);
    const assistantMsg = context.messages[1] as any;
    const blocks = assistantMsg.content as any[];

    const goodBlock = blocks.find((b: any) => b.name === 'good_tool');
    const badBlock = blocks.find((b: any) => b.name === 'apply_patch');

    expect(goodBlock.arguments).toEqual({ x: 1 });
    expect(badBlock.arguments).toEqual({ _raw: 'not json at all' });
  });
});

/**
 * Regression tests for assistant message content being a string instead of array.
 *
 * Bug: When OpenWebUI sends a second request with conversation history, the
 * assistant message's content is a string (standard OpenAI format). pi-ai's
 * transformMessages calls `assistantMsg.content.flatMap(...)` which throws
 * "assistantMsg.content.flatMap is not a function" when content is a string.
 *
 * Fix:
 * 1. unifiedMessageToAssistantMessage now always returns array content
 *    (even for empty strings, which previously resulted in an empty content array)
 * 2. normalizeContextMessages ensures any assistant message with string content
 *    is converted to array format before being passed to pi-ai
 */
describe('unifiedToContext — assistant content always an array (regression)', () => {
  test('assistant message with string content produces array in context', () => {
    const request: UnifiedChatRequest = {
      model: 'claude-opus-4-5',
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'how are you?' },
      ],
    };

    const context = unifiedToContext(request);
    const assistantMsg = context.messages[1] as any;
    expect(assistantMsg.role).toBe('assistant');
    expect(Array.isArray(assistantMsg.content)).toBe(true);
    expect(assistantMsg.content.length).toBeGreaterThan(0);
    expect(assistantMsg.content[0].type).toBe('text');
    expect(assistantMsg.content[0].text).toBe('Hi there!');
  });

  test('assistant message with empty string content produces array (not string)', () => {
    const request: UnifiedChatRequest = {
      model: 'claude-opus-4-5',
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: '' },
      ],
    };

    const context = unifiedToContext(request);
    const assistantMsg = context.messages[1] as any;
    expect(assistantMsg.role).toBe('assistant');
    expect(Array.isArray(assistantMsg.content)).toBe(true);
    // Empty string still produces a text block so content is never an empty array
    expect(assistantMsg.content.length).toBe(1);
    expect(assistantMsg.content[0].type).toBe('text');
  });

  test('assistant message with null content and no tool_calls produces array', () => {
    const request: UnifiedChatRequest = {
      model: 'claude-opus-4-5',
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: null as any },
      ],
    };

    const context = unifiedToContext(request);
    const assistantMsg = context.messages[1] as any;
    expect(assistantMsg.role).toBe('assistant');
    // Even with null content and no tool_calls, content must be an array
    expect(Array.isArray(assistantMsg.content)).toBe(true);
  });

  test('assistant message with null content but tool_calls still works', () => {
    const request: UnifiedChatRequest = {
      model: 'claude-opus-4-5',
      messages: [
        { role: 'user', content: 'hello' },
        {
          role: 'assistant',
          content: null as any,
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
            },
          ],
        },
      ],
    };

    const context = unifiedToContext(request);
    const assistantMsg = context.messages[1] as any;
    expect(assistantMsg.role).toBe('assistant');
    expect(Array.isArray(assistantMsg.content)).toBe(true);
    expect(assistantMsg.content.some((b: any) => b.type === 'toolCall')).toBe(true);
  });
});

describe('normalizeContextMessages — defensive normalization (regression)', () => {
  test('converts assistant message with string content to array', () => {
    const context = {
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'how are you?' },
      ],
    };

    const normalized = normalizeContextMessages(context as any);
    const assistantMsg = normalized.messages[1] as any;
    expect(Array.isArray(assistantMsg.content)).toBe(true);
    expect(assistantMsg.content).toEqual([{ type: 'text', text: 'Hi there!' }]);
  });

  test('handles assistant message with empty string content', () => {
    const context = {
      messages: [{ role: 'assistant', content: '' }],
    };

    const normalized = normalizeContextMessages(context as any);
    const assistantMsg = normalized.messages[0] as any;
    expect(Array.isArray(assistantMsg.content)).toBe(true);
    // Empty string produces empty array (no text block for empty text)
    expect(assistantMsg.content).toEqual([]);
  });

  test('leaves already-array content unchanged', () => {
    const context = {
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'toolCall', id: 'call_1', name: 'test', arguments: {} },
          ],
        },
      ],
    };

    const normalized = normalizeContextMessages(context as any);
    const assistantMsg = normalized.messages[0] as any;
    expect(assistantMsg.content).toHaveLength(2);
    expect(assistantMsg.content[0].type).toBe('text');
    expect(assistantMsg.content[1].type).toBe('toolCall');
  });

  test('leaves user messages unchanged', () => {
    const context = {
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      ],
    };

    const normalized = normalizeContextMessages(context as any);
    expect((normalized.messages[0] as any).content).toBe('hello');
    expect(Array.isArray((normalized.messages[1] as any).content)).toBe(true);
  });

  test('handles non-string, non-array content on assistant message', () => {
    const context = {
      messages: [{ role: 'assistant', content: null }],
    };

    const normalized = normalizeContextMessages(context as any);
    const assistantMsg = normalized.messages[0] as any;
    expect(Array.isArray(assistantMsg.content)).toBe(true);
    expect(assistantMsg.content).toEqual([]);
  });

  test('preserves other message properties when normalizing', () => {
    const context = {
      messages: [
        {
          role: 'assistant',
          content: 'response text',
          api: 'anthropic-messages',
          provider: 'anthropic',
          model: 'claude-opus-4-5',
          stopReason: 'stop',
          usage: { input: 10, output: 20 },
        },
      ],
    };

    const normalized = normalizeContextMessages(context as any);
    const assistantMsg = normalized.messages[0] as any;
    expect(assistantMsg.api).toBe('anthropic-messages');
    expect(assistantMsg.provider).toBe('anthropic');
    expect(assistantMsg.model).toBe('claude-opus-4-5');
    expect(assistantMsg.stopReason).toBe('stop');
    expect(assistantMsg.usage).toEqual({ input: 10, output: 20 });
  });
});
