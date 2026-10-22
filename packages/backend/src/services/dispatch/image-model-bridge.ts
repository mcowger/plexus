import type { PlexusConfig } from '../../config';
/**
 * Auto-bridge: a CHAT-SHAPED request that names an IMAGE-TYPE model.
 *
 * Clients that only speak a chat surface (Chat Completions, Responses,
 * Anthropic Messages, Gemini, Ollama, legacy Completions) still want to reach
 * an image model by simply naming it. This module turns such a request into
 * an ordinary image generation, dispatches it through the SAME image pipeline
 * the REST `/v1/images/generations` surface uses, and synthesizes unified
 * output that every existing client formatter already renders.
 *
 * Three responsibilities, deliberately kept in one module:
 *   1. DETECTION (`isImageModelRoute`) — reads the ALREADY-RESOLVED route
 *      candidates, so alias lookup, `additional_aliases`, `direct/` syntax,
 *      key-access policy and quota skips are never re-implemented here.
 *   2. REQUEST BUILDING (`buildImageRequestFromChat`) — the last user message
 *      becomes the prompt; its `image_url` parts become `input_references`
 *      (which is what turns a chat request with an attached image into an
 *      EDIT downstream).
 *   3. RESPONSE SYNTHESIS (`synthesizeChatResponse` / `synthesizeChatStream`)
 *      — already-unified output. `handleResponse` picks the provider
 *      transformer from `plexus.apiType` (here: `images`) and only calls
 *      `transformStream` when the transformer defines one; the no-op
 *      `ImageBridgeTransformer` defines none, so the synthesized unified
 *      chunk stream flows straight into the client formatter.
 *
 * The rendering contract is the one `transformers/responses.ts` already
 * produces for a native `image_generation_call` (see types/unified.ts):
 * completed items are carried TYPED, and on the streaming path each typed
 * chunk-level carry is paired 1:1 with its chat-format markdown rendering on
 * the SAME chunk's `delta.content`. Chat-format clients render the markdown;
 * the Responses-format client re-emits the native item and structurally skips
 * the paired delta. No formatter needed a change for this bridge.
 */
import { ImageRequestValidationError, resolveImageReference } from '../../transformers/image';
import { imageGenerationCallMarkdown } from '../../transformers/image-rendering';
import type {
  MessageContent,
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedChatStreamChunk,
  UnifiedImageGenerationCall,
  UnifiedImageGenerationRequest,
  UnifiedImageGenerationResponse,
  UnifiedImageReference,
  UnifiedMessage,
  UnifiedUsage,
} from '../../types/unified';
import { logger } from '../../utils/logger';
import type { RouteResult } from '../routing/router';
import type { ResolveTimeoutMs } from './upstream-execution';

/**
 * The single operation the bridge needs from the Dispatcher facade: the same
 * `dispatchImageGenerations` the REST image routes call, so provider
 * preferences, key policy, quota, cooldown, concurrency, failover and attempt
 * metadata all apply identically.
 */
export interface ImageBridgeHost {
  dispatchImageGenerations(
    request: UnifiedImageGenerationRequest,
    signal?: AbortSignal,
    resolveTimeoutMs?: ResolveTimeoutMs
  ): Promise<UnifiedImageGenerationResponse>;
}

/**
 * Aliases already warned about for mixed image/non-image targets. Process-wide
 * (the condition is a config mistake, not a request property); cleared by
 * `resetImageBridgeWarningsForTesting`.
 */
const warnedMixedTargetAliases = new Set<string>();

/** Test seam: forget which aliases have already been warned about. */
export function resetImageBridgeWarningsForTesting(): void {
  warnedMixedTargetAliases.clear();
}

/**
 * True when this chat-shaped request should be served as an image generation.
 *
 * Detection is deliberately CONFIG-DRIVEN and never looks at `request.tools`:
 * a Responses client that asks a chat model for the built-in
 * `image_generation` tool must keep its ordinary tool semantics, and an
 * image-typed model must bridge whether or not tools are present.
 *
 * Two signals, in order:
 *   1. the resolved alias declares `type: 'image'` — authoritative;
 *   2. otherwise EVERY candidate's model config declares `type: 'image'`.
 *
 * A mixed candidate set with no alias-level type is ambiguous (the alias fans
 * out across image and non-image targets), so it is NOT bridged; a warning
 * names the alias so the operator can add the alias-level `type`.
 *
 * Takes the request (not just candidates + config, as the seam's other
 * helpers do) purely to skip Plexus's own internal vision-descriptor
 * requests, which are chat requests by construction and must never bridge.
 */
export function isImageModelRoute(
  request: UnifiedChatRequest,
  candidates: RouteResult[],
  config: PlexusConfig
): boolean {
  if ((request as any)._isVisionDescriptorRequest) return false;
  if (candidates.length === 0) return false;

  const canonicalModel = candidates[0]!.canonicalModel;
  if (canonicalModel && config.models?.[canonicalModel]?.type === 'image') return true;

  const candidateTypes = candidates.map((candidate) => candidate.modelConfig?.type);
  if (candidateTypes.every((type) => type === 'image')) return true;

  if (candidateTypes.some((type) => type === 'image')) {
    const alias = canonicalModel ?? request.model;
    // Configuration-shaped advice, not a per-request event: warn once per
    // alias so a misconfigured alias under load does not flood the log.
    if (!warnedMixedTargetAliases.has(alias)) {
      warnedMixedTargetAliases.add(alias);
      logger.warn(
        `Not bridging '${alias}' to image generation: its targets mix ` +
          `image and non-image models. Set 'type: image' on the alias to bridge it.`
      );
    }
  }
  return false;
}

/** Text of a chat message, joining `text` parts of the multimodal form. */
function messageText(content: UnifiedMessage['content'] | undefined): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((part): part is Extract<MessageContent, { type: 'text' }> => part?.type === 'text')
    .map((part) => part.text)
    .filter((text) => typeof text === 'string' && text.trim().length > 0)
    .join('\n')
    .trim();
}

/** `image_url` parts of a chat message, as image references (same shape). */
function messageImageReferences(
  content: UnifiedMessage['content'] | undefined
): UnifiedImageReference[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter((part) => part?.type === 'image_url' && typeof part.image_url?.url === 'string')
    .map((part) => {
      const image = part as Extract<MessageContent, { type: 'image_url' }>;
      return {
        type: 'image_url' as const,
        image_url: { url: image.image_url.url },
        ...(image.media_type ? { media_type: image.media_type } : {}),
      };
    });
}

/**
 * Builds the image request from a chat-shaped one.
 *
 * The LAST user message is the instruction (earlier turns are conversation
 * history, which an image model has no way to consume), and its inline images
 * ride along as `input_references` — the same field the REST image surface
 * uses for edits. Legacy Completions clients have no messages worth reading:
 * their raw `prompt` field is the instruction.
 *
 * Size / quality / background / output_format are deliberately left UNSET so
 * model- and alias-level `extraBody` and the target transformer's own
 * defaults still decide them, exactly as on the REST surface.
 */
export function buildImageRequestFromChat(
  request: UnifiedChatRequest
): UnifiedImageGenerationRequest {
  const lastUserMessage = [...(request.messages ?? [])]
    .reverse()
    .find((message) => message?.role === 'user');

  const completionsPrompt =
    typeof request.prompt === 'string'
      ? request.prompt.trim()
      : Array.isArray(request.prompt)
        ? request.prompt.join('\n').trim()
        : '';

  const prompt = completionsPrompt || messageText(lastUserMessage?.content);
  if (!prompt) {
    throw new ImageRequestValidationError(
      `Model '${request.model}' is an image model, but the request carries no prompt text to generate from.`
    );
  }

  const inputReferences = messageImageReferences(lastUserMessage?.content);

  return {
    model: request.model,
    prompt,
    n: 1,
    ...(inputReferences.length > 0 ? { input_references: inputReferences } : {}),
    incomingApiType: 'images',
    ...(request.requestId !== undefined ? { requestId: request.requestId } : {}),
    ...(request.metadata !== undefined ? { metadata: request.metadata } : {}),
    // The route already logged the full chat body; a summary keeps the debug
    // trace honest about where this image request came from without
    // duplicating a potentially huge conversation.
    originalBody: {
      bridged_from: request.incomingApiType ?? 'chat',
      model: request.model,
      messages: request.messages?.length ?? 0,
      input_references: inputReferences.length,
      stream: request.stream === true,
    },
  };
}

/** All six UnifiedUsage fields, which `finalizeUsage` reads unconditionally. */
function toUnifiedUsage(usage: UnifiedImageGenerationResponse['usage']): UnifiedUsage {
  const inputTokens = usage?.input_tokens ?? usage?.prompt_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? usage?.completion_tokens ?? 0;
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: usage?.total_tokens ?? inputTokens + outputTokens,
    reasoning_tokens: 0,
    cached_tokens: 0,
    cache_creation_tokens: 0,
  };
}

/**
 * Turns the image response's `data` into typed unified image items.
 *
 * A URL-only item is materialized to base64 through `resolveImageReference`
 * — the same policy `formatOpenRouterImageResponse` applies — because the
 * unified image carry is base64-only and a chat client cannot be handed a
 * provider URL it may not be allowed to fetch.
 */
async function toImageGenerationCalls(
  response: UnifiedImageGenerationResponse
): Promise<UnifiedImageGenerationCall[]> {
  const items = await Promise.all(
    (response.data ?? []).map(async (item) => {
      if (typeof item.b64_json === 'string' && item.b64_json.length > 0) return item.b64_json;
      if (typeof item.url !== 'string' || item.url.length === 0) return '';
      const resolved = await resolveImageReference({
        type: 'image_url',
        image_url: { url: item.url },
        ...(item.media_type ? { media_type: item.media_type } : {}),
      });
      return resolved.data.toString('base64');
    })
  );

  return items
    .filter((result) => result.length > 0)
    .map((result) => ({ id: `ig_${crypto.randomUUID()}`, status: 'completed', result }));
}

/** Chat-format markdown for a typed item (or the oversized placeholder). */
function renderMarkdown(item: UnifiedImageGenerationCall): string | null {
  // imageGenerationCallMarkdown keys on the Responses-API item shape; the
  // unified carry is that item minus its `type` discriminator.
  return imageGenerationCallMarkdown({ ...item, type: 'image_generation_call' });
}

/**
 * Unary synthesis: typed image items only. `content` stays null (pure
 * authored text — there is none), so each client formatter composes its own
 * projection: markdown for chat-format clients, a native output item for
 * Responses clients.
 */
export async function synthesizeChatResponse(
  imageResponse: UnifiedImageGenerationResponse,
  request: UnifiedChatRequest
): Promise<UnifiedChatResponse> {
  return {
    id: `imgbridge_${crypto.randomUUID()}`,
    model: request.model,
    created: imageResponse.created ?? Math.floor(Date.now() / 1000),
    content: null,
    image_generation_calls: await toImageGenerationCalls(imageResponse),
    finishReason: 'stop',
    usage: toUnifiedUsage(imageResponse.usage),
    // Verbatim: apiType 'images' (which selects the no-op transformer) plus
    // the provider/model/pricing and attempt metadata the image dispatch
    // already attached.
    plexus: imageResponse.plexus,
  };
}

/**
 * Streaming synthesis: one chunk per image, pairing the chat-format markdown
 * on `delta.content` with the chunk-level typed carry (never inside `delta`,
 * which chat formatters forward by reference onto the wire), then a finish
 * chunk.
 *
 * The finish chunk MUST carry `usage`: a streamed response records its usage
 * through the transformed-snapshot fallback, which reads the client-facing
 * stream — so usage that never reaches a client chunk is usage that is never
 * recorded.
 */
export async function synthesizeChatStream(
  imageResponse: UnifiedImageGenerationResponse,
  request: UnifiedChatRequest
): Promise<UnifiedChatResponse> {
  const id = `imgbridge_${crypto.randomUUID()}`;
  const created = imageResponse.created ?? Math.floor(Date.now() / 1000);
  const items = await toImageGenerationCalls(imageResponse);

  const chunks: UnifiedChatStreamChunk[] = [];
  for (const item of items) {
    const markdown = renderMarkdown(item);
    if (!markdown) continue;
    chunks.push({
      id,
      model: request.model,
      created,
      delta: { role: 'assistant', content: markdown },
      image_generation_calls: [item],
      finish_reason: null,
    });
  }
  chunks.push({
    id,
    model: request.model,
    created,
    delta: {},
    finish_reason: 'stop',
    usage: toUnifiedUsage(imageResponse.usage),
  });

  return {
    id,
    model: request.model,
    content: null,
    stream: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    bypassTransformation: false,
    plexus: imageResponse.plexus,
  };
}

/**
 * Builds the image request, dispatches it through the image pipeline, and
 * synthesizes unified chat output. Errors — validation, quota, provider —
 * propagate unchanged so their routing context still decides the client
 * status code.
 */
export async function bridgeChatToImageGeneration(
  request: UnifiedChatRequest,
  candidates: RouteResult[],
  host: ImageBridgeHost,
  signal?: AbortSignal,
  resolveTimeoutMs?: ResolveTimeoutMs
): Promise<UnifiedChatResponse> {
  const imageRequest = buildImageRequestFromChat(request);
  logger.info(
    `Bridging ${request.incomingApiType ?? 'chat'} request for image model ` +
      `'${candidates[0]?.canonicalModel ?? request.model}' to image generation ` +
      `(${candidates.length} candidate${candidates.length === 1 ? '' : 's'})`
  );

  const imageResponse = await host.dispatchImageGenerations(imageRequest, signal, resolveTimeoutMs);

  return request.stream
    ? synthesizeChatStream(imageResponse, request)
    : synthesizeChatResponse(imageResponse, request);
}
