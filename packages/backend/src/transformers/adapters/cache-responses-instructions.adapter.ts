import type { ProviderAdapter } from '../../types/provider-adapter';
import { normalizeInput } from '../responses/request-parser';

export const cacheResponsesInstructionsAdapter: ProviderAdapter = {
  name: 'cache_responses_instructions',

  preDispatch(payload: Record<string, unknown>): Record<string, unknown> {
    const { instructions, input } = payload;
    if (
      typeof instructions !== 'string' ||
      !instructions.trim() ||
      (input != null && typeof input !== 'string' && !Array.isArray(input)) ||
      payload.conversation != null ||
      payload.previous_response_id != null ||
      payload.store === true
    ) {
      return payload;
    }

    const items =
      input == null ? [] : typeof input === 'string' ? normalizeInput(input) : [...input];
    let index = 0;
    while (index < items.length && items[index]?.type === 'additional_tools') index++;
    items.splice(index, 0, {
      type: 'message',
      role: 'developer',
      content: [{ type: 'input_text', text: instructions }],
    });
    const { instructions: _instructions, ...rest } = payload;
    return { ...rest, input: items };
  },
  postDispatch(response: Record<string, unknown>): Record<string, unknown> {
    return response;
  },
};
