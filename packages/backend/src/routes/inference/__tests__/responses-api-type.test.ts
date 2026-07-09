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
});
