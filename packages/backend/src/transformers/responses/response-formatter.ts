import {
  ResponsesOutputItem,
  ResponsesReasoningTextPart,
  ResponsesSummaryTextPart,
} from '../../types/responses';
import { UnifiedChatResponse } from '../../types/unified';
import { ResponsesToolState, buildToolOutputItem } from './tool-mapper';
import { buildResponsesUsagePayload, generateItemId, generateResponseId } from './utils';

/**
 * Converts Chat Completions response to output items array
 */
export function convertChatResponseToOutputItems(
  response: UnifiedChatResponse,
  state?: ResponsesToolState
): ResponsesOutputItem[] {
  const items: ResponsesOutputItem[] = [];

  // Add reasoning if present
  if (response.reasoning_content || response.thinking?.content) {
    const reasoningText = response.reasoning_content || '';
    const reasoningSummary = response.thinking?.content || '';
    const contentParts: ResponsesReasoningTextPart[] = reasoningText
      ? [{ type: 'reasoning_text', text: reasoningText }]
      : [];
    const summaryParts: ResponsesSummaryTextPart[] = reasoningSummary
      ? [{ type: 'summary_text', text: reasoningSummary }]
      : [];
    items.push({
      type: 'reasoning',
      id: generateItemId('reason'),
      status: 'completed',
      content: contentParts,
      summary: summaryParts,
    });
  }

  // Add tool calls if present
  if (response.tool_calls && response.tool_calls.length > 0) {
    for (const toolCall of response.tool_calls) {
      items.push(buildToolOutputItem(toolCall, state));
    }
  }

  // Re-emit typed image_generation_call items natively (full base64 — the
  // native format has no inline-markdown size concern). Unified `content`
  // is PURE authored text (transformResponse never bakes a rendered image
  // segment into it — see transformers/image-rendering.ts), so the message
  // text below needs NO string surgery: it reaches the client byte-intact
  // even when the authored text happens to contain the same characters as
  // a rendered image segment (markdown or oversized placeholder).
  const messageText = response.content || '';
  for (const imageCall of response.image_generation_calls ?? []) {
    if (typeof imageCall.result !== 'string' || imageCall.result.length === 0) continue;
    items.push({
      type: 'image_generation_call',
      id: imageCall.id ?? generateItemId('ig'),
      status: (imageCall.status as 'in_progress' | 'completed' | 'failed') ?? 'completed',
      result: imageCall.result,
    });
  }

  // Re-emit typed client-executed tool-call items (e.g. tool_search_call)
  // natively and untouched, so the client sees the pending call it's
  // expected to act on to continue the turn.
  for (const clientToolCall of response.client_tool_calls ?? []) {
    items.push(clientToolCall as unknown as ResponsesOutputItem);
  }

  // Add main message
  items.push({
    type: 'message',
    id: generateItemId('msg'),
    status: 'completed',
    role: 'assistant',
    content: [
      {
        type: 'output_text',
        text: messageText,
        annotations: response.annotations || [],
      },
    ],
  });

  return items;
}

/**
 * Formats unified response into Responses API format for the client
 */
export async function formatResponsesResponse(
  response: UnifiedChatResponse,
  state?: ResponsesToolState
): Promise<any> {
  const outputItems = convertChatResponseToOutputItems(response, state);

  return {
    id: generateResponseId(),
    object: 'response',
    created_at: response.created || Math.floor(Date.now() / 1000),
    completed_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    model: response.model,
    output: outputItems,
    usage: buildResponsesUsagePayload(response.usage),
    plexus: response.plexus,
  };
}
