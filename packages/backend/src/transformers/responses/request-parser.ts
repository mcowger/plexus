import { UnifiedChatRequest, UnifiedMessage } from '../../types/unified';
import {
  ResponsesToolState,
  convertToolsForUnified,
  convertToolChoiceForChatCompletions,
  customToolArgumentsForModel,
} from './tool-mapper';

export * from './normalization';

/**
 * Normalizes input to array of items
 */
export function normalizeInput(input: string | any[]): any[] {
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
 * Maps incoming role string to unified message role
 */
export function mapInputRole(role?: string): UnifiedMessage['role'] {
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

/**
 * Converts Responses API content parts to Chat Completions format
 */
export function convertContentParts(parts: any[]): string | any[] {
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
 * Normalizes message content into string, null, or parts array
 */
export function normalizeMessageContent(content: any): string | null | any[] {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return convertContentParts(content);
  }

  return null;
}

/**
 * Converts Responses API input items to Chat Completions messages
 */
export function convertInputItemsToMessages(
  items: any[],
  state?: ResponsesToolState
): UnifiedMessage[] {
  const messages: UnifiedMessage[] = [];

  for (const item of items) {
    switch (item.type) {
      case 'message':
        messages.push({
          role: mapInputRole(item.role),
          content: normalizeMessageContent(item.content),
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
        state?.customToolNames.add(item.name);
        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: item.call_id,
              type: 'function',
              function: {
                name: item.name,
                arguments: customToolArgumentsForModel(item.input),
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
            role: mapInputRole(item.role),
            content: normalizeMessageContent(item.content),
          });
        }
        break;
    }
  }

  return messages;
}

/**
 * Parses incoming Responses API request into unified format
 */
export async function parseResponsesRequest(
  input: any,
  state?: ResponsesToolState
): Promise<UnifiedChatRequest> {
  // Validate required fields
  if (!input.model) {
    throw new Error('Missing required field: model');
  }
  if (!input.input) {
    throw new Error('Missing required field: input');
  }

  state?.namespaceMap.clear();
  state?.customToolNames.clear();

  // Normalize input to array format
  const normalizedInput = normalizeInput(input.input);

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
  const tools = convertToolsForUnified([...(input.tools || []), ...liftedTools], state);

  // Convert input items to Chat Completions messages
  const messages = convertInputItemsToMessages(normalizedInput, state);

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
    tool_choice: convertToolChoiceForChatCompletions(input.tool_choice),
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
            ...(input.text.format.strict !== undefined ? { strict: input.text.format.strict } : {}),
          },
        }
      : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    incomingApiType: 'responses',
    originalBody: input,
  };
}
