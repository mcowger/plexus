import { describe, expect, it } from 'bun:test';

import { cacheResponsesInstructionsAdapter as adapter } from '../../transformers/adapters/cache-responses-instructions.adapter';

const developer = (text: string) => ({
  type: 'message',
  role: 'developer',
  content: [{ type: 'input_text', text }],
});

describe('cacheResponsesInstructionsAdapter', () => {
  it('normalizes string input and preserves instruction bytes', () => {
    const body = { instructions: '  Rules\n', input: 'Hi', model: 'test' };
    const result = adapter.preDispatch(body);
    expect(result).toEqual({
      model: 'test',
      input: [
        developer('  Rules\n'),
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Hi' }],
        },
      ],
    });
    expect(body).toEqual({ instructions: '  Rules\n', input: 'Hi', model: 'test' });
    expect(adapter.preDispatch(result)).toBe(result);
  });

  it('inserts after only the contiguous leading additional_tools items', () => {
    const first = { type: 'additional_tools', tools: [] };
    const second = { type: 'additional_tools', tools: [{ name: 'tool' }] };
    const later = { type: 'additional_tools', tools: [] };
    const body = { instructions: 'Rules', input: [first, second, null, later, 'scalar'] };
    expect(adapter.preDispatch(body)).toEqual({
      input: [first, second, developer('Rules'), null, later, 'scalar'],
    });
    expect(body.input).toEqual([first, second, null, later, 'scalar']);
    expect(adapter.preDispatch({ instructions: 'Rules', input: ['scalar', first] }).input).toEqual([
      developer('Rules'),
      'scalar',
      first,
    ]);
  });

  it('does not deduplicate native guidance and permits null state fields', () => {
    const existing = developer('Rules');
    const body = {
      instructions: 'Rules',
      input: [existing],
      conversation: null,
      previous_response_id: null,
      store: false,
    };
    expect(adapter.preDispatch(body)).toEqual({
      input: [developer('Rules'), existing],
      conversation: null,
      previous_response_id: null,
      store: false,
    });
  });

  it('accepts absent and null input', () => {
    for (const body of [{ instructions: 'Rules' }, { instructions: 'Rules', input: null }]) {
      expect(adapter.preDispatch(body)).toEqual({ input: [developer('Rules')] });
    }
  });

  it('returns the original body when instructions or state are ineligible', () => {
    const cases = [
      {},
      { instructions: null },
      { instructions: '' },
      { instructions: ' \n\t' },
      { instructions: 3 },
      { instructions: {} },
      { instructions: 'Rules', input: {} },
      { instructions: 'Rules', conversation: 'conv' },
      { instructions: 'Rules', conversation: {} },
      { instructions: 'Rules', previous_response_id: 'resp' },
      { instructions: 'Rules', store: true },
    ];
    for (const body of cases) expect(adapter.preDispatch(body)).toBe(body);
  });

  it('preserves responses unchanged', () => {
    const response = { output: [] };
    expect(adapter.postDispatch(response)).toBe(response);
  });
});
