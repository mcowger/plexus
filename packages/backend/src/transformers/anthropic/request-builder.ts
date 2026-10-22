import { UnifiedChatRequest } from '../../types/unified';
import { clampAnthropicEffortAndThinking } from './thinking-clamp';
import { convertUnifiedToolsToAnthropic } from './tool-mapper';

const BASE64_DATA_URL_PATTERN = /^data:([^;,]*)(?:;[^;,]*)*;base64,([\s\S]+)$/i;

type AnthropicImageSource =
  { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string };

/**
 * Converts a unified `image_url` into an Anthropic image source.
 *
 * `data:` URIs become `base64` sources and `http(s)` URLs become `url` sources.
 * Anything else cannot be expressed to Anthropic, so it is rejected locally with
 * a 400 instead of being forwarded as an empty image (which Anthropic rejects
 * with an opaque `image cannot be empty` error).
 */
function toAnthropicImageSource(url: unknown, fallbackMediaType?: string): AnthropicImageSource {
  if (typeof url === 'string') {
    const dataMatch = url.match(BASE64_DATA_URL_PATTERN);
    if (dataMatch?.[2]) {
      return {
        type: 'base64',
        media_type: dataMatch[1] || fallbackMediaType || 'image/jpeg',
        data: dataMatch[2],
      };
    }
    if (/^https?:\/\//i.test(url)) {
      return { type: 'url', url };
    }
  }

  throw Object.assign(
    new Error(
      'Unsupported image_url: expected a base64 data URI or an http(s) URL for Anthropic targets'
    ),
    { routingContext: { statusCode: 400, code: 'invalid_request_error' } }
  );
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
              content.push({
                type: 'image',
                source: toAnthropicImageSource(part.image_url?.url, part.media_type),
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

  // Cross-format structured outputs (chat `response_format`, responses
  // `text.format` — both normalized onto `request.response_format` by their
  // parsers) are expressed to Anthropic as `output_config.format`. Merge
  // without clobbering: a client-supplied `format` (same-format verbatim
  // pass-through above) always wins, and a pre-existing `output_config`
  // (e.g. `effort` from the client or registry auto-compat) is
  // spread-preserved. Only `json_schema` with a present schema is
  // expressible — Anthropic's format union has no `json_object`/bare-text
  // equivalent, so anything else is left untouched rather than fabricated.
  // An explicit `strict: false` opts out entirely: the pre-change behavior
  // was to drop the schema and complete unstructured, and Anthropic
  // enforces `format` (400 on unsupported models/keywords), so forwarding
  // a best-effort request as enforced would turn working routes into hard
  // errors. Note the deliberate asymmetry with the chat/Responses emitters:
  // those omit an UNSET `strict` (upstream default `false` applies), while
  // here an unset `strict` still forwards the schema — Anthropic's format
  // has no non-enforcing mode to default into, and skipping it would
  // reintroduce the silent unstructured drop from #985 for the most common
  // client shape. The skip below is therefore an intentional silent drop of
  // a best-effort request only; the builders are pure functions with no
  // logger, so the opt-out is documented here rather than logged.
  if (
    request.response_format?.type === 'json_schema' &&
    request.response_format.json_schema !== undefined &&
    request.response_format.strict !== false &&
    (payload.output_config as { format?: unknown } | undefined)?.format === undefined
  ) {
    payload.output_config = {
      ...(payload.output_config ?? {}),
      format: {
        type: 'json_schema',
        schema: request.response_format.json_schema,
      },
    };
  }

  return clampAnthropicEffortAndThinking(payload, request.model);
}
