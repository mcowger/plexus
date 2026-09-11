import { encode } from 'eventsource-encoder';
import { UnifiedClientToolCall } from '../../types/unified';
import { ResponsesToolState, customToolInput } from './tool-mapper';
import { buildResponsesUsagePayload, generateItemId, generateResponseId } from './utils';

/**
 * Formats unified stream into Responses API SSE format
 */
export function formatResponsesStream(
  stream: ReadableStream,
  state?: ResponsesToolState
): ReadableStream {
  const encoder = new TextEncoder();
  const reader = stream.getReader();

  const customToolNames = state?.customToolNames ?? new Set<string>();
  const namespaceMap =
    state?.namespaceMap ?? new Map<string, { namespace: string; name: string }>();

  let hasSentCreated = false;
  let hasSentInProgress = false;
  let responseId = '';
  let responseModel = '';
  let responseCreatedAt = 0;
  let messageItemSent = false;
  let messageItemId = '';
  let messageText = '';
  let messagePartAdded = false;
  let messageOutputIndex: number | null = null;
  let reasoningItemSent = false;
  let reasoningItemId = '';
  let reasoningText = '';
  let reasoningOutputIndex: number | null = null;
  let reasoningSummaryText = '';
  let reasoningContentIndex = 0;
  let reasoningSummaryIndex = 0;
  let reasoningSummaryPartAdded = false;
  let lastUsage: any = null;
  let sequenceNumber = 0;
  let nextOutputIndex = 0;
  const usedOutputIndices = new Set<number>();
  const outputItemsByIndex = new Map<number, any>();
  const toolOutputIndexMap = new Map<number, number>();
  const toolCallIdMap = new Map<number, string>();
  const toolItemIdMap = new Map<number, string>();
  const toolArgsMap = new Map<number, string>();
  const toolNameMap = new Map<number, string>();

  const normalizeToolArgs = (previous: string, delta: string): string => {
    if (!delta) return previous;
    const trimmed = delta.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        JSON.parse(trimmed);
        if (!previous || trimmed.startsWith(previous.trimStart())) return trimmed;
      } catch {
        // Argument deltas may contain incomplete JSON.
      }
    }
    return previous + delta;
  };

  const sendEvent = (controller: ReadableStreamDefaultController, data: any) => {
    controller.enqueue(
      encoder.encode(
        encode({
          event: data.type,
          data: JSON.stringify({
            ...data,
            sequence_number: sequenceNumber++,
          }),
        })
      )
    );
  };

  const ensureCreated = (controller: ReadableStreamDefaultController, chunk: any) => {
    if (hasSentCreated) return;
    responseId = chunk.id || generateResponseId();
    responseModel = chunk.model || responseModel;
    responseCreatedAt = chunk.created || Math.floor(Date.now() / 1000);
    sendEvent(controller, {
      type: 'response.created',
      response: {
        id: responseId,
        object: 'response',
        created_at: responseCreatedAt,
        status: 'in_progress',
        model: responseModel,
        output: [],
      },
    });
    hasSentCreated = true;
  };

  const reserveOutputIndex = (): number => {
    while (usedOutputIndices.has(nextOutputIndex)) {
      nextOutputIndex += 1;
    }
    const index = nextOutputIndex;
    usedOutputIndices.add(index);
    nextOutputIndex += 1;
    return index;
  };

  const ensureInProgress = (controller: ReadableStreamDefaultController) => {
    if (hasSentInProgress) return;
    sendEvent(controller, {
      type: 'response.in_progress',
      response: {
        id: responseId,
        object: 'response',
        created_at: responseCreatedAt,
        status: 'in_progress',
        model: responseModel,
        output: [],
      },
    });
    hasSentInProgress = true;
  };

  const ensureMessageItem = (controller: ReadableStreamDefaultController) => {
    if (messageItemSent) return;
    if (messageOutputIndex === null) {
      messageOutputIndex = reserveOutputIndex();
    }
    const currentMessageOutputIndex = messageOutputIndex as number;
    messageItemId = generateItemId('msg');
    sendEvent(controller, {
      type: 'response.output_item.added',
      output_index: currentMessageOutputIndex,
      item: {
        id: messageItemId,
        type: 'message',
        status: 'in_progress',
        role: 'assistant',
        content: [],
      },
    });
    if (!messagePartAdded) {
      sendEvent(controller, {
        type: 'response.content_part.added',
        output_index: currentMessageOutputIndex,
        item_id: messageItemId,
        content_index: 0,
        part: {
          type: 'output_text',
          annotations: [],
          logprobs: [],
          text: '',
        },
      });
      messagePartAdded = true;
    }
    messageItemSent = true;
  };

  const ensureReasoningItem = (controller: ReadableStreamDefaultController) => {
    if (reasoningItemSent) return;
    reasoningOutputIndex = reserveOutputIndex();
    reasoningItemId = generateItemId('rs');
    sendEvent(controller, {
      type: 'response.output_item.added',
      output_index: reasoningOutputIndex,
      item: {
        id: reasoningItemId,
        type: 'reasoning',
        status: 'in_progress',
        content: [],
        summary: [],
      },
    });
    reasoningItemSent = true;
  };

  const ensureToolItem = (
    controller: ReadableStreamDefaultController,
    toolIndex: number,
    toolCall: any
  ) => {
    if (toolOutputIndexMap.has(toolIndex)) return;
    const outputIndex = reserveOutputIndex();
    const callId = toolCall?.id || generateItemId('call');
    const itemId = generateItemId('fc');
    const flatName = toolCall?.function?.name || toolCall?.name || '';
    toolOutputIndexMap.set(toolIndex, outputIndex);
    toolCallIdMap.set(toolIndex, callId);
    toolItemIdMap.set(toolIndex, itemId);
    toolArgsMap.set(toolIndex, '');
    toolNameMap.set(toolIndex, flatName);

    // Codex CLI namespace/custom tool split-back for the streamed "added"
    // event; the resolved shape is recomputed at finalization once full
    // arguments are known.
    if (customToolNames.has(flatName)) {
      sendEvent(controller, {
        type: 'response.output_item.added',
        output_index: outputIndex,
        item: {
          id: itemId,
          type: 'custom_tool_call',
          status: 'in_progress',
          call_id: callId,
          name: flatName,
          input: '',
        },
      });
      return;
    }

    const namespaced = namespaceMap.get(flatName);
    sendEvent(controller, {
      type: 'response.output_item.added',
      output_index: outputIndex,
      item: {
        id: itemId,
        type: 'function_call',
        status: 'in_progress',
        call_id: callId,
        name: namespaced ? namespaced.name : flatName,
        ...(namespaced ? { namespace: namespaced.namespace } : {}),
        arguments: '',
      },
    });
  };

  // Re-emits typed image_generation_call carries (see types/unified.ts) as
  // native Responses output items — full base64 `result`, no inline size
  // cap (the markdown guard exists for content strings; the native format
  // has no such concern). Each item is registered in outputItemsByIndex so
  // the terminal response.completed's output array includes it.
  const emitImageGenerationCallItems = (
    controller: ReadableStreamDefaultController,
    imageCalls: Array<{ id?: string; status?: string; result: string }>
  ) => {
    for (const imageCall of imageCalls) {
      const outputIndex = reserveOutputIndex();
      const itemId = imageCall.id || generateItemId('ig');
      const doneItem = {
        id: itemId,
        type: 'image_generation_call',
        status: imageCall.status || 'completed',
        result: imageCall.result,
      };
      sendEvent(controller, {
        type: 'response.output_item.added',
        output_index: outputIndex,
        item: { ...doneItem, status: 'in_progress', result: null },
      });
      sendEvent(controller, {
        type: 'response.output_item.done',
        output_index: outputIndex,
        item: doneItem,
      });
      outputItemsByIndex.set(outputIndex, doneItem);
    }
  };

  // Re-emits typed client-executed tool-call carries (see
  // UnifiedClientToolCall in types/unified.ts) as native Responses output
  // items, untouched. Each item is registered in outputItemsByIndex so the
  // terminal response.completed's output array includes it — this is the
  // client's only signal that a tool call (e.g. tool_search_call) is
  // pending and the turn isn't actually over.
  const emitClientToolCallItems = (
    controller: ReadableStreamDefaultController,
    clientToolCalls: UnifiedClientToolCall[]
  ) => {
    for (const clientToolCall of clientToolCalls) {
      const outputIndex = reserveOutputIndex();
      sendEvent(controller, {
        type: 'response.output_item.added',
        output_index: outputIndex,
        item: { ...clientToolCall, status: 'in_progress' },
      });
      sendEvent(controller, {
        type: 'response.output_item.done',
        output_index: outputIndex,
        item: clientToolCall,
      });
      outputItemsByIndex.set(outputIndex, clientToolCall);
    }
  };

  // `itemStatus` is the terminal status stamped on items that were still
  // in progress when the stream ended. The completed and failed paths keep
  // the pre-existing 'completed' stamp; only the response.incomplete path
  // passes 'incomplete' (matching the real Responses API, where items cut
  // off mid-generation surface as status 'incomplete').
  const finalizeOutputItems = (
    controller: ReadableStreamDefaultController,
    itemStatus: 'completed' | 'incomplete' = 'completed'
  ): any[] => {
    if (reasoningItemSent && reasoningOutputIndex !== null) {
      const reasoningItem = {
        id: reasoningItemId,
        type: 'reasoning',
        status: itemStatus,
        content: reasoningText
          ? [
              {
                type: 'reasoning_text',
                text: reasoningText,
              },
            ]
          : [],
        summary: reasoningSummaryText
          ? [
              {
                type: 'summary_text',
                text: reasoningSummaryText,
              },
            ]
          : [],
      };
      if (reasoningText) {
        sendEvent(controller, {
          type: 'response.reasoning_text.done',
          output_index: reasoningOutputIndex,
          item_id: reasoningItemId,
          content_index: reasoningContentIndex,
          text: reasoningText,
        });
      }
      if (reasoningSummaryText) {
        sendEvent(controller, {
          type: 'response.reasoning_summary_text.done',
          output_index: reasoningOutputIndex,
          item_id: reasoningItemId,
          summary_index: reasoningSummaryIndex,
          text: reasoningSummaryText,
        });
        if (reasoningSummaryPartAdded) {
          sendEvent(controller, {
            type: 'response.reasoning_summary_part.done',
            output_index: reasoningOutputIndex,
            item_id: reasoningItemId,
            summary_index: reasoningSummaryIndex,
            part: {
              type: 'summary_text',
              text: reasoningSummaryText,
            },
          });
        }
      }
      sendEvent(controller, {
        type: 'response.output_item.done',
        output_index: reasoningOutputIndex,
        item: reasoningItem,
      });
      outputItemsByIndex.set(reasoningOutputIndex, reasoningItem);
    }

    if (messageItemSent) {
      const messageItem = {
        id: messageItemId,
        type: 'message',
        status: itemStatus,
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            annotations: [],
            logprobs: [],
            text: messageText,
          },
        ],
      };
      sendEvent(controller, {
        type: 'response.output_text.done',
        output_index: messageOutputIndex as number,
        item_id: messageItemId,
        content_index: 0,
        logprobs: [],
        text: messageText,
      });
      sendEvent(controller, {
        type: 'response.content_part.done',
        output_index: messageOutputIndex as number,
        item_id: messageItemId,
        content_index: 0,
        part: {
          type: 'output_text',
          annotations: [],
          logprobs: [],
          text: messageText,
        },
      });
      sendEvent(controller, {
        type: 'response.output_item.done',
        output_index: messageOutputIndex as number,
        item: messageItem,
      });
      outputItemsByIndex.set(messageOutputIndex as number, messageItem);
    }

    for (const [toolIndex, outputIndex] of toolOutputIndexMap.entries()) {
      const itemId = toolItemIdMap.get(toolIndex);
      const callId = toolCallIdMap.get(toolIndex);
      const args = toolArgsMap.get(toolIndex) || '';
      const flatName = toolNameMap.get(toolIndex) || '';

      let toolItem: any;
      if (customToolNames.has(flatName)) {
        toolItem = {
          id: itemId,
          type: 'custom_tool_call',
          status: itemStatus,
          call_id: callId,
          name: flatName,
          input: customToolInput(args),
        };
      } else {
        const namespaced = namespaceMap.get(flatName);
        toolItem = {
          id: itemId,
          type: 'function_call',
          status: itemStatus,
          call_id: callId,
          name: namespaced ? namespaced.name : flatName,
          ...(namespaced ? { namespace: namespaced.namespace } : {}),
          arguments: args,
        };
      }
      sendEvent(controller, {
        type: 'response.output_item.done',
        output_index: outputIndex,
        item: toolItem,
      });
      outputItemsByIndex.set(outputIndex, toolItem);
    }

    return Array.from(outputItemsByIndex.entries())
      .sort(([a], [b]) => a - b)
      .map(([, item]) => item);
  };

  return new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value: unifiedChunk } = await reader.read();
          if (done) {
            if (!hasSentCreated) {
              ensureCreated(controller, {
                model: responseModel,
                created: responseCreatedAt,
              });
            }
            const outputItems = finalizeOutputItems(controller);
            sendEvent(controller, {
              type: 'response.completed',
              response: {
                id: responseId || undefined,
                object: 'response',
                created_at: responseCreatedAt || Math.floor(Date.now() / 1000),
                status: 'completed',
                model: responseModel,
                output: outputItems,
                usage: buildResponsesUsagePayload(lastUsage),
              },
            });
            break;
          }

          ensureCreated(controller, unifiedChunk);
          ensureInProgress(controller);

          if (unifiedChunk.event === 'error') {
            // Upstream failed, ended incomplete, or reported a stream-level
            // error (surfaced as a unified error chunk by transformStream).
            // Emit the matching Responses-API terminal event instead of
            // unconditionally completing, so the client sees the actual
            // outcome rather than a phantom success:
            //   - incomplete_details present -> response.incomplete (the
            //     upstream ended the turn early — max_output_tokens /
            //     content_filter — not a hard failure).
            //   - otherwise -> response.failed (a genuine hard error),
            //     exactly as before.
            if (unifiedChunk.usage) {
              lastUsage = unifiedChunk.usage;
            }
            // Items still in progress on the incomplete path finalize with
            // status 'incomplete'; the failed path keeps the pre-existing
            // 'completed' stamp (see finalizeOutputItems).
            const outputItems = finalizeOutputItems(
              controller,
              unifiedChunk.incomplete_details ? 'incomplete' : 'completed'
            );
            const err = unifiedChunk.error || {};

            if (unifiedChunk.incomplete_details) {
              sendEvent(controller, {
                type: 'response.incomplete',
                response: {
                  id: responseId || undefined,
                  object: 'response',
                  created_at: responseCreatedAt || Math.floor(Date.now() / 1000),
                  status: 'incomplete',
                  model: responseModel,
                  output: outputItems,
                  incomplete_details: unifiedChunk.incomplete_details,
                  usage: buildResponsesUsagePayload(lastUsage),
                },
              });
            } else {
              sendEvent(controller, {
                type: 'response.failed',
                response: {
                  id: responseId || undefined,
                  object: 'response',
                  created_at: responseCreatedAt || Math.floor(Date.now() / 1000),
                  status: 'failed',
                  model: responseModel,
                  output: outputItems,
                  error: {
                    code: err.code || 'server_error',
                    message: err.message || 'The model response failed to complete.',
                  },
                  usage: buildResponsesUsagePayload(lastUsage),
                },
              });
            }
            break;
          }

          if (unifiedChunk.usage) {
            lastUsage = unifiedChunk.usage;
          }

          const delta = unifiedChunk.delta || {};
          const reasoningDelta =
            typeof delta.reasoning_content === 'string' ? delta.reasoning_content : null;
          const reasoningSummaryDelta =
            typeof delta.thinking?.content === 'string' ? delta.thinking.content : null;

          // Typed image_generation_call carries re-emit as NATIVE output
          // items for this Responses-format client. The same chunk's
          // `delta.content` is the chat-format markdown rendering of these
          // exact items (transformStream pairs them 1:1), so the content
          // delta is skipped below — the native item is the only carrier
          // here (a chat client would render the markdown instead).
          const typedImageCalls = Array.isArray(unifiedChunk.image_generation_calls)
            ? unifiedChunk.image_generation_calls.filter(
                (imageCall: any) =>
                  imageCall && typeof imageCall.result === 'string' && imageCall.result.length > 0
              )
            : [];
          if (typedImageCalls.length > 0) {
            emitImageGenerationCallItems(controller, typedImageCalls);
          }

          // Typed client-executed tool-call carries (e.g. tool_search_call)
          // re-emit as NATIVE output items, untouched — these have no
          // chat-format equivalent to fall back to, so this is the only way
          // the client learns a tool call is pending.
          if (
            Array.isArray(unifiedChunk.client_tool_calls) &&
            unifiedChunk.client_tool_calls.length > 0
          ) {
            emitClientToolCallItems(controller, unifiedChunk.client_tool_calls);
          }

          if (reasoningDelta && reasoningDelta.length > 0) {
            ensureReasoningItem(controller);
            reasoningText += reasoningDelta;
            sendEvent(controller, {
              type: 'response.reasoning_text.delta',
              output_index: reasoningOutputIndex as number,
              item_id: reasoningItemId,
              content_index: reasoningContentIndex,
              delta: reasoningDelta,
            });
          }

          if (reasoningSummaryDelta && reasoningSummaryDelta.length > 0) {
            ensureReasoningItem(controller);
            if (!reasoningSummaryPartAdded) {
              sendEvent(controller, {
                type: 'response.reasoning_summary_part.added',
                output_index: reasoningOutputIndex as number,
                item_id: reasoningItemId,
                summary_index: reasoningSummaryIndex,
                part: {
                  type: 'summary_text',
                  text: '',
                },
              });
              reasoningSummaryPartAdded = true;
            }
            reasoningSummaryText += reasoningSummaryDelta;
            sendEvent(controller, {
              type: 'response.reasoning_summary_text.delta',
              output_index: reasoningOutputIndex as number,
              item_id: reasoningItemId,
              summary_index: reasoningSummaryIndex,
              delta: reasoningSummaryDelta,
            });
          }

          if (
            typeof delta.content === 'string' &&
            delta.content.length > 0 &&
            typedImageCalls.length === 0
          ) {
            ensureMessageItem(controller);
            messageText += delta.content;
            sendEvent(controller, {
              type: 'response.output_text.delta',
              output_index: messageOutputIndex as number,
              item_id: messageItemId,
              content_index: 0,
              delta: delta.content,
              logprobs: [],
            });
          }

          if (Array.isArray(delta.tool_calls)) {
            for (const toolCall of delta.tool_calls) {
              const toolIndex = toolCall.index ?? 0;
              ensureToolItem(controller, toolIndex, toolCall);
              if (typeof toolCall.function?.arguments === 'string') {
                const outputIndex = toolOutputIndexMap.get(toolIndex) ?? toolIndex + 1;
                const itemId = toolItemIdMap.get(toolIndex);
                const prevArgs = toolArgsMap.get(toolIndex) || '';
                toolArgsMap.set(
                  toolIndex,
                  normalizeToolArgs(prevArgs, toolCall.function.arguments)
                );
                // Custom tool call input can't be correctly unwrapped from
                // partial JSON (customToolInput needs the full buffered
                // arguments), so only stream deltas for ordinary function
                // calls; custom tool input is emitted once, complete, in
                // finalizeOutputItems's output_item.done.
                const flatName = toolNameMap.get(toolIndex) || '';
                if (!customToolNames.has(flatName)) {
                  sendEvent(controller, {
                    type: 'response.function_call_arguments.delta',
                    output_index: outputIndex,
                    item_id: itemId,
                    delta: toolCall.function.arguments,
                  });
                }
              }
            }
          }

          if (unifiedChunk.finish_reason && !unifiedChunk.delta) {
            const outputItems = finalizeOutputItems(controller);

            sendEvent(controller, {
              type: 'response.completed',
              response: {
                id: responseId || undefined,
                object: 'response',
                created_at: responseCreatedAt || Math.floor(Date.now() / 1000),
                status: 'completed',
                model: responseModel,
                output: outputItems,
                usage: buildResponsesUsagePayload(lastUsage),
              },
            });
            break;
          }
        }
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });
}
