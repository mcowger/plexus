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
import { UnifiedChatRequest, UnifiedChatResponse, UnifiedMessage } from '../types/unified';
import { createParser } from 'eventsource-parser';
import { encode } from 'eventsource-encoder';
import { logger } from '../utils/logger';
import { normalizeOpenAIChatUsage, normalizeOpenAIResponsesUsage } from '../utils/usage-normalizer';

const OPENAI_RESPONSES_CALL_ID_MAX_LENGTH = 64;
const OPENAI_RESPONSES_REASONING_CONTENT_MAX_ITEMS = 0;

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

    return {
      requestId: input.requestId,
      model: input.model,
      messages,
      max_tokens: input.max_output_tokens,
      temperature: input.temperature ?? 1.0,
      stream: input.stream ?? false,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: this.convertToolChoiceForChatCompletions(input.tool_choice),
      reasoning: input.reasoning,
      include: input.include,
      prompt_cache_key: input.prompt_cache_key,
      text: input.text,
      parallel_tool_calls: input.parallel_tool_calls,
      response_format: input.text?.format
        ? {
            type: input.text.format.type,
            json_schema: input.text.format.schema,
          }
        : undefined,
      metadata: input.metadata,
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

    const payload: any = {
      model: request.model,
      input: inputItems,
      stream: request.stream,
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
      payload.reasoning = request.reasoning;
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
      const content = messageItem?.content?.map((part: any) => part.text).join('\n') || null;

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

    // Add main message
    items.push({
      type: 'message',
      id: this.generateItemId('msg'),
      status: 'completed',
      role: 'assistant',
      content: [
        {
          type: 'output_text',
          text: response.content || '',
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
              } else if (data.type === 'response.completed') {
                // Final chunk with usage data and an OpenAI-compatible finish reason.
                // `response.completed` includes the full output as a fallback because some
                // Responses-compatible providers omit intermediate function-call events.
                const usage = data.response?.usage;
                const normalizedUsage = usage ? normalizeOpenAIResponsesUsage(usage) : undefined;
                const completedResponseHasFunctionCall = data.response?.output?.some(
                  (item: any) => item?.type === 'function_call'
                );
                controller.enqueue({
                  id: responseId,
                  model: responseModel,
                  created: Math.floor(Date.now() / 1000),
                  delta: {},
                  finish_reason:
                    hasFunctionCall || completedResponseHasFunctionCall ? 'tool_calls' : 'stop',
                  usage: normalizedUsage,
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
          return trimmed;
        } catch {
          return previous + delta;
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

    const finalizeOutputItems = (controller: ReadableStreamDefaultController): any[] => {
      if (reasoningItemSent && reasoningOutputIndex !== null) {
        const reasoningItem = {
          id: reasoningItemId,
          type: 'reasoning',
          status: 'completed',
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
          status: 'completed',
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
            status: 'completed',
            call_id: callId,
            name: flatName,
            input: this.customToolInput(args),
          };
        } else {
          const namespaced = this.namespaceMap.get(flatName);
          toolItem = {
            id: itemId,
            type: 'function_call',
            status: 'completed',
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

            if (unifiedChunk.usage) {
              lastUsage = unifiedChunk.usage;
            }

            const delta = unifiedChunk.delta || {};
            const reasoningDelta =
              typeof delta.reasoning_content === 'string' ? delta.reasoning_content : null;
            const reasoningSummaryDelta =
              typeof delta.thinking?.content === 'string' ? delta.thinking.content : null;

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

            if (typeof delta.content === 'string' && delta.content.length > 0) {
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
