export const OPENAI_RESPONSES_CALL_ID_MAX_LENGTH = 64;
export const OPENAI_RESPONSES_REASONING_CONTENT_MAX_ITEMS = 0;

// Some Responses clients have been observed replaying tool calls with composite
// IDs like "call_...|fc_...". OpenAI-compatible providers validate call_id
// length and require the model-generated "call_..." ID when the composite ID is
// too long, so only repair that exact observed shape once it violates the
// OpenAI limit instead of rewriting arbitrary caller-provided IDs.
export function normalizeCompositeResponsesCallIds(body: unknown): number {
  if (!body || typeof body !== 'object' || !('input' in body) || !Array.isArray(body.input)) {
    return 0;
  }

  let normalizedCount = 0;
  for (const item of body.input) {
    if (
      !item ||
      typeof item !== 'object' ||
      !('call_id' in item) ||
      typeof item.call_id !== 'string'
    ) {
      continue;
    }

    if (item.call_id.length <= OPENAI_RESPONSES_CALL_ID_MAX_LENGTH) {
      continue;
    }

    const separatorIndex = item.call_id.indexOf('|');
    if (separatorIndex <= 0) {
      continue;
    }

    const callId = item.call_id.slice(0, separatorIndex);
    const itemId = item.call_id.slice(separatorIndex + 1);
    if (!callId.startsWith('call_') || !itemId.startsWith('fc_')) {
      continue;
    }

    const mutableItem = item as Record<string, unknown>;
    mutableItem.call_id = callId;
    normalizedCount++;
  }

  return normalizedCount;
}

// Some Responses clients (observed: codex_cli_rs replaying rebuilt function
// call history) send function_call items whose item `id` is the call ID
// ("call_...") rather than the server-assigned "fc_..." item ID. Strict
// Responses providers answer that with
// `Invalid 'input[N].id': 'call_...'. Expected an ID that begins with 'fc'`.
// The item id is optional on input and `call_id` is what correlates the call
// with its function_call_output, so drop that exact observed bad shape instead
// of rewriting arbitrary caller-provided IDs.
export function normalizeResponsesFunctionCallItemIds(body: unknown): number {
  if (!body || typeof body !== 'object' || !('input' in body) || !Array.isArray(body.input)) {
    return 0;
  }

  let normalizedCount = 0;
  for (const item of body.input) {
    if (!item || typeof item !== 'object' || !('type' in item) || item.type !== 'function_call') {
      continue;
    }
    if (!('id' in item) || typeof item.id !== 'string' || !item.id.startsWith('call_')) {
      continue;
    }

    const mutableItem = item as Record<string, unknown>;
    delete mutableItem.id;
    normalizedCount++;
  }

  return normalizedCount;
}

// Reasoning items are valid replay context, but some OpenAI-compatible
// Responses providers reject replayed plaintext reasoning text with
// "content max length 0". Drop only the optional plaintext content array once
// it violates that limit while preserving the reasoning item, summary, status,
// id, and encrypted_content.
export function normalizeResponsesReasoningContent(body: unknown): number {
  if (!body || typeof body !== 'object' || !('input' in body) || !Array.isArray(body.input)) {
    return 0;
  }

  let normalizedCount = 0;
  for (const item of body.input) {
    if (
      !item ||
      typeof item !== 'object' ||
      !('type' in item) ||
      item.type !== 'reasoning' ||
      !('content' in item) ||
      !Array.isArray(item.content) ||
      item.content.length <= OPENAI_RESPONSES_REASONING_CONTENT_MAX_ITEMS
    ) {
      continue;
    }

    const mutableItem = item as Record<string, unknown>;
    mutableItem.content = [];
    normalizedCount++;
  }

  return normalizedCount;
}
