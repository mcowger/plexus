import { UnifiedChatRequest } from '../../types/unified';
import { convertUnifiedToolsToAnthropic } from './tool-mapper';

class AnthropicImageValidationError extends Error {
  readonly routingContext = {
    statusCode: 400,
    code: 'invalid_image_source',
  } as const;

  constructor(message: string) {
    super(message);
    this.name = 'AnthropicImageValidationError';
  }
}

/**
 * Converts a unified `image_url` part into an Anthropic image `source`.
 * Unified carries images as data URIs (Anthropic base64 sources and Chat /
 * Responses data URIs), http(s) URLs, or raw base64 with a `media_type`
 * sibling. Nothing is validated beyond what is needed to pick a source shape;
 * Anthropic rejects malformed data or unsupported media types itself.
 */
export function toAnthropicImageSource(part: {
  image_url?: { url?: string };
  media_type?: string;
}): { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string } {
  const url = part.image_url?.url;
  if (typeof url !== 'string' || url.length === 0) {
    throw new AnthropicImageValidationError(
      'Invalid Anthropic image source: image_url.url must be a non-empty string'
    );
  }

  if (/^data:/i.test(url)) {
    const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
    if (!match) {
      throw new AnthropicImageValidationError(
        'Invalid Anthropic image source: data URI images must be base64-encoded (data:<media_type>;base64,<data>)'
      );
    }
    return { type: 'base64', media_type: match[1]!, data: match[2]! };
  }

  if (/^https?:\/\//i.test(url)) {
    return { type: 'url', url };
  }

  return {
    type: 'base64',
    media_type: part.media_type || 'image/jpeg',
    data: url,
  };
}

/**
 * Pulls the JSON Schema from the unified `response_format` (populated by the
 * Chat and Responses parsers; `json_schema` holds the schema itself).
 */
export function jsonSchemaFromUnified(
  request: UnifiedChatRequest
): Record<string, unknown> | undefined {
  const responseFormat = request.response_format;
  if (
    responseFormat?.type === 'json_schema' &&
    responseFormat.json_schema &&
    typeof responseFormat.json_schema === 'object'
  ) {
    return responseFormat.json_schema as Record<string, unknown>;
  }
  return undefined;
}

/**
 * Transforms a Unified request into Anthropic API format.
 *
 * Key transformations:
 * - System message extraction
 * - Message role normalization (tool -> user)
 * - Tool call reconstruction from unified format
 * - Message merging (consecutive messages with same role)
 */
export async function buildAnthropicRequest(request: UnifiedChatRequest): Promise<any> {
  let system: string | { type: string; text: string; cache_control?: unknown }[] | undefined;
  const messages: any[] = [];

  for (const msg of request.messages) {
    if (msg.role === 'system') {
      if (typeof msg.content === 'string') {
        system = msg.content;
      } else if (Array.isArray(msg.content)) {
        // Filter out Claude Code-specific billing header blocks. These are only valid
        // for the pi-ai OAuth Claude Code path and must not be forwarded via the
        // translation path to upstream messages endpoints.
        const filteredBlocks = msg.content.filter(
          (block: any) =>
            !(
              block.type === 'text' &&
              typeof block.text === 'string' &&
              block.text.trimStart().startsWith('x-anthropic-billing-header:')
            )
        );
        if (filteredBlocks.length > 0) {
          system = filteredBlocks.map((block: any) => ({
            type: block.type as string,
            text: block.text as string,
            ...(block.cache_control !== undefined ? { cache_control: block.cache_control } : {}),
          }));
        }
      }
    } else if (msg.role === 'user' || msg.role === 'assistant') {
      const content: any[] = [];

      if (msg.thinking) {
        content.push({
          type: 'thinking',
          thinking: msg.thinking.content,
          signature: msg.thinking.signature,
        });
      }

      if (msg.content) {
        if (typeof msg.content === 'string') {
          content.push({ type: 'text', text: msg.content });
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === 'text') {
              content.push({
                type: 'text',
                text: part.text,
                ...(part.cache_control !== undefined ? { cache_control: part.cache_control } : {}),
              });
            } else if (part.type === 'image_url') {
              const source = toAnthropicImageSource(part);
              content.push({
                type: 'image',
                source,
                ...(part.cache_control !== undefined ? { cache_control: part.cache_control } : {}),
              });
            }
          }
        }
      }

      if (msg.role === 'assistant' && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments),
          });
        }
      }

      messages.push({ role: msg.role, content });
    } else if (msg.role === 'tool') {
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: msg.tool_call_id,
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          },
        ],
      });
    }
  }

  // Merge consecutive messages of the same role
  // This is required by Anthropic API: can't have consecutive user or assistant messages
  const mergedMessages: any[] = [];
  for (const msg of messages) {
    if (mergedMessages.length > 0) {
      const last = mergedMessages[mergedMessages.length - 1];
      if (last.role === msg.role) {
        last.content.push(...msg.content);
        continue;
      }
    }
    mergedMessages.push(msg);
  }

  const payload: any = {
    model: request.model,
    messages: mergedMessages,
    system: system,
    max_tokens: request.max_tokens || 4096,
    temperature: request.temperature,
    stream: request.stream,
    tools: request.tools ? convertUnifiedToolsToAnthropic(request.tools) : undefined,
  };

  // For same-format (messages -> messages) requests, carry through Anthropic-native
  // top-level fields that the unified schema does not model. The unified schema
  // intentionally abstracts away provider-specific options (thinking config, output
  // config, metadata) so cross-format transforms don't drop them on the floor when
  // the client is talking the same API type as the upstream provider.
  if (request.incomingApiType?.toLowerCase() === 'messages' && request.originalBody) {
    const passthroughFields = [
      'thinking',
      'output_config',
      'metadata',
      'tool_choice',
      'top_p',
      'top_k',
      'stop_sequences',
      'prompt_cache_key',
    ];
    for (const field of passthroughFields) {
      if (request.originalBody[field] !== undefined && payload[field] === undefined) {
        payload[field] = request.originalBody[field];
      }
    }
  }

  // Cross-format (Responses `text.format` / Chat `response_format`) → Anthropic
  // structured outputs. Same-format messages already carry `output_config` via
  // the passthrough above; only fill `format` when the client didn't send one.
  const schema = jsonSchemaFromUnified(request);
  if (schema && payload.output_config?.format === undefined) {
    payload.output_config = {
      ...(payload.output_config ?? {}),
      format: { type: 'json_schema', schema },
    };
  }

  return payload;
}
