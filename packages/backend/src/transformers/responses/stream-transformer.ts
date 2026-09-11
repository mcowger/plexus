import { createParser } from 'eventsource-parser';
import { UnifiedClientToolCall } from '../../types/unified';
import { logger } from '../../utils/logger';
import { normalizeOpenAIResponsesUsage } from '../../utils/usage-normalizer';
import { imageGenerationCallMarkdown } from '../image-rendering';
import { clientToolCallKey, isClientExecutedToolItem, toUnifiedImageGenerationCall } from './utils';

/**
 * Converts Responses API SSE stream to Unified chunks
 * Following the same pattern as OpenAI and Anthropic transformers
 */
export function transformResponsesStream(stream: ReadableStream): ReadableStream {
  const decoder = new TextDecoder();
  let responseModel = '';
  let responseId = '';
  // Responses output indexes identify items in the whole response, whereas
  // Chat Completions tool call indexes identify only tool calls. Keep a
  // stable mapping so parallel calls remain independently assemblable even
  // when their argument deltas are interleaved with other output items.
  const toolCallIndexByOutputIndex = new Map<number, number>();
  const toolCallIndexByItemId = new Map<string, number>();
  let nextToolCallIndex = 0;
  let hasFunctionCall = false;
  // image_generation_call items already rendered as a content delta from
  // their response.output_item.done event, so the response.completed
  // fallback below doesn't render them a second time.
  const renderedImageItemIds = new Set<string>();
  // Client-executed tool-call items (e.g. tool_search_call) already carried
  // typed from their response.output_item.done event, so the
  // response.completed fallback below doesn't carry them a second time.
  const renderedClientToolCallIds = new Set<string>();
  const getToolCallIndex = (data: any): number => {
    const outputIndex =
      typeof data.output_index === 'number' ? (data.output_index as number) : undefined;
    const itemId =
      typeof data.item_id === 'string'
        ? data.item_id
        : typeof data.item?.id === 'string'
          ? data.item.id
          : undefined;
    const index =
      (outputIndex === undefined ? undefined : toolCallIndexByOutputIndex.get(outputIndex)) ??
      (itemId === undefined ? undefined : toolCallIndexByItemId.get(itemId)) ??
      nextToolCallIndex++;

    if (outputIndex !== undefined) {
      toolCallIndexByOutputIndex.set(outputIndex, index);
    }
    if (itemId !== undefined) {
      toolCallIndexByItemId.set(itemId, index);
    }

    return index;
  };

  return new ReadableStream({
    async start(controller) {
      const parser = createParser({
        onEvent: (event) => {
          if (event.data === '[DONE]') {
            return;
          }

          try {
            const data = JSON.parse(event.data);

            // Extract metadata from response.created event
            if (data.type === 'response.created' && data.response) {
              responseModel = data.response.model || '';
              responseId = data.response.id || '';
              // Emit initial chunk with role
              controller.enqueue({
                id: responseId,
                model: responseModel,
                created: data.response.created_at || Math.floor(Date.now() / 1000),
                delta: { role: 'assistant' },
                finish_reason: null,
              });
              return;
            }

            // Convert Responses API events to Unified chunks
            if (data.type === 'response.output_text.delta') {
              // Text content delta
              controller.enqueue({
                id: responseId,
                model: responseModel,
                created: Math.floor(Date.now() / 1000),
                delta: {
                  content: data.delta,
                },
                finish_reason: null,
              });
            } else if (data.type === 'response.function_call_arguments.delta') {
              // Tool call arguments delta
              hasFunctionCall = true;
              controller.enqueue({
                id: responseId,
                model: responseModel,
                created: Math.floor(Date.now() / 1000),
                delta: {
                  tool_calls: [
                    {
                      index: getToolCallIndex(data),
                      function: {
                        arguments: data.delta,
                      },
                    },
                  ],
                },
                finish_reason: null,
              });
            } else if (
              data.type === 'response.output_item.added' &&
              data.item?.type === 'function_call'
            ) {
              // Tool call start
              hasFunctionCall = true;
              controller.enqueue({
                id: responseId,
                model: responseModel,
                created: Math.floor(Date.now() / 1000),
                delta: {
                  tool_calls: [
                    {
                      index: getToolCallIndex(data),
                      id: data.item.call_id,
                      type: 'function',
                      function: {
                        name: data.item.name,
                        arguments: '',
                      },
                    },
                  ],
                },
                finish_reason: null,
              });
            } else if (
              data.type === 'response.output_item.done' &&
              data.item?.type === 'image_generation_call'
            ) {
              // Minimal image rendering, COMPLETED items only: a finished
              // image_generation_call with a base64 result becomes a
              // markdown data-URI content delta for chat-format clients,
              // PAIRED with the chunk-level typed carry
              // (`image_generation_calls`, full base64 — see
              // types/unified.ts) that responses-facing formatters re-emit
              // natively instead of the markdown. Partial-image preview
              // events (response.image_generation_call.partial_image) are
              // deliberately NOT handled — rendering progressive previews
              // as chat content deltas has no sensible mapping, so they
              // are explicitly skipped as out of scope; only the final
              // completed image renders.
              const imageMarkdown = imageGenerationCallMarkdown(data.item);
              if (imageMarkdown) {
                if (typeof data.item.id === 'string') {
                  renderedImageItemIds.add(data.item.id);
                }
                controller.enqueue({
                  id: responseId,
                  model: responseModel,
                  created: Math.floor(Date.now() / 1000),
                  delta: {
                    content: imageMarkdown,
                  },
                  image_generation_calls: [toUnifiedImageGenerationCall(data.item)],
                  finish_reason: null,
                });
              }
            } else if (
              data.type === 'response.output_item.done' &&
              isClientExecutedToolItem(data.item)
            ) {
              // Built-in tool-call item whose execution the model
              // delegated to the client (e.g. tool_search_call). Carry it
              // typed (see UnifiedClientToolCall) so responses-facing
              // formatStream can re-emit it natively — that native item is
              // what actually signals a Responses-format client (e.g.
              // Codex) that a tool call is pending; the Responses wire
              // format has no `finish_reason` field at all, so this does
              // NOT set `hasFunctionCall`. Chat/messages-format clients
              // have no way to represent this item (no delta.tool_calls
              // gets populated for it), so upgrading `finish_reason` to
              // 'tool_calls' here would send them a 'tool_calls' finish
              // with an empty tool_calls array — SDKs commonly loop or
              // throw on that shape.
              const clientToolCallKeyForItem = clientToolCallKey(data.item);
              if (clientToolCallKeyForItem) {
                renderedClientToolCallIds.add(clientToolCallKeyForItem);
              }
              controller.enqueue({
                id: responseId,
                model: responseModel,
                created: Math.floor(Date.now() / 1000),
                delta: {},
                client_tool_calls: [data.item as UnifiedClientToolCall],
                finish_reason: null,
              });
            } else if (data.type === 'response.completed') {
              // Final chunk with usage data and an OpenAI-compatible finish reason.
              // `response.completed` includes the full output as a fallback because some
              // Responses-compatible providers omit intermediate function-call events.
              const usage = data.response?.usage;
              const normalizedUsage = usage ? normalizeOpenAIResponsesUsage(usage) : undefined;
              // Client-executed tool-call items are deliberately excluded
              // here — see the matching comment on the output_item.done
              // branch above: they carry no chat-format representation, so
              // upgrading `finish_reason` for them would mislead
              // chat/messages-format clients rather than help any client.
              const completedResponseHasFunctionCall = data.response?.output?.some(
                (item: any) => item?.type === 'function_call'
              );
              // Same fallback as function calls above: render any completed
              // image_generation_call items that only appear in the final
              // response (skipping ones already rendered from their own
              // response.output_item.done event) BEFORE the terminal chunk,
              // so the content delta still reaches the client — with the
              // same paired typed carry as the output_item.done path.
              for (const item of data.response?.output ?? []) {
                if (item?.type !== 'image_generation_call') continue;
                if (typeof item.id === 'string' && renderedImageItemIds.has(item.id)) continue;
                const imageMarkdown = imageGenerationCallMarkdown(item);
                if (!imageMarkdown) continue;
                controller.enqueue({
                  id: responseId,
                  model: responseModel,
                  created: Math.floor(Date.now() / 1000),
                  delta: {
                    content: imageMarkdown,
                  },
                  image_generation_calls: [toUnifiedImageGenerationCall(item)],
                  finish_reason: null,
                });
              }
              // Same fallback for client-executed tool-call items that only
              // appear in the final response snapshot (some backends omit
              // the intermediate output_item.done for them, or leave the
              // final snapshot's output populated where the streamed
              // events didn't carry it) — skip ones already carried above.
              for (const item of data.response?.output ?? []) {
                if (!isClientExecutedToolItem(item)) continue;
                const key = clientToolCallKey(item);
                if (key && renderedClientToolCallIds.has(key)) {
                  continue;
                }
                controller.enqueue({
                  id: responseId,
                  model: responseModel,
                  created: Math.floor(Date.now() / 1000),
                  delta: {},
                  client_tool_calls: [item as UnifiedClientToolCall],
                  finish_reason: null,
                });
              }
              controller.enqueue({
                id: responseId,
                model: responseModel,
                created: Math.floor(Date.now() / 1000),
                delta: {},
                finish_reason:
                  hasFunctionCall || completedResponseHasFunctionCall ? 'tool_calls' : 'stop',
                usage: normalizedUsage,
              });
            } else if (data.type === 'response.failed') {
              // Upstream reported a hard failure mid-stream. Surface it as
              // a unified error chunk (same shape OpenAITransformer.formatStream
              // already renders) instead of silently ending the stream.
              // Propagate final usage (when the upstream included it
              // alongside the failure) so chat-format clients still
              // receive an accurate token count for the turn instead of
              // silently losing it.
              const err = data.response?.error || {};
              const usage = data.response?.usage;
              const normalizedUsage = usage ? normalizeOpenAIResponsesUsage(usage) : undefined;
              controller.enqueue({
                id: responseId || data.response?.id || '',
                model: responseModel || data.response?.model || '',
                created: Math.floor(Date.now() / 1000),
                event: 'error',
                delta: {},
                error: {
                  statusCode: 500,
                  code: err.code || 'response_failed',
                  message: err.message || 'The model response failed to complete.',
                },
                ...(normalizedUsage ? { usage: normalizedUsage } : {}),
              });
            } else if (data.type === 'response.incomplete') {
              // Upstream ended the response early (e.g. hitting
              // max_output_tokens, or a content_filter cutoff) rather than
              // failing outright. Carry both the OpenAI-compatible finish
              // reason AND the raw incomplete_details on the unified chunk
              // — formatStream (both chat- and responses-facing) needs
              // incomplete_details to tell an "ended incomplete" chunk
              // apart from a genuine response.failed hard error. When the
              // upstream omits incomplete_details entirely, default to
              // { reason: 'unknown' } so the chunk still reads as an
              // incomplete (not a hard failure) downstream. Also propagate
              // final usage, same as response.failed above.
              const incompleteDetails = data.response?.incomplete_details ?? {
                reason: 'unknown',
              };
              const reason = incompleteDetails.reason || 'unknown';
              const usage = data.response?.usage;
              const normalizedUsage = usage ? normalizeOpenAIResponsesUsage(usage) : undefined;
              controller.enqueue({
                id: responseId || data.response?.id || '',
                model: responseModel || data.response?.model || '',
                created: Math.floor(Date.now() / 1000),
                event: 'error',
                delta: {},
                // 'content_filter' keeps its own finish reason; everything
                // else (max_output_tokens, unknown/absent reasons) maps to
                // 'length' — the same OpenAI-compatible default as
                // usage-logging's raw-mode incomplete mapping — so every
                // incomplete chunk carries a recognizable non-fatal finish
                // for the chat-facing formatters.
                finish_reason: reason === 'content_filter' ? 'content_filter' : 'length',
                incomplete_details: incompleteDetails,
                error: {
                  statusCode: 500,
                  code: reason,
                  message: `Response ended incomplete: ${reason}`,
                },
                ...(normalizedUsage ? { usage: normalizedUsage } : {}),
              });
            } else if (data.type === 'error') {
              // Generic Responses API stream error event (top-level, not
              // nested under `response`) — no incomplete_details, since
              // this is a hard stream-level error, not an "ended
              // incomplete" signal.
              controller.enqueue({
                id: responseId,
                model: responseModel,
                created: Math.floor(Date.now() / 1000),
                event: 'error',
                delta: {},
                error: {
                  statusCode: 500,
                  code: data.code || 'error',
                  message: data.message || 'Upstream error',
                },
              });
            }
          } catch (e) {
            logger.error('Error parsing Responses API streaming chunk', e);
          }
        },
      });

      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.feed(decoder.decode(value, { stream: true }));
        }
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });
}
