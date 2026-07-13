import type { UnifiedChatRequest } from '../../types/unified';
import type { getConfig } from '../../config';
import type { RouteResult } from '../routing/router';
import type { UsageStorageService } from '../observability/usage-storage';
import { logger } from '../../utils/logger';
import { DEFAULT_VISION_DESCRIPTION_PROMPT } from '../../utils/constants';
import { VisionDescriptorService } from './vision-descriptor-service';

/** Applies optional image-to-text fallthrough before an upstream attempt. */
export async function preprocessVisionRequest(
  request: UnifiedChatRequest,
  route: RouteResult,
  config: ReturnType<typeof getConfig>,
  usageStorage?: UsageStorageService
): Promise<UnifiedChatRequest> {
  const aliasConfig = route.canonicalModel ? config.models?.[route.canonicalModel] : undefined;
  const isDescriptorRequest = (request as any)._isVisionDescriptorRequest === true;
  const hasImages = VisionDescriptorService.hasImages(request.messages);

  logger.debug(
    `Checking: canonicalModel='${route.canonicalModel}', use_image_fallthrough='${aliasConfig?.use_image_fallthrough}', hasImages='${hasImages}', isVisionDescriptorRequest='${isDescriptorRequest}'`
  );

  if (isDescriptorRequest || !aliasConfig?.use_image_fallthrough || !hasImages) {
    return request;
  }

  const visionConfig = config.vision_fallthrough;
  if (!visionConfig?.descriptor_model) {
    logger.warn(
      `Feature enabled for alias '${request.model}' but 'vision_fallthrough.descriptor_model' not configured globally.`
    );
    return request;
  }

  try {
    logger.debug(
      `Before process: ${JSON.stringify(request.messages.map((message) => ({ role: message.role, contentCount: Array.isArray(message.content) ? message.content.length : 'string' })))}`
    );
    const processed = await VisionDescriptorService.process(
      request,
      visionConfig.descriptor_model,
      visionConfig.default_prompt || DEFAULT_VISION_DESCRIPTION_PROMPT,
      usageStorage
    );
    logger.debug(
      `After process: ${JSON.stringify(processed.messages.map((message) => ({ role: message.role, contentCount: Array.isArray(message.content) ? message.content.length : 'string' })))}`
    );

    if (VisionDescriptorService.hasImages(processed.messages)) {
      logger.error(
        'CRITICAL: VisionDescriptorService.process returned a request that STILL contains images!'
      );
    }

    (processed as any)._hasVisionFallthrough = true;
    (processed as any)._visionFallthroughModel = visionConfig.descriptor_model;
    logger.debug(`Successfully preprocessed images for ${route.provider}/${route.model}`);
    return processed;
  } catch (error) {
    logger.error('Error in descriptor service:', error);
    return request;
  }
}
