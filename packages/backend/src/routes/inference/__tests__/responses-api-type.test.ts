import { describe, expect, test } from 'vitest';

import { detectResponsesApiType } from '../responses';

describe('Responses API subtype detection', () => {
  test('detects Lite from the Codex header', () => {
    expect(
      detectResponsesApiType({ 'x-openai-internal-codex-responses-lite': 'true' }, { input: [] })
    ).toBe('responses:lite');
  });

  test('detects Lite from an additional_tools input item when the header was stripped', () => {
    expect(
      detectResponsesApiType({}, { input: [{ type: 'additional_tools', role: 'developer' }] })
    ).toBe('responses:lite');
  });

  test('keeps ordinary Responses requests on the base API type', () => {
    expect(detectResponsesApiType({}, { input: [{ type: 'message', role: 'user' }] })).toBe(
      'responses'
    );
  });

  test('detects Lite from a declared tool_search tool even without additional_tools or the header', () => {
    // Reproduces staging debug trace b672ebbd: a genuine Codex CLI request
    // that declares its lazy tool-discovery tool (`tool_search`) up front
    // instead of sending an `additional_tools` input item, and without the
    // internal header. Missing this signal caused the request to lose
    // routing preference for providers explicitly configured to support
    // `responses:lite`.
    expect(
      detectResponsesApiType(
        {},
        {
          input: [{ type: 'message', role: 'user' }],
          tools: [
            { type: 'function', name: 'exec_command' },
            { type: 'tool_search', description: 'Tool discovery' },
          ],
        }
      )
    ).toBe('responses:lite');
  });
});
