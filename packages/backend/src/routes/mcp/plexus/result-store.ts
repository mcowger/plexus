import type { ToolResponse } from './types';

export const MCP_RESULT_LIMIT_BYTES = 128 * 1024;
const MAX_STORED_BYTES = 256 * 1024 * 1024;
const RESULT_TTL_MS = 15 * 60 * 1000;

export class McpResultStore {
  private readonly results = new Map<string, { body: string; bytes: number; expiresAt: number }>();
  private storedBytes = 0;

  private remove(id: string) {
    const result = this.results.get(id);
    if (result) {
      this.storedBytes -= result.bytes;
      this.results.delete(id);
    }
  }

  expire() {
    const now = Date.now();
    for (const [id, result] of this.results) {
      if (result.expiresAt <= now) this.remove(id);
    }
  }

  put(body: string, bytes: number) {
    this.expire();
    if (bytes > MAX_STORED_BYTES) return null;
    while (this.storedBytes + bytes > MAX_STORED_BYTES) {
      const oldest = this.results.keys().next().value;
      if (!oldest) break;
      this.remove(oldest);
    }
    const id = crypto.randomUUID();
    const expiresAt = Date.now() + RESULT_TTL_MS;
    this.results.set(id, { body, bytes, expiresAt });
    this.storedBytes += bytes;
    return { id, expiresAt };
  }

  get(id: string) {
    this.expire();
    return this.results.get(id)?.body;
  }

  clear() {
    this.results.clear();
    this.storedBytes = 0;
  }
}

export function serializeToolResponse(response: ToolResponse): string {
  return JSON.stringify(response);
}
