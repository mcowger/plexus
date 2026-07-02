/**
 * Vision fallthrough for the beta (inference-v2) pi-ai path.
 *
 * Converts image content blocks in a pi-ai `Context` into text descriptions
 * produced by a configured "descriptor" model, for target models/providers
 * that don't support vision input. This is a native pi-ai implementation —
 * it operates directly on `Context` / `ImageContent` / `TextContent` and
 * dispatches the descriptor sub-call straight through `piAiModels.complete()`.
 * It does NOT go through `UnifiedChatRequest` or the legacy `Dispatcher`
 * (see `services/vision-descriptor-service.ts` for that v1 path).
 *
 * Because the descriptor sub-call bypasses `runPiAiExecutor` entirely (it
 * calls `piAiModels.complete()` directly), there is no recursion risk and no
 * need for a `_isVisionDescriptorRequest` guard flag like the v1 path uses.
 */

import crypto from 'node:crypto';
import { calculateCost } from '@earendil-works/pi-ai';
import type { Context, ImageContent, Message, TextContent } from '@earendil-works/pi-ai';
import { Router } from '../../services/router';
import { CooldownManager } from '../../services/cooldown-manager';
import { ConcurrencyTracker } from '../../services/concurrency-tracker';
import type { UsageStorageService } from '../../services/usage-storage';
import { logger } from '../../utils/logger';
import {
  buildPiAiModel,
  computeKwhUsed,
  piAiModels,
  resolvePiAiModel,
  toDispatchModel,
} from './pi-ai-utils';

const DESCRIPTION_CACHE_MAX = 500;

// LRU cache: key = "<model>:<sha256(imageData)>", value = description string.
// Shared module-level cache, mirroring VisionDescriptorService's cache shape.
const descriptionCache = new Map<string, string>();

function cacheKeyFor(image: ImageContent, model: string): string {
  const hash = crypto.createHash('sha256').update(image.data).digest('hex');
  return `${model}:${hash}`;
}

function cacheGet(key: string): string | undefined {
  if (!descriptionCache.has(key)) return undefined;
  const val = descriptionCache.get(key)!;
  // Move to end (most recently used)
  descriptionCache.delete(key);
  descriptionCache.set(key, val);
  return val;
}

function cacheSet(key: string, value: string): void {
  if (descriptionCache.has(key)) {
    descriptionCache.delete(key);
  } else if (descriptionCache.size >= DESCRIPTION_CACHE_MAX) {
    // Evict least recently used (first entry in Map insertion order)
    descriptionCache.delete(descriptionCache.keys().next().value!);
  }
  descriptionCache.set(key, value);
}

/** Clears the in-memory description cache. Primarily useful in tests. */
export function clearVisionFallthroughCacheForTesting(): void {
  descriptionCache.clear();
}

function messageContentBlocks(msg: Message): (TextContent | ImageContent)[] | undefined {
  if (msg.role === 'user' && Array.isArray(msg.content)) return msg.content;
  if (msg.role === 'toolResult') return msg.content;
  return undefined;
}

/** Checks whether any message in a pi-ai Context carries image content. */
export function contextHasImages(context: Context): boolean {
  for (const msg of context.messages) {
    const blocks = messageContentBlocks(msg);
    if (blocks?.some((b) => b.type === 'image')) return true;
  }
  return false;
}

function collectImages(messages: Message[]): ImageContent[] {
  const images: ImageContent[] = [];
  for (const msg of messages) {
    const blocks = messageContentBlocks(msg);
    if (!blocks) continue;
    for (const block of blocks) {
      if (block.type === 'image') images.push(block);
    }
  }
  return images;
}

/** Replaces image blocks with text-description blocks, in traversal order. */
function injectDescriptions(messages: Message[], descriptions: string[]): Message[] {
  let descIdx = 0;
  return messages.map((msg) => {
    const blocks = messageContentBlocks(msg);
    if (!blocks) return msg;

    const newContent = blocks.map((block) => {
      if (block.type === 'image') {
        const desc = descriptions[descIdx++] ?? 'No description available.';
        return { type: 'text', text: `[Image Description: ${desc}]` } as TextContent;
      }
      return block;
    });

    return { ...msg, content: newContent } as Message;
  });
}

export interface VisionFallthroughParentMeta {
  sourceIp?: string | null;
  keyName?: string;
  attribution?: string | null;
}

async function recordDescriptorUsage(
  usageStorage: UsageStorageService,
  route: import('../../services/router').RouteResult,
  piModel: any,
  message: import('@earendil-works/pi-ai').AssistantMessage,
  startTime: number,
  descriptorModel: string,
  responseStatus: string,
  parentMeta?: VisionFallthroughParentMeta
): Promise<void> {
  const durationMs = Date.now() - startTime;
  const usage = message.usage;
  const cost = calculateCost(piModel, usage);
  const kwhUsed = computeKwhUsed(usage.input, usage.output, route);

  await usageStorage
    .saveRequest({
      requestId: `desc-${crypto.randomUUID()}`,
      date: new Date().toISOString(),
      startTime,
      durationMs,
      createdAt: Date.now(),
      incomingApiType: 'chat',
      outgoingApiType: piModel.api,
      provider: route.provider,
      selectedModelName: route.model,
      canonicalModelName: route.canonicalModel ?? null,
      incomingModelAlias: descriptorModel,
      sourceIp: parentMeta?.sourceIp ?? null,
      apiKey: parentMeta?.keyName ?? null,
      attribution: parentMeta?.attribution ?? null,
      attemptCount: 1,
      isStreamed: false,
      isPassthrough: false,
      responseStatus,
      tokensInput: usage.input,
      tokensOutput: usage.output,
      tokensCached: usage.cacheRead,
      tokensCacheWrite: usage.cacheWrite,
      tokensReasoning: usage.reasoning ?? null,
      costInput: cost?.input ?? null,
      costOutput: cost?.output ?? null,
      costCached: cost?.cacheRead ?? null,
      costCacheWrite: cost?.cacheWrite ?? null,
      costTotal: cost?.total ?? null,
      costSource: 'pi-ai',
      costMetadata: null,
      kwhUsed,
      isDescriptorRequest: true,
      isVisionFallthrough: false,
    } as any)
    .catch((err) => {
      logger.error(`[vision-fallthrough] Failed to save descriptor usage record: ${err}`);
    });
}

async function recordDescriptorErrorUsage(
  usageStorage: UsageStorageService,
  descriptorModel: string,
  startTime: number,
  route?: import('../../services/router').RouteResult,
  parentMeta?: VisionFallthroughParentMeta
): Promise<void> {
  await usageStorage
    .saveRequest({
      requestId: `desc-${crypto.randomUUID()}`,
      date: new Date().toISOString(),
      startTime,
      durationMs: Date.now() - startTime,
      createdAt: Date.now(),
      incomingApiType: 'chat',
      outgoingApiType: null,
      provider: route?.provider ?? null,
      selectedModelName: route?.model ?? descriptorModel,
      canonicalModelName: route?.canonicalModel ?? null,
      incomingModelAlias: descriptorModel,
      sourceIp: parentMeta?.sourceIp ?? null,
      apiKey: parentMeta?.keyName ?? null,
      attribution: parentMeta?.attribution ?? null,
      attemptCount: 1,
      isStreamed: false,
      isPassthrough: false,
      responseStatus: 'error',
      tokensInput: null,
      tokensOutput: null,
      tokensCached: null,
      costInput: null,
      costOutput: null,
      costCached: null,
      costTotal: null,
      costSource: null,
      costMetadata: null,
      isDescriptorRequest: true,
      isVisionFallthrough: false,
    } as any)
    .catch(() => {});
}

/**
 * Describe a single image via the configured descriptor model, dispatching
 * directly through pi-ai (candidate resolution → cooldown/concurrency gate →
 * `piAiModels.complete()`), with simple sequential failover across
 * beta-compatible candidates. Results are cached by (model, image-hash).
 */
async function describeImage(
  image: ImageContent,
  descriptorModel: string,
  prompt: string,
  usageStorage?: UsageStorageService,
  parentMeta?: VisionFallthroughParentMeta
): Promise<string> {
  const key = cacheKeyFor(image, descriptorModel);
  const cached = cacheGet(key);
  if (cached !== undefined) {
    logger.debug(`[vision-fallthrough] Cache hit for descriptor model '${descriptorModel}'`);
    return cached;
  }

  let candidates;
  try {
    candidates = await Router.resolveCandidates(descriptorModel, 'chat');
    if (candidates.length === 0) {
      candidates = [await Router.resolve(descriptorModel, 'chat')];
    }
  } catch (err) {
    logger.error(
      `[vision-fallthrough] No route found for descriptor model '${descriptorModel}':`,
      err
    );
    if (usageStorage) {
      await recordDescriptorErrorUsage(
        usageStorage,
        descriptorModel,
        Date.now(),
        undefined,
        parentMeta
      );
    }
    return 'Error generating image description.';
  }

  const betaCandidates = candidates.filter((c) => {
    const piAiProvider = (c.config as any).pi_ai_provider as string | undefined;
    const piAiModelId = (c.modelConfig as any)?.pi_ai_model_id as string | undefined;
    if (!piAiProvider || !piAiModelId) return false;
    return resolvePiAiModel(piAiProvider, piAiModelId) != null;
  });

  if (betaCandidates.length === 0) {
    logger.error(
      `[vision-fallthrough] No beta-compatible candidate for descriptor model '${descriptorModel}'`
    );
    if (usageStorage) {
      await recordDescriptorErrorUsage(
        usageStorage,
        descriptorModel,
        Date.now(),
        undefined,
        parentMeta
      );
    }
    return 'Error generating image description.';
  }

  const descriptorContext: Context = {
    messages: [
      {
        role: 'user',
        content: [image, { type: 'text', text: prompt } as TextContent],
        timestamp: Date.now(),
      },
    ],
  };

  const cooldown = CooldownManager.getInstance();
  const concurrency = ConcurrencyTracker.getInstance();

  for (const route of betaCandidates) {
    const healthy = await cooldown.isProviderHealthy(route.provider, route.model);
    if (!healthy) continue;

    if (!concurrency.acquire(route.provider, route.model)) continue;

    // Guarantee the concurrency slot is released exactly once regardless of
    // where in this block a throw occurs (buildPiAiModel, piAiModels.complete,
    // or the usage-recording call) — mirrors the doRelease pattern used in
    // pi-ai-executor.ts.
    let released = false;
    const doRelease = () => {
      if (released) return;
      released = true;
      concurrency.release(route.provider, route.model);
    };

    const startTime = Date.now();
    try {
      const piAiProvider = (route.config as any).pi_ai_provider as string;
      const piAiModelId = (route.modelConfig as any)?.pi_ai_model_id as string;
      const piModel = buildPiAiModel(route.config, piAiProvider, piAiModelId, 'chat');
      if (!piModel) {
        doRelease();
        continue;
      }

      logger.debug(
        `[vision-fallthrough] Dispatching description request to ${route.provider}/${route.model}`
      );
      const message = await piAiModels.complete(
        toDispatchModel(piModel as any),
        descriptorContext,
        {
          apiKey: route.config.api_key,
          headers: route.config.headers,
        }
      );

      cooldown.markProviderSuccess(route.provider, route.model);
      doRelease();

      const textBlock = message.content.find((b) => b.type === 'text') as TextContent | undefined;
      const description = textBlock?.text?.trim();

      if (usageStorage) {
        await recordDescriptorUsage(
          usageStorage,
          route,
          piModel,
          message,
          startTime,
          descriptorModel,
          description ? 'success' : 'error',
          parentMeta
        );
      }

      if (!description) {
        logger.warn(
          `[vision-fallthrough] Model ${descriptorModel} returned empty description for image`
        );
        // Cache the negative result too: an empty descriptor response is a
        // deterministic model output for this image, not a transient failure,
        // so retrying on every request would just waste descriptor API calls.
        cacheSet(key, 'No description available.');
        return 'No description available.';
      }

      cacheSet(key, description);
      return description;
    } catch (err) {
      doRelease();
      cooldown.markProviderFailure(route.provider, route.model);
      logger.error(
        `[vision-fallthrough] Error describing image with ${route.provider}/${route.model}:`,
        err
      );
      if (usageStorage) {
        await recordDescriptorErrorUsage(
          usageStorage,
          descriptorModel,
          startTime,
          route,
          parentMeta
        );
      }
      // Try the next beta-compatible candidate.
      continue;
    }
  }

  return 'Error generating image description.';
}

/**
 * Processes a pi-ai Context by converting image content blocks into text
 * descriptions produced by `descriptorModel`. Returns a new Context (the
 * input is never mutated); returns the original reference unchanged when
 * there are no images.
 */
export async function applyVisionFallthrough(
  context: Context,
  descriptorModel: string,
  prompt: string,
  usageStorage?: UsageStorageService,
  parentMeta?: VisionFallthroughParentMeta
): Promise<Context> {
  const images = collectImages(context.messages);
  if (images.length === 0) return context;

  logger.debug(
    `[vision-fallthrough] Describing ${images.length} images using model '${descriptorModel}'`
  );

  const descriptions = await Promise.all(
    images.map((image) => describeImage(image, descriptorModel, prompt, usageStorage, parentMeta))
  );

  const messages = injectDescriptions(context.messages, descriptions);

  logger.debug(`[vision-fallthrough] Replaced ${images.length} images with descriptions`);

  return { ...context, messages };
}
