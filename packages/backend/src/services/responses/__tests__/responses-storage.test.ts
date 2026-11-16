import { afterEach, describe, expect, it } from 'bun:test';

import type { UnifiedResponsesResponse } from '../../../types/responses';
import { ResponsesStorageService } from '../responses-storage';

const storage = new ResponsesStorageService();
const ids: string[] = [];

function response(output: unknown[]): UnifiedResponsesResponse {
  const id = `resp_storage_${crypto.randomUUID()}`;
  ids.push(id);
  return {
    id,
    object: 'response',
    created_at: 123,
    status: 'completed',
    model: 'test-model',
    output,
  } as UnifiedResponsesResponse;
}

afterEach(async () => {
  for (const id of ids.splice(0)) await storage.deleteResponse(id);
});

describe('response storage', () => {
  it('preserves the full replay snapshot and opaque native output items', async () => {
    const input = [
      { role: 'user', content: [{ type: 'input_text', text: 'first' }] },
      { type: 'reasoning', id: 'reasoning_opaque', encrypted_content: 'encrypted' },
      {
        type: 'function_call',
        id: 'call_item',
        call_id: 'call_1',
        name: 'lookup',
        arguments: '{}',
      },
      { type: 'function_call_output', call_id: 'call_1', output: 'result' },
      { role: 'user', content: 'next' },
    ];
    const output = [
      { type: 'reasoning', id: 'shared_native_id', encrypted_content: 'opaque' },
      {
        type: 'function_call',
        id: 'tool_native_id',
        call_id: 'call_2',
        name: 'lookup',
        arguments: '{}',
      },
    ];
    const first = response(output);
    const second = response(output);
    await storage.storeResponse(first, { input, store: true });
    await storage.storeResponse(second, { input, store: true });

    const row = await storage.getResponse(first.id);
    expect(JSON.parse(row.inputItems)).toEqual(input);
    expect(JSON.parse(row.outputItems)).toEqual(output);
    expect(row.store).toBe(1);
    expect(storage.formatStoredResponse(row).id).toBe(first.id);
    expect(storage.formatStoredResponse(row).output).toEqual(output);

    const secondRow = await storage.getResponse(second.id);
    expect(JSON.parse(secondRow.outputItems)).toEqual(output);
  });

  it('records store only for explicit true and leaves missing snapshots null', async () => {
    for (const store of [undefined, false, true]) {
      const result = response([]);
      await storage.storeResponse(result, { store });
      const row = await storage.getResponse(result.id);
      expect(row.inputItems).toBeNull();
      expect(row.store).toBe(store === true ? 1 : 0);
    }
  });
});
