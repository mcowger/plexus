import { describe, expect, spyOn, test } from 'bun:test';

import { toToolResult } from '../plexus/responses';
import { MCP_RESULT_LIMIT_BYTES, McpResultStore } from '../plexus/result-store';

describe('management MCP result storage', () => {
  test('keeps small multibyte responses in one compact text item', () => {
    const response = { ok: true, operation: 'get', data: '日志' };
    const result = toToolResult(response, new McpResultStore(), 'https://plexus.example');
    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(response) }]);
  });

  test('caps serialized results including JSON escaping', () => {
    const store = new McpResultStore();
    const response = { ok: true, operation: 'get', data: '"'.repeat(MCP_RESULT_LIMIT_BYTES / 3) };
    const result = toToolResult(response, store, 'https://plexus.example');
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(MCP_RESULT_LIMIT_BYTES);
    const item = result.content[0];
    if (!item || item.type !== 'text') throw new Error('Expected text result');
    const metadata = JSON.parse(item.text);
    const id = new URL(metadata.download.url).pathname.split('/').pop();
    if (!id) throw new Error('Expected result ID');
    expect(store.get(id)).toBe(JSON.stringify(response));
  });

  test('expires stored results at the stated time', () => {
    const store = new McpResultStore();
    const saved = store.put('payload', 7);
    if (!saved) throw new Error('Expected stored result');
    const clock = spyOn(Date, 'now').mockReturnValue(saved.expiresAt);
    try {
      expect(store.get(saved.id)).toBeUndefined();
    } finally {
      clock.mockRestore();
    }
  });
});
