import {
  UnifiedChatRequest,
  UnifiedMessage,
  ImageContent,
  TextContent,
  UnifiedChatResponse,
} from '../types/unified';
import { Dispatcher } from './dispatcher';
import { logger } from '../utils/logger';
import { DEFAULT_VISION_DESCRIPTION_PROMPT } from '../utils/constants';
import { UsageStorageService } from './usage-storage';
import { calculateCosts } from '../utils/calculate-costs';
import { estimateKwhUsed } from './inference-energy';
import { DEFAULT_GPU_PARAMS, DEFAULT_MODEL } from '@plexus/shared';

export class VisionDescriptorService {
  /**
   * Processes a request by converting images to text descriptions if needed.
   * Modifies a clone of the original request.
   *
   * @param request The original UnifiedChatRequest
   * @param descriptorModel The model ID to use for generating descriptions
   * @param defaultPrompt The prompt to send with each image
   * @param usageStorage Optional usage storage to record the descriptor call
   * @returns A modified UnifiedChatRequest with images replaced by text
   */
  public static async process(
    request: UnifiedChatRequest,
    descriptorModel: string,
    defaultPrompt = DEFAULT_VISION_DESCRIPTION_PROMPT,
    usageStorage?: UsageStorageService
  ): Promise<UnifiedChatRequest> {
    const images = this.extractImages(request.messages);
    if (images.length === 0) return request;

    logger.info(
      `[vision-fallthrough] Describing ${images.length} images using model '${descriptorModel}'`
    );

    // Concurrent execution of all image descriptions
    const descriptions = await Promise.all(
      images.map((url) =>
        this.describeImage(url, descriptorModel, defaultPrompt, usageStorage, request)
      )
    );

    // Inject descriptions back into messages
    const modifiedMessages = this.injectDescriptions(request.messages, descriptions);

    return {
      ...request,
      messages: modifiedMessages,
    };
  }

  /**
   * Checks if a request contains any images.
   */
  public static hasImages(messages: UnifiedMessage[]): boolean {
    for (const msg of messages) {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'image_url' || (block as any).type === 'image') {
            logger.debug(
              `[vision-fallthrough] Found image block: type=${block.type || (block as any).type}`
            );
            return true;
          }
        }
      }
    }
    return false;
  }

  private static extractImages(messages: UnifiedMessage[]): string[] {
    const urls: string[] = [];
    for (const msg of messages) {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'image_url') {
            urls.push(block.image_url.url);
          } else if ((block as any).type === 'image') {
            // Handle Anthropic-style image blocks
            const source = (block as any).source;
            if (source?.data) {
              const mediaType = source.media_type || 'image/png';
              urls.push(`data:${mediaType};base64,${source.data}`);
            } else {
              logger.warn(
                '[vision-fallthrough] Found Anthropic image block but missing source.data'
              );
            }
          }
        }
      }
    }
    logger.debug(`[vision-fallthrough] Extracted ${urls.length} images for description`);
    return urls;
  }

  private static async describeImage(
    url: string,
    model: string,
    prompt: string,
    usageStorage?: UsageStorageService,
    parentRequest?: UnifiedChatRequest
  ): Promise<string> {
    const dispatcher = new Dispatcher();
    if (usageStorage) {
      dispatcher.setUsageStorage(usageStorage);
    }

    // Create a request for the descriptor model
    const descriptorRequest: UnifiedChatRequest = {
      model: model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
      // Pass through parent request context for logging
      incomingApiType: 'chat',
      ...(parentRequest
        ? {
            sourceIp: (parentRequest as any).sourceIp,
            apiKey: (parentRequest as any).apiKey,
            keyName: (parentRequest as any).keyName,
            attribution: (parentRequest as any).attribution,
          }
        : {}),
    };

    // Recursion guard: tag this request so Dispatcher doesn't try to fallthrough again
    (descriptorRequest as any)._isVisionDescriptorRequest = true;
    (descriptorRequest as any)._descriptorStartTime = Date.now();
    (descriptorRequest as any).requestId = `desc-${crypto.randomUUID()}`;

    const startTime: number = (descriptorRequest as any)._descriptorStartTime;
    const requestId: string = (descriptorRequest as any).requestId;

    try {
      logger.debug(`[vision-fallthrough] Dispatching description request to model '${model}'`);
      const response = await dispatcher.dispatch(descriptorRequest);
      const durationMs = Date.now() - startTime;
      const description = response.content;

      if (usageStorage) {
        const usageRecord: any = {
          requestId,
          date: new Date().toISOString(),
          startTime,
          durationMs,
          createdAt: Date.now(),
          incomingApiType: 'chat',
          outgoingApiType: response.plexus?.apiType ?? null,
          provider: response.plexus?.provider ?? null,
          selectedModelName: response.plexus?.model ?? model,
          canonicalModelName: response.plexus?.canonicalModel ?? null,
          incomingModelAlias: model,
          sourceIp: (parentRequest as any)?.sourceIp ?? null,
          apiKey: (parentRequest as any)?.apiKey ?? null,
          attribution: (parentRequest as any)?.attribution ?? null,
          attemptCount: 1,
          isStreamed: false,
          isPassthrough: false,
          responseStatus: description ? 'success' : 'error',
          tokensInput: response.usage?.input_tokens ?? null,
          tokensOutput: response.usage?.output_tokens ?? null,
          tokensCached: response.usage?.cached_tokens ?? null,
          tokensCacheWrite: response.usage?.cache_creation_tokens ?? null,
          tokensReasoning: response.usage?.reasoning_tokens ?? null,
          isDescriptorRequest: true,
          isVisionFallthrough: false,
        };

        // Calculate costs if pricing data is available
        if (response.plexus?.pricing) {
          calculateCosts(usageRecord, response.plexus.pricing, response.plexus.providerDiscount);
        }

        if (usageRecord.tokensInput != null && usageRecord.tokensOutput != null) {
          usageRecord.kwhUsed = estimateKwhUsed(
            usageRecord.tokensInput,
            usageRecord.tokensOutput,
            response.plexus?.modelParams ?? DEFAULT_MODEL,
            response.plexus?.gpuParams ?? DEFAULT_GPU_PARAMS
          );
        }

        usageStorage.saveRequest(usageRecord).catch((err) => {
          logger.error(`[vision-fallthrough] Failed to save descriptor usage record: ${err}`);
        });
      }

      if (!description) {
        logger.warn(`[vision-fallthrough] Model ${model} returned empty description for image`);
        return 'No description available.';
      }

      logger.debug(`[vision-fallthrough] Received description (${description.length} chars)`);
      return description;
    } catch (error) {
      logger.error(`[vision-fallthrough] Error describing image with ${model}:`, error);

      if (usageStorage) {
        const durationMs = Date.now() - startTime;
        usageStorage
          .saveRequest({
            requestId,
            date: new Date().toISOString(),
            startTime,
            durationMs,
            createdAt: Date.now(),
            incomingApiType: 'chat',
            outgoingApiType: null,
            provider: null,
            selectedModelName: model,
            canonicalModelName: null,
            incomingModelAlias: model,
            sourceIp: (parentRequest as any)?.sourceIp ?? null,
            apiKey: (parentRequest as any)?.apiKey ?? null,
            attribution: (parentRequest as any)?.attribution ?? null,
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

      return 'Error generating image description.';
    }
  }

  private static injectDescriptions(
    messages: UnifiedMessage[],
    descriptions: string[]
  ): UnifiedMessage[] {
    let descIdx = 0;
    const result = messages.map((msg) => {
      // If content is a string, we need to convert it to an array of blocks if it has images
      // but images are only in array-style content, so if it's a string, we just return it.
      if (!Array.isArray(msg.content)) return msg;

      const newContent = msg.content.map((block) => {
        if (block.type === 'image_url' || (block as any).type === 'image') {
          const desc = descriptions[descIdx++] || 'No description available.';
          logger.debug(
            `[vision-fallthrough] Replacing image block with description (length: ${desc.length})`
          );
          return {
            type: 'text',
            text: `[Image Description: ${desc}]`,
          } as TextContent;
        }
        return block;
      });

      return { ...msg, content: newContent };
    });

    logger.debug(`[vision-fallthrough] injectDescriptions finished. Replaced ${descIdx} images.`);
    return result;
  }
}
