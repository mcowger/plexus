import { UnifiedChatRequest } from '../../types/unified';
import { projectReasoningForResponses } from '../utils';

/**
 * Transforms Chat Completions request to Responses API format (not typically needed)
 */
export async function buildResponsesRequest(request: UnifiedChatRequest): Promise<any> {
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
    const strict = tool.function?.strict;
    return {
      type: 'function',
      name: tool.function?.name ?? '',
      description: tool.function?.description ?? '',
      parameters: tool.function?.parameters ?? {},
      ...(strict !== undefined ? { strict } : {}),
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
