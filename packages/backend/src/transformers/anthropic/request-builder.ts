import { UnifiedChatRequest } from '../../types/unified';
import { convertUnifiedToolsToAnthropic } from './tool-mapper';

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

      // A `thinking` block is emitted whether or not a signature is present.
      // This builder does not know the concrete upstream: the Messages wire
      // format is shared by Anthropic itself and by compatible endpoints with
      // different thinking semantics. Anthropic requires a signature on every
      // thinking block and 400s without one, but e.g. Kimi's compatible
      // endpoint requires unsigned thinking to remain on historical assistant
      // tool-call messages — dropping it here would break that provider. The
      // Anthropic-specific strip lives in the `strip_unsigned_thinking`
      // adapter, injected only for targets known to be Anthropic
      // (`adapter-resolver.ts`), with the reactive strip-and-retry in
      // `dispatcher-auto-compat.ts` as the fallback for unknown gateways.
      //
      // A signature can go missing when the history reached us on a wire
      // format that has nowhere to carry it: OpenAI chat-completions exposes
      // prior reasoning only as `reasoning_content` text. In that case the
      // `signature` key is omitted entirely rather than sent as `undefined` —
      // JSON serialisation would drop it anyway, but downstream code that
      // inspects the built payload should see the true shape.
      if (msg.thinking) {
        content.push({
          type: 'thinking',
          thinking: msg.thinking.content,
          ...(msg.thinking.signature ? { signature: msg.thinking.signature } : {}),
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
              const imageBlock = buildAnthropicImageBlock(part);
              if (imageBlock) {
                content.push({
                  ...imageBlock,
                  ...(part.cache_control !== undefined
                    ? { cache_control: part.cache_control }
                    : {}),
                });
              }
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

  return payload;
}

const DATA_URL_PATTERN = /^data:([^;,]+)?((?:;[^;,]+)*?)(;base64)?,(.*)$/s;

/**
 * Convert a unified `image_url` content part into an Anthropic `image` block.
 *
 * The unified schema carries images the OpenAI way: a single `url` that is
 * either a `data:` URL with the bytes inline or an `http(s)` URL to fetch.
 * Anthropic models the same two cases as `source.type: 'base64'` (with the
 * payload in `data` and the MIME type in `media_type`) and `source.type: 'url'`.
 *
 * Previously this branch emitted a base64 source with `data: ''` regardless of
 * input, which Anthropic rejects with
 * `messages.N.content.M.image.source.base64: image cannot be empty`, so any
 * chat-completions client attaching an image to a Claude target got a 400.
 *
 * Returns `undefined` when there is nothing valid to send (no url, malformed or
 * empty data URL). Emitting nothing beats emitting a block we know upstream will
 * reject; the surrounding text and tool blocks still go through.
 */
export function buildAnthropicImageBlock(part: {
  image_url?: { url?: string };
  media_type?: string;
}): Record<string, any> | undefined {
  const url = part.image_url?.url;
  if (typeof url !== 'string' || url.length === 0) return undefined;

  if (url.startsWith('data:')) {
    const match = DATA_URL_PATTERN.exec(url);
    if (!match) return undefined;
    const [, mimeFromUrl, , base64Marker, rawData] = match;
    if (!base64Marker) {
      // Anthropic only accepts base64 for inline images; a percent-encoded
      // (non-base64) data URL cannot be forwarded as-is.
      return undefined;
    }
    const data = (rawData ?? '').trim();
    if (data.length === 0) return undefined;

    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: part.media_type || mimeFromUrl || 'image/jpeg',
        data,
      },
    };
  }

  if (/^https?:\/\//i.test(url)) {
    return {
      type: 'image',
      source: { type: 'url', url },
    };
  }

  return undefined;
}
