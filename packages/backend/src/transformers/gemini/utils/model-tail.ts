import type { Content } from '@google/genai';

/**
 * Keys allowed on a text-only model part. Mirrors LiteLLM PR #38652
 * (`_TEXT_ONLY_MODEL_PART_KEYS`): a trailing model turn is only eligible
 * for the synthetic user-turn placeholder when every part carries `text`
 * plus optional thought metadata. Tool calls (`functionCall`), tool
 * results (`functionResponse`), server-side tools (`toolCall` /
 * `toolResponse`, `executableCode` / `codeExecutionResult`), and media
 * (`inlineData` / `fileData`) tails are left alone — inserting a user turn
 * there would break functionCall → functionResponse pairing.
 */
const TEXT_ONLY_MODEL_PART_KEYS = new Set(['text', 'thought', 'thoughtSignature']);

/**
 * Returns true when `content` is a model turn whose parts are text/thought
 * metadata only. Empty-parts model turns return false (nothing to continue).
 */
export function isTextOnlyModelContent(content: any): boolean {
  if (!content || content.role !== 'model') return false;
  const parts = content.parts;
  if (!Array.isArray(parts) || parts.length === 0) return false;
  return parts.every((part: any) => {
    if (!part || typeof part !== 'object' || !('text' in part)) return false;
    return Object.keys(part).every((key) => TEXT_ONLY_MODEL_PART_KEYS.has(key));
  });
}

/**
 * Gemini 3+ rejects histories ending on a model turn
 * (`Requests ending with a model turn are not supported`, LiteLLM #38537 /
 * PR #38652). When the last entry of `contents` is a text-only model turn,
 * append a minimal `user` turn (`"."`) so the request is accepted upstream.
 * Tool-call, media, and empty tails are returned unchanged.
 *
 * Returns the (possibly new) contents array. Does not mutate the input.
 */
export function appendUserAfterTextOnlyModelTail<T extends { role?: string }>(contents: T[]): T[] {
  if (!Array.isArray(contents) || contents.length === 0) return contents;
  if (!isTextOnlyModelContent(contents[contents.length - 1])) return contents;
  const placeholder = { role: 'user', parts: [{ text: '.' }] } as unknown as T;
  return [...contents, placeholder];
}

/**
 * Mutating variant used by the request builder: appends the placeholder in
 * place when the trailing turn is a text-only model turn. Returns true when
 * a turn was appended.
 */
export function ensureContentsEndWithUser(contents: Content[]): boolean {
  if (!Array.isArray(contents) || contents.length === 0) return false;
  if (!isTextOnlyModelContent(contents[contents.length - 1])) return false;
  contents.push({ role: 'user', parts: [{ text: '.' }] });
  return true;
}
