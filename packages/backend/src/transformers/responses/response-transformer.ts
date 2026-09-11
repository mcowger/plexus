import {
  UnifiedChatResponse,
  UnifiedClientToolCall,
  UnifiedImageGenerationCall,
} from '../../types/unified';
import {
  normalizeOpenAIChatUsage,
  normalizeOpenAIResponsesUsage,
} from '../../utils/usage-normalizer';
import { customToolArgumentsForModel } from './tool-mapper';
import { isClientExecutedToolItem, toUnifiedImageGenerationCall } from './utils';

/**
 * Transforms provider response to unified chat format
 * (inherited from Transformer interface)
 */
export async function transformResponsesResponse(response: any): Promise<UnifiedChatResponse> {
  // This method handles TWO cases:
  // 1. Converting Chat Completions format to Unified (when routing responses -> chat)
  // 2. Converting Responses API format to Unified (when routing responses -> responses in passthrough)

  // Detect which format we received
  if (response.output && response.object === 'response') {
    // Case 2: Responses API format (passthrough mode)
    // Extract usage from Responses API format
    const usage = response.usage ? normalizeOpenAIResponsesUsage(response.usage) : undefined;

    // Find the first message output item for content
    const messageItem = response.output?.find((item: any) => item.type === 'message');
    const messageText = messageItem?.content?.map((part: any) => part.text).join('\n') || null;

    // Completed image_generation_call items (non-empty base64 `result`)
    // are carried TYPED ONLY, byte-intact and never size-capped, on
    // `image_generation_calls` — see UnifiedImageGenerationCall in
    // types/unified.ts. The unified `content` stays PURE authored message
    // text: chat-format client renderers compose their own markdown
    // projection from the typed items (composeContentWithImageMarkdown in
    // transformers/image-rendering.ts), and the responses-facing
    // formatResponse re-emits the native item with NO string surgery on
    // the text — so authored text that happens to contain the same
    // characters as a rendered image segment can never be corrupted.
    const imageGenerationCalls: UnifiedImageGenerationCall[] = [];
    for (const item of response.output ?? []) {
      if (
        item?.type === 'image_generation_call' &&
        typeof item.result === 'string' &&
        item.result.length > 0
      ) {
        imageGenerationCalls.push(toUnifiedImageGenerationCall(item));
      }
    }

    // Built-in tool-call items whose execution is delegated to the client
    // (e.g. tool_search_call) — carried typed, untouched, so formatResponse
    // can re-emit them natively instead of silently dropping a pending
    // tool call the client is expected to act on.
    const clientToolCalls: UnifiedClientToolCall[] = (response.output ?? []).filter(
      isClientExecutedToolItem
    );
    const content = messageText;

    // Collect url_citation annotations from all output_text content parts
    const annotations: any[] = [];
    for (const part of messageItem?.content ?? []) {
      if (Array.isArray(part.annotations)) {
        for (const ann of part.annotations) {
          if (ann.type === 'url_citation') {
            annotations.push({
              type: 'url_citation',
              url_citation: {
                url: ann.url,
                title: ann.title,
                content: ann.text ?? ann.content,
                start_index: ann.start_index,
                end_index: ann.end_index,
              },
            });
          }
        }
      }
    }

    // Find reasoning output item
    const reasoningItem = response.output?.find((item: any) => item.type === 'reasoning');
    const reasoningParts = reasoningItem?.content?.length
      ? reasoningItem.content
      : reasoningItem?.summary;
    const reasoning_content = reasoningParts?.map((part: any) => part.text).join('\n') || null;

    // Extract tool calls from function_call/custom_tool_call output items.
    // This transformer instance is the PROVIDER-side transformer (a
    // different instance than the client-side one that ran parseRequest),
    // so it has no namespaceMap/customToolNames of its own — it just flattens
    // to the same flat name convention used when sending tools out
    // (${namespace}__${name}) so the client-side transformer's
    // namespaceMap/customToolNames (built from the original request) can
    // split/unwrap them again in formatResponse/formatStream.
    // custom_tool_call's raw string `input` is re-wrapped as JSON
    // `{input}` function-call arguments so it round-trips through the
    // unified layer identically to a normal function call.
    const toolCalls = response.output
      ?.filter((item: any) => item.type === 'function_call' || item.type === 'custom_tool_call')
      .map((item: any) => {
        const flatName = item.namespace ? `${item.namespace}__${item.name}` : item.name;
        return {
          id: item.call_id,
          type: 'function' as const,
          function: {
            name: flatName,
            arguments:
              item.type === 'custom_tool_call'
                ? customToolArgumentsForModel(item.input)
                : item.arguments,
          },
        };
      });

    return {
      id: response.id,
      model: response.model,
      created: response.created_at || Math.floor(Date.now() / 1000),
      content,
      reasoning_content,
      annotations: annotations.length > 0 ? annotations : undefined,
      tool_calls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      ...(imageGenerationCalls.length > 0 ? { image_generation_calls: imageGenerationCalls } : {}),
      ...(clientToolCalls.length > 0 ? { client_tool_calls: clientToolCalls } : {}),
      usage,
    };
  } else {
    // Case 1: Chat Completions format
    const choice = response.choices?.[0];
    const message = choice?.message;

    const usage = response.usage ? normalizeOpenAIChatUsage(response.usage) : undefined;

    return {
      id: response.id,
      model: response.model,
      created: response.created,
      content: message?.content || null,
      reasoning_content: message?.reasoning_content || null,
      tool_calls: message?.tool_calls,
      usage,
    };
  }
}
