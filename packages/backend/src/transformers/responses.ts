import { Transformer } from '../types/transformer';
import {
  UnifiedResponsesRequest,
  UnifiedResponsesResponse,
  ResponsesStreamEvent,
  ResponsesInputItem,
  ResponsesMessageItem,
  ResponsesFunctionCallItem,
  ResponsesFunctionCallOutputItem,
  ResponsesOutputItem,
  ResponsesReasoningTextPart,
  ResponsesSummaryTextPart,
} from '../types/responses';
import {
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedClientToolCall,
  UnifiedImageGenerationCall,
  UnifiedMessage,
} from '../types/unified';
import { createParser } from 'eventsource-parser';
import { encode } from 'eventsource-encoder';
import { logger } from '../utils/logger';
import { normalizeOpenAIChatUsage, normalizeOpenAIResponsesUsage } from '../utils/usage-normalizer';
import { imageGenerationCallMarkdown } from './image-rendering';
import { projectReasoningForResponses } from './utils';

const OPENAI_RESPONSES_CALL_ID_MAX_LENGTH = 64;
const OPENAI_RESPONSES_REASONING_CONTENT_MAX_ITEMS = 0;

/**
 * Projects a completed image_generation_call output item (with a non-empty
 * base64 `result`) onto the typed unified carry — see
 * UnifiedImageGenerationCall in types/unified.ts. The `result` is carried
 * byte-intact: the inline size cap applies only to the chat-format markdown
 * rendering (see transformers/image-rendering.ts), never to the typed item.
 */
function toUnifiedImageGenerationCall(item: any): UnifiedImageGenerationCall {
  return {
    ...(typeof item.id === 'string' ? { id: item.id } : {}),
    ...(typeof item.status === 'string' ? { status: item.status } : {}),
    result: item.result,
  };
}

/**
 * True for a built-in Responses output item whose execution the model has
 * delegated to the CLIENT (`execution: "client"`, e.g. `tool_search_call`).
 * These are pending tool calls the caller must act on to continue the turn —
 * unlike server-executed built-ins (web_search_call, etc.) — so they need the
 * same "keep this and tell the client" treatment as a function_call rather
 * than being silently dropped as an unrecognized item type. Keyed on the
 * `execution` discriminator (not a type allowlist) so future built-in
 * client-executed tool types are handled automatically, plus a `_call`
 * suffix check so a provider that ever stamps `execution` on some unrelated
 * item type can't be misread as a tool call. Accepts either `call_id` or
 * `id` (falling back between them — see `clientToolCallKey` below) rather
 * than requiring `call_id` specifically: every item observed on the wire so
 * far has both, but requiring one exclusively risks silently dropping an
 * item that only has the other, which is exactly the failure mode this
 * carry exists to prevent.
 */
function isClientExecutedToolItem(item: any): item is UnifiedClientToolCall {
  return (
    !!item &&
    typeof item === 'object' &&
    item.execution === 'client' &&
    typeof item.type === 'string' &&
    item.type.endsWith('_call') &&
    (typeof item.call_id === 'string' || typeof item.id === 'string')
  );
}

/**
 * Identifier used to dedupe a client-executed tool-call item between its
 * streamed `response.output_item.done` event and the `response.completed`
 * fallback loop — prefers `id` (the item's own identity) and falls back to
 * `call_id` when `id` is absent, so an item missing either field still gets
 * a stable dedupe key instead of silently bypassing the dedupe check (which
 * would emit it twice) or being dropped entirely.
 */
function clientToolCallKey(item: any): string | undefined {
  if (typeof item?.id === 'string') return item.id;
  if (typeof item?.call_id === 'string') return item.call_id;
  return undefined;
}

// Some Responses clients have been observed replaying tool calls with composite
// IDs like "call_...|fc_...". OpenAI-compatible providers validate call_id
// length and require the model-generated "call_..." ID when the composite ID is
// too long, so only repair that exact observed shape once it violates the
// OpenAI limit instead of rewriting arbitrary caller-provided IDs.
export function normalizeCompositeResponsesCallIds(body: any): number {
  if (!body || typeof body !== 'object' || !Array.isArray(body.input)) {
    return 0;
  }

  let normalizedCount = 0;
  for (const item of body.input) {
    if (!item || typeof item !== 'object' || typeof item.call_id !== 'string') {
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

    item.call_id = callId;
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
export function normalizeResponsesFunctionCallItemIds(body: any): number {
  if (!body || typeof body !== 'object' || !Array.isArray(body.input)) {
    return 0;
  }

  let normalizedCount = 0;
  for (const item of body.input) {
    if (!item || typeof item !== 'object' || item.type !== 'function_call') {
      continue;
    }
    if (typeof item.id !== 'string' || !item.id.startsWith('call_')) {
      continue;
    }

    delete item.id;
    normalizedCount++;
  }

  return normalizedCount;
}

// Reasoning items are valid replay context, but some OpenAI-compatible
// Responses providers reject replayed plaintext reasoning text with
// "content max length 0". Drop only the optional plaintext content array once
// it violates that limit while preserving the reasoning item, summary, status,
// id, and encrypted_content.
export function normalizeResponsesReasoningContent(body: any): number {
  if (!body || typeof body !== 'object' || !Array.isArray(body.input)) {
    return 0;
  }

  let normalizedCount = 0;
  for (const item of body.input) {
    if (
      !item ||
      typeof item !== 'object' ||
      item.type !== 'reasoning' ||
      !Array.isArray(item.content) ||
      item.content.length <= OPENAI_RESPONSES_REASONING_CONTENT_MAX_ITEMS
    ) {
      continue;
    }

    item.content = [];
    normalizedCount++;
  }

  return normalizedCount;
}

/**
 * ResponsesTransformer
 *
 * Implements the OpenAI Responses API format transformer.
 * Handles bidirectional transformation between Responses API and Chat Completions formats.
 */
export class ResponsesTransformer implements Transformer {
  name = 'responses';
  defaultEndpoint = '/responses';

  // Codex CLI extensions (namespace tools, custom/freeform tools) are
  // per-request state: providers only understand flat function tools, so we
  // flatten on the way in and split/re-wrap on the way out. Populated during
  // parseRequest/convertToolsForUnified and consulted by
  // convertChatResponseToOutputItems/formatStream on the same instance.
  private namespaceMap = new Map<string, { namespace: string; name: string }>();
  private customToolNames = new Set<string>();

  /**
   * Parses incoming Responses API request into unified format
   */
  async parseRequest(input: any): Promise<UnifiedChatRequest> {
    // Validate required fields
    if (!input.model) {
      throw new Error('Missing required field: model');
    }
    if (!input.input) {
      throw new Error('Missing required field: input');
    }

    this.namespaceMap.clear();
    this.customToolNames.clear();

    // Normalize input to array format
    const normalizedInput = this.normalizeInput(input.input);

    // Codex CLI "lite" mode sends turn-local tool definitions as an
    // `additional_tools` input item instead of the top-level `tools` array.
    // Lift those into the tool list before flattening so the model actually
    // sees them — otherwise the request goes upstream with no tools and the
    // model hallucinates tool calls as plain text.
    const liftedTools = normalizedInput
      .filter((item) => item?.type === 'additional_tools' && Array.isArray(item.tools))
      .flatMap((item) => item.tools);

    // Convert tools first — built-in server-side tools (web search etc.) are
    // passed through so provider adapters can coerce them; function tools are
    // reformatted; Codex CLI namespace/custom tools are flattened/registered.
    // This must run before converting input items, since namespace-qualified
    // function_call items and custom_tool_call items are resolved against the
    // namespaceMap/customToolNames populated here.
    const tools = this.convertToolsForUnified([...(input.tools || []), ...liftedTools]);

    // Convert input items to Chat Completions messages
    const messages = this.convertInputItemsToMessages(normalizedInput);

    // Add instructions as system message if present
    if (input.instructions) {
      messages.unshift({
        role: 'system',
        content: input.instructions,
      });
    }

    // Maybe-undefined client fields use conditional spread (not
    // `key: input.maybeUndefined`) so an omitted client field leaves NO own
    // property on the unified request — a phantom `key: undefined` own
    // property survives object spreads and flips `'key' in x` /
    // hasOwnProperty checks downstream even though JSON would drop it.
    return {
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
      model: input.model,
      messages,
      ...(input.max_output_tokens !== undefined ? { max_tokens: input.max_output_tokens } : {}),
      // Forward temperature only when the client actually sent it. GPT-5
      // reasoning models (and others) reject sampling params outright, so
      // injecting a fabricated default here would send `temperature: 1.0`
      // upstream on every request that omitted it.
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(input.stream !== undefined ? { stream: input.stream } : {}),
      ...(tools.length > 0 ? { tools } : {}),
      tool_choice: this.convertToolChoiceForChatCompletions(input.tool_choice),
      ...(input.reasoning !== undefined ? { reasoning: input.reasoning } : {}),
      ...(input.include !== undefined ? { include: input.include } : {}),
      ...(input.prompt_cache_key !== undefined ? { prompt_cache_key: input.prompt_cache_key } : {}),
      ...(input.text !== undefined ? { text: input.text } : {}),
      ...(input.parallel_tool_calls !== undefined
        ? { parallel_tool_calls: input.parallel_tool_calls }
        : {}),
      ...(input.text?.format
        ? {
            response_format: {
              type: input.text.format.type,
              json_schema: input.text.format.schema,
              // Carry the full structured-output descriptor: dropping
              // name/description/strict would force the responses -> chat
              // emission to fabricate `name: "response_schema"` /
              // `strict: true` over the client-supplied values.
              ...(input.text.format.name !== undefined ? { name: input.text.format.name } : {}),
              ...(input.text.format.description !== undefined
                ? { description: input.text.format.description }
                : {}),
              ...(input.text.format.strict !== undefined
                ? { strict: input.text.format.strict }
                : {}),
            },
          }
        : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      incomingApiType: 'responses',
      originalBody: input,
    };
  }

  /**
   * Transforms Chat Completions request to Responses API format (not typically needed)
   */
  async transformRequest(request: UnifiedChatRequest): Promise<any> {
    // Convert UnifiedChatRequest to Responses API format
    const inputItems: any[] = [];

    // Convert messages to input items
    for (const msg of request.messages) {
      if (msg.role === 'system') {
        // System messages become instructions (not input items)
        continue; // Will be handled below
      } else if (msg.role === 'user' || msg.role === 'assistant') {
        const content: any[] = [];

        if (typeof msg.content === 'string') {
          content.push({
            type: msg.role === 'user' ? 'input_text' : 'output_text',
            text: msg.content,
          });
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === 'text') {
              content.push({
                type: msg.role === 'user' ? 'input_text' : 'output_text',
                text: part.text,
              });
            } else if (part.type === 'image_url') {
              content.push({
                type: 'input_image',
                image_url: part.image_url.url,
                detail: 'auto',
              });
            }
          }
        }

        inputItems.push({
          type: 'message',
          role: msg.role,
          content,
        });
      } else if (msg.role === 'tool') {
        // Tool result becomes function_call_output item
        inputItems.push({
          type: 'function_call_output',
          call_id: msg.tool_call_id,
          output: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        });
      }

      // If assistant message has tool calls, add them as function_call items
      if (msg.role === 'assistant' && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          inputItems.push({
            type: 'function_call',
            call_id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments,
          });
        }
      }
    }

    // Extract system message for instructions
    const systemMessage = request.messages.find((m) => m.role === 'system');
    const instructions = systemMessage
      ? typeof systemMessage.content === 'string'
        ? systemMessage.content
        : JSON.stringify(systemMessage.content)
      : undefined;

    // Convert tools to Responses API format.
    // Non-function tools (e.g. server-side web search types like "web_search",
    // "web_search_20250305", "openrouter:web_search") are passed through as-is
    // so that provider adapters can coerce them to the correct format before
    // the HTTP call is made.
    const tools = request.tools?.map((tool: any) => {
      if (tool.type !== 'function' || !tool.function) return tool;
      return {
        type: 'function',
        name: tool.function?.name ?? '',
        description: tool.function?.description ?? '',
        parameters: tool.function?.parameters ?? {},
      };
    });

    // `stream` uses conditional spread for the same reason parseRequest does:
    // when the client omitted it, the outbound payload must carry NO own
    // `stream` property — a phantom `stream: undefined` survives object
    // spreads and flips `'stream' in x` / hasOwnProperty checks downstream
    // even though JSON serialization would drop it.
    const payload: any = {
      model: request.model,
      input: inputItems,
      ...(request.stream !== undefined ? { stream: request.stream } : {}),
    };

    if (instructions) {
      payload.instructions = instructions;
    }
    if (request.max_tokens) {
      payload.max_output_tokens = request.max_tokens;
    }
    if (request.temperature !== undefined) {
      payload.temperature = request.temperature;
    }
    if (tools && tools.length > 0) {
      payload.tools = tools;
    }
    if (request.tool_choice) {
      payload.tool_choice = request.tool_choice;
    }
    if (request.reasoning) {
      const reasoning = projectReasoningForResponses(request.reasoning);
      if (reasoning) payload.reasoning = reasoning;
    }
    if (request.include && request.include.length > 0) {
      payload.include = request.include;
    }
    if (request.prompt_cache_key) {
      payload.prompt_cache_key = request.prompt_cache_key;
    }
    if (request.parallel_tool_calls !== undefined) {
      payload.parallel_tool_calls = request.parallel_tool_calls;
    }
    if (request.text) {
      payload.text = request.text;
    } else if (request.response_format) {
      payload.text = {
        format: {
          type: request.response_format.type,
          schema: request.response_format.json_schema,
        },
      };
    }

    // For same-format (responses -> responses) requests that take the
    // non-pass-through path (e.g. adapter active, vision fallthrough), carry
    // through Responses-API-native top-level fields that the explicit mapping
    // above does not set. The unified schema intentionally abstracts away
    // provider-specific options so cross-format transforms don't drop them on
    // the floor when the client is talking the same API type as the upstream
    // provider. Only fields not already set are carried through, so the
    // unified pipeline output is never overridden.
    if (
      request.incomingApiType?.toLowerCase().split(':', 1)[0] === 'responses' &&
      request.originalBody
    ) {
      const passthroughFields = [
        'user',
        'store',
        'background',
        'service_tier',
        'truncation',
        'metadata',
        'top_p',
        'top_logprobs',
        'max_tool_calls',
        'previous_response_id',
        'conversation',
        'prompt_cache_retention',
        'safety_identifier',
        'stream_options',
      ];
      for (const field of passthroughFields) {
        if (request.originalBody[field] !== undefined && payload[field] === undefined) {
          payload[field] = request.originalBody[field];
        }
      }
    }

    return payload;
  }

  /**
   * Transforms provider response to unified chat format
   * (inherited from Transformer interface)
   */
  async transformResponse(response: any): Promise<UnifiedChatResponse> {
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
                  ? this.customToolArgumentsForModel(item.input)
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
        ...(imageGenerationCalls.length > 0
          ? { image_generation_calls: imageGenerationCalls }
          : {}),
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

  /**
   * Formats unified response into Responses API format for the client
   */
  async formatResponse(response: UnifiedChatResponse): Promise<any> {
    const outputItems = this.convertChatResponseToOutputItems(response);
    const totalInputTokens = response.usage
      ? (response.usage.input_tokens || 0) +
        (response.usage.cached_tokens || 0) +
        (response.usage.cache_creation_tokens || 0)
      : 0;

    return {
      id: this.generateResponseId(),
      object: 'response',
      created_at: response.created || Math.floor(Date.now() / 1000),
      completed_at: Math.floor(Date.now() / 1000),
      status: 'completed',
      model: response.model,
      output: outputItems,
      usage: response.usage
        ? {
            input_tokens: totalInputTokens,
            input_tokens_details: {
              cached_tokens: response.usage.cached_tokens || 0,
            },
            output_tokens: response.usage.output_tokens,
            output_tokens_details: {
              reasoning_tokens: response.usage.reasoning_tokens || 0,
            },
            total_tokens: response.usage.total_tokens,
          }
        : undefined,
      plexus: response.plexus,
    };
  }

  /**
   * Normalizes input to array of items
   */
  private normalizeInput(input: string | any[]): any[] {
    if (typeof input === 'string') {
      // Convert simple string to message item
      return [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: input,
            },
          ],
        },
      ];
    }
    return input;
  }

  /**
   * Converts Responses API input items to Chat Completions messages
   */
  private convertInputItemsToMessages(items: any[]): UnifiedMessage[] {
    const messages: UnifiedMessage[] = [];

    for (const item of items) {
      switch (item.type) {
        case 'message':
          messages.push({
            role: this.mapInputRole(item.role),
            content: this.normalizeMessageContent(item.content),
          });
          break;

        case 'function_call': {
          // Codex CLI namespace extension: join namespace-qualified calls
          // back to the flat name providers were given in convertToolsForUnified.
          const flatName = item.namespace ? `${item.namespace}__${item.name}` : item.name;
          messages.push({
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: item.call_id,
                type: 'function',
                function: {
                  name: flatName,
                  arguments: item.arguments,
                },
              },
            ],
          });
          break;
        }

        case 'custom_tool_call': {
          // Codex CLI custom (freeform) tool, e.g. apply_patch. Wrap the raw
          // string input as JSON function-call arguments so the model sees a
          // normal function tool, matching customToolArgumentsForModel.
          this.customToolNames.add(item.name);
          messages.push({
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: item.call_id,
                type: 'function',
                function: {
                  name: item.name,
                  arguments: this.customToolArgumentsForModel(item.input),
                },
              },
            ],
          });
          break;
        }

        case 'function_call_output':
        case 'custom_tool_call_output': {
          // Add tool message with result
          const outputContent =
            typeof item.output === 'string'
              ? item.output
              : item.output?.text || JSON.stringify(item.output);

          messages.push({
            role: 'tool',
            tool_call_id: item.call_id,
            content: outputContent,
          });
          break;
        }

        case 'reasoning':
          // Convert reasoning to assistant message (limited support)
          if (item.summary && item.summary.length > 0) {
            const reasoningText = item.summary.map((part: any) => part.text).join('\n');
            messages.push({
              role: 'assistant',
              content: reasoningText,
            });
          }
          break;

        case 'additional_tools':
          // Already lifted into the tool list in parseRequest; not a message.
          break;

        default:
          if (item.role) {
            messages.push({
              role: this.mapInputRole(item.role),
              content: this.normalizeMessageContent(item.content),
            });
          }
          break;
      }
    }

    return messages;
  }

  private mapInputRole(role?: string): UnifiedMessage['role'] {
    switch (role) {
      case 'system':
      case 'developer':
        return 'system';
      case 'assistant':
        return 'assistant';
      case 'tool':
        return 'tool';
      case 'user':
      default:
        return 'user';
    }
  }

  private normalizeMessageContent(content: any): string | null | any[] {
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return this.convertContentParts(content);
    }

    return null;
  }

  /**
   * Converts Responses API content parts to Chat Completions format
   */
  private convertContentParts(parts: any[]): string | any[] {
    if (parts.length === 1 && (parts[0].type === 'input_text' || parts[0].type === 'output_text')) {
      return parts[0].text;
    }

    return parts.map((part) => {
      switch (part.type) {
        case 'input_text':
        case 'output_text':
        case 'summary_text':
          return { type: 'text', text: part.text };

        case 'input_image':
          return {
            type: 'image_url',
            image_url: {
              url: part.image_url,
              detail: part.detail,
            },
          };

        default:
          return part;
      }
    });
  }

  /**
   * Filters out built-in tools and converts function tools.
   * Used when routing Responses API → Chat Completions (outbound transform).
   */
  private convertToolsForChatCompletions(tools: any[]): any[] {
    return tools
      .filter((tool) => tool.type === 'function')
      .map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          strict: tool.strict,
        },
      }));
  }

  /**
   * Converts incoming Responses API tools to unified format.
   * Function tools are reformatted; non-function tools (built-in server-side
   * tools like web_search, web_search_20250305, openrouter:web_search) are
   * passed through as-is so provider adapters can coerce them.
   *
   * Codex CLI extensions:
   * - `type: "namespace"` tools group sub-tools; most providers only
   *   understand flat function tools, so each sub-tool is flattened to
   *   `${namespace}__${name}` and recorded in namespaceMap for split-back
   *   in convertChatResponseToOutputItems/formatStream.
   * - `type: "custom"` tools (e.g. apply_patch) take raw string input rather
   *   than JSON-schema arguments; they're exposed to the model as a function
   *   tool with a single `input: string` argument, matching the wire shape
   *   codex-ollama-proxy's `customToolArgumentsForModel` sends
   *   (`JSON.stringify({ input })`). The name is recorded in
   *   customToolNames so the response side can convert back to
   *   custom_tool_call and unwrap the argument via customToolInput().
   */
  private convertToolsForUnified(tools: any[]): any[] {
    const result: any[] = [];
    for (const tool of tools) {
      if (tool.type === 'namespace') {
        for (const subTool of tool.tools || []) {
          const flatName = `${tool.name}__${subTool.name}`;
          this.namespaceMap.set(flatName, { namespace: tool.name, name: subTool.name });
          result.push({
            type: 'function',
            function: {
              name: flatName,
              description: subTool.description || '',
              parameters: subTool.parameters || {
                type: 'object',
                properties: {},
                additionalProperties: false,
              },
              strict: subTool.strict,
            },
          });
        }
        continue;
      }

      if (tool.type === 'custom') {
        this.customToolNames.add(tool.name);
        result.push({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description || '',
            parameters: {
              type: 'object',
              properties: { input: { type: 'string' } },
              required: ['input'],
            },
          },
        });
        continue;
      }

      if (tool.type !== 'function') {
        result.push(tool);
        continue;
      }

      result.push({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          strict: tool.strict,
        },
      });
    }
    return result;
  }

  /**
   * Wraps a custom tool's raw string input into the JSON arguments shape a
   * function-calling model expects, matching codex-ollama-proxy's
   * `customToolArgumentsForModel`.
   */
  private customToolArgumentsForModel(input: any): string {
    return JSON.stringify({ input: typeof input === 'string' ? input : JSON.stringify(input) });
  }

  /**
   * Unwraps a model-generated function_call's JSON arguments back into the
   * raw string input a custom_tool_call expects, matching
   * codex-ollama-proxy's `customToolInput`. Handles:
   * - a plain string that already looks like a patch/raw input
   * - `{ input: string }` (the shape we ask the model to produce)
   * - `{ command: [..., patchBody] }` tuple form some models emit
   * - any other object: falls back to the first string-valued property
   */
  private customToolInput(rawArguments: string): string {
    if (typeof rawArguments !== 'string') {
      return rawArguments == null ? '' : String(rawArguments);
    }

    const trimmed = rawArguments.trim();
    if (trimmed.startsWith('*** Begin Patch')) {
      return rawArguments;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawArguments);
    } catch {
      return rawArguments;
    }

    if (typeof parsed === 'string') {
      return parsed;
    }

    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.input === 'string') {
        return parsed.input;
      }
      if (Array.isArray(parsed.command)) {
        const last = parsed.command[parsed.command.length - 1];
        if (typeof last === 'string') {
          return last;
        }
      }
      for (const value of Object.values(parsed)) {
        if (typeof value === 'string') {
          return value;
        }
      }
    }

    return rawArguments;
  }

  /**
   * Converts tool_choice to Chat Completions format
   */
  private convertToolChoiceForChatCompletions(toolChoice: any): any {
    if (typeof toolChoice === 'string') {
      return toolChoice;
    }
    if (toolChoice?.type === 'function') {
      return {
        type: 'function',
        function: { name: toolChoice.name },
      };
    }
    return 'auto';
  }

  /**
   * Converts Chat Completions response to output items array
   */
  private convertChatResponseToOutputItems(response: UnifiedChatResponse): ResponsesOutputItem[] {
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
        id: this.generateItemId('reason'),
        status: 'completed',
        content: contentParts,
        summary: summaryParts,
      });
    }

    // Add tool calls if present
    if (response.tool_calls && response.tool_calls.length > 0) {
      for (const toolCall of response.tool_calls) {
        items.push(this.buildToolOutputItem(toolCall));
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
        id: imageCall.id ?? this.generateItemId('ig'),
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
      id: this.generateItemId('msg'),
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
   * Converts a single Chat-Completions-style tool call back into a Responses
   * API output item, splitting namespace-flattened names back to
   * `{namespace, name}` and converting custom tool calls back to
   * custom_tool_call with unwrapped string input (customToolInput).
   */
  private buildToolOutputItem(toolCall: {
    id: string;
    function: { name: string; arguments: string };
  }): ResponsesOutputItem {
    const flatName = toolCall.function.name;

    if (this.customToolNames.has(flatName)) {
      return {
        type: 'custom_tool_call',
        id: this.generateItemId('fc'),
        status: 'completed',
        call_id: toolCall.id,
        name: flatName,
        input: this.customToolInput(toolCall.function.arguments),
      };
    }

    const namespaced = this.namespaceMap.get(flatName);
    if (namespaced) {
      return {
        type: 'function_call',
        id: this.generateItemId('fc'),
        status: 'completed',
        call_id: toolCall.id,
        name: namespaced.name,
        namespace: namespaced.namespace,
        arguments: toolCall.function.arguments,
      };
    }

    return {
      type: 'function_call',
      id: this.generateItemId('fc'),
      status: 'completed',
      call_id: toolCall.id,
      name: flatName,
      arguments: toolCall.function.arguments,
    };
  }

  transformStream(stream: ReadableStream): ReadableStream {
    // Converts Responses API SSE stream to Unified chunks
    // Following the same pattern as OpenAI and Anthropic transformers
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

  formatStream(stream: ReadableStream): ReadableStream {
    const encoder = new TextEncoder();
    const reader = stream.getReader();
    // `start(controller) {}` below uses method shorthand, so `this` inside it
    // is the stream's underlying source, not this transformer instance.
    // Capture the Codex CLI namespace/custom-tool state as locals for use
    // inside that scope.
    const customToolNames = this.customToolNames;

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
      responseId = chunk.id || this.generateResponseId();
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
      messageItemId = this.generateItemId('msg');
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
      reasoningItemId = this.generateItemId('rs');
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
      const callId = toolCall?.id || this.generateItemId('call');
      const itemId = this.generateItemId('fc');
      const flatName = toolCall?.function?.name || toolCall?.name || '';
      toolOutputIndexMap.set(toolIndex, outputIndex);
      toolCallIdMap.set(toolIndex, callId);
      toolItemIdMap.set(toolIndex, itemId);
      toolArgsMap.set(toolIndex, '');
      toolNameMap.set(toolIndex, flatName);

      // Codex CLI namespace/custom tool split-back for the streamed "added"
      // event; the resolved shape is recomputed at finalization once full
      // arguments are known.
      if (this.customToolNames.has(flatName)) {
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

      const namespaced = this.namespaceMap.get(flatName);
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
        const itemId = imageCall.id || this.generateItemId('ig');
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
        if (this.customToolNames.has(flatName)) {
          toolItem = {
            id: itemId,
            type: 'custom_tool_call',
            status: itemStatus,
            call_id: callId,
            name: flatName,
            input: this.customToolInput(args),
          };
        } else {
          const namespaced = this.namespaceMap.get(flatName);
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

    const buildUsagePayload = (usage: any) =>
      usage
        ? {
            input_tokens:
              (usage.input_tokens || 0) +
              (usage.cached_tokens || 0) +
              (usage.cache_creation_tokens || 0),
            output_tokens: usage.output_tokens,
            total_tokens: usage.total_tokens,
            input_tokens_details: {
              cached_tokens: usage.cached_tokens || 0,
            },
            output_tokens_details: {
              reasoning_tokens: usage.reasoning_tokens || 0,
            },
          }
        : undefined;

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
                  usage: lastUsage
                    ? {
                        input_tokens:
                          (lastUsage.input_tokens || 0) +
                          (lastUsage.cached_tokens || 0) +
                          (lastUsage.cache_creation_tokens || 0),
                        output_tokens: lastUsage.output_tokens,
                        total_tokens: lastUsage.total_tokens,
                        input_tokens_details: {
                          cached_tokens: lastUsage.cached_tokens || 0,
                        },
                        output_tokens_details: {
                          reasoning_tokens: lastUsage.reasoning_tokens || 0,
                        },
                      }
                    : undefined,
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
                    usage: buildUsagePayload(lastUsage),
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
                    usage: buildUsagePayload(lastUsage),
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
                  usage: lastUsage
                    ? {
                        input_tokens:
                          (lastUsage.input_tokens || 0) +
                          (lastUsage.cached_tokens || 0) +
                          (lastUsage.cache_creation_tokens || 0),
                        output_tokens: lastUsage.output_tokens,
                        total_tokens: lastUsage.total_tokens,
                        input_tokens_details: {
                          cached_tokens: lastUsage.cached_tokens || 0,
                        },
                        output_tokens_details: {
                          reasoning_tokens: lastUsage.reasoning_tokens || 0,
                        },
                      }
                    : undefined,
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

  /**
   * Extract usage information from SSE event data
   */
  extractUsage(eventData: string):
    | {
        input_tokens?: number;
        output_tokens?: number;
        cached_tokens?: number;
        cache_creation_tokens?: number;
        reasoning_tokens?: number;
      }
    | undefined {
    try {
      const event = JSON.parse(eventData);

      // For response.completed events
      if (event.type === 'response.completed' && event.response?.usage) {
        const usage = normalizeOpenAIResponsesUsage(event.response.usage);
        return {
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          cached_tokens: usage.cached_tokens,
          cache_creation_tokens: usage.cache_creation_tokens,
          reasoning_tokens: usage.reasoning_tokens,
        };
      }

      return undefined;
    } catch (e) {
      return undefined;
    }
  }

  /**
   * Generates unique response ID
   */
  private generateResponseId(): string {
    return `resp_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Generates unique item ID with prefix
   */
  private generateItemId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 15)}`;
  }
}
