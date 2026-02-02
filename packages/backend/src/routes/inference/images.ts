import { FastifyInstance } from 'fastify';
import { logger } from '../../utils/logger';
import { Dispatcher } from '../../services/dispatcher';
import { ImageTransformer } from '../../transformers';
import { UsageStorageService } from '../../services/usage-storage';
import { UsageRecord } from '../../types/usage';
import { getClientIp } from '../../utils/ip';
import { calculateCosts } from '../../utils/calculate-costs';
import { DebugManager } from '../../services/debug-manager';
import { UnifiedImageGenerationRequest, UnifiedImageEditRequest } from '../../types/unified';

export async function registerImagesRoute(
  fastify: FastifyInstance,
  dispatcher: Dispatcher,
  usageStorage: UsageStorageService
) {
  /**
   * POST /v1/images/generations
   * OpenAI Compatible Image Generation Endpoint.
   * Accepts JSON body with prompt, model, and image generation parameters.
   */
  fastify.post('/v1/images/generations', async (request, reply) => {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();

    let usageRecord: Partial<UsageRecord> = {
      requestId,
      date: new Date().toISOString(),
      sourceIp: getClientIp(request),
      incomingApiType: 'images',
      startTime,
      isStreamed: false,
      responseStatus: 'pending'
    };

    try {
      const body = request.body as any;

      usageRecord.incomingModelAlias = body.model;
      usageRecord.apiKey = (request as any).keyName;
      usageRecord.attribution = (request as any).attribution || null;

      logger.silly('Incoming Image Generation Request', body);

      const transformer = new ImageTransformer();

      const unifiedRequest: UnifiedImageGenerationRequest = {
        model: body.model,
        prompt: body.prompt,
        n: body.n,
        size: body.size,
        response_format: body.response_format,
        quality: body.quality,
        style: body.style,
        user: body.user,
        requestId,
        incomingApiType: 'images',
        originalBody: body,
      };

      DebugManager.getInstance().startLog(requestId, {
        model: body.model,
        prompt: body.prompt?.substring(0, 100),
        n: body.n,
        size: body.size,
        response_format: body.response_format,
      });

      const unifiedResponse = await dispatcher.dispatchImageGenerations(unifiedRequest);

      usageRecord.provider = unifiedResponse.plexus?.provider;
      usageRecord.selectedModelName = unifiedResponse.plexus?.model;
      usageRecord.canonicalModelName = unifiedResponse.plexus?.canonicalModel;
      usageRecord.outgoingApiType = unifiedResponse.plexus?.apiType;
      usageRecord.isPassthrough = true;
      usageRecord.durationMs = Date.now() - startTime;
      usageRecord.responseStatus = 'success';

      const pricing = unifiedResponse.plexus?.pricing;
      const providerDiscount = unifiedResponse.plexus?.providerDiscount;
      calculateCosts(usageRecord, pricing, providerDiscount);

      await usageStorage.saveRequest(usageRecord as UsageRecord);

      DebugManager.getInstance().addTransformedResponse(requestId, {
        created: unifiedResponse.created,
        imageCount: unifiedResponse.data?.length || 0,
      });
      DebugManager.getInstance().flush(requestId);

      return reply.send(unifiedResponse);

    } catch (e: any) {
      usageRecord.responseStatus = 'error';
      usageRecord.durationMs = Date.now() - startTime;
      usageStorage.saveRequest(usageRecord as UsageRecord);

      const errorDetails = {
        apiType: 'images',
        ...(e.routingContext || {})
      };

      usageStorage.saveError(requestId, e, errorDetails);
      logger.error('Error processing image generation request', e);

      return reply.code(500).send({
        error: { message: e.message, type: 'api_error' }
      });
    }
  });

  /**
   * POST /v1/images/edits
   * OpenAI Compatible Image Editing Endpoint.
   * Accepts multipart/form-data with image file, prompt, and editing parameters.
   */
  fastify.post('/v1/images/edits', async (request, reply) => {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();

    let usageRecord: Partial<UsageRecord> = {
      requestId,
      date: new Date().toISOString(),
      sourceIp: getClientIp(request),
      incomingApiType: 'images',
      startTime,
      isStreamed: false,
      responseStatus: 'pending'
    };

    try {
      // Parse multipart/form-data
      const parts = request.parts();
      let imageBuffer: Buffer | undefined;
      let imageFilename: string | undefined;
      let imageMimeType: string | undefined;
      let maskBuffer: Buffer | undefined;
      let maskFilename: string | undefined;
      let maskMimeType: string | undefined;
      const formFields: Record<string, any> = {};

      for await (const part of parts) {
        if (part.type === 'file') {
          const buffer = await part.toBuffer();
          if (part.fieldname === 'image') {
            imageBuffer = buffer;
            imageFilename = part.filename;
            imageMimeType = part.mimetype;
          } else if (part.fieldname === 'mask') {
            maskBuffer = buffer;
            maskFilename = part.filename;
            maskMimeType = part.mimetype;
          }
        } else {
          formFields[part.fieldname] = part.value;
        }
      }

      if (!imageBuffer) {
        return reply.code(400).send({
          error: { message: 'Missing required field: image', type: 'validation_error' }
        });
      }

      if (!formFields.prompt) {
        return reply.code(400).send({
          error: { message: 'Missing required field: prompt', type: 'validation_error' }
        });
      }

      usageRecord.incomingModelAlias = formFields.model;
      usageRecord.apiKey = (request as any).keyName;
      usageRecord.attribution = (request as any).attribution || null;

      logger.silly('Incoming Image Edit Request', {
        model: formFields.model,
        prompt: formFields.prompt?.substring(0, 100),
        filename: imageFilename,
        hasMask: !!maskBuffer,
      });

      const unifiedRequest: UnifiedImageEditRequest = {
        model: formFields.model,
        prompt: formFields.prompt,
        image: imageBuffer,
        filename: imageFilename || 'image.png',
        mimeType: imageMimeType || 'image/png',
        mask: maskBuffer,
        maskFilename: maskFilename || 'mask.png',
        maskMimeType: maskMimeType || 'image/png',
        n: formFields.n ? parseInt(formFields.n) : undefined,
        size: formFields.size,
        response_format: formFields.response_format,
        quality: formFields.quality,
        user: formFields.user,
        requestId,
        incomingApiType: 'images',
        originalBody: formFields,
      };

      DebugManager.getInstance().startLog(requestId, {
        model: formFields.model,
        prompt: formFields.prompt?.substring(0, 100),
        filename: imageFilename,
        hasMask: !!maskBuffer,
        n: formFields.n,
        size: formFields.size,
      });

      const unifiedResponse = await dispatcher.dispatchImageEdits(unifiedRequest);

      usageRecord.provider = unifiedResponse.plexus?.provider;
      usageRecord.selectedModelName = unifiedResponse.plexus?.model;
      usageRecord.canonicalModelName = unifiedResponse.plexus?.canonicalModel;
      usageRecord.outgoingApiType = unifiedResponse.plexus?.apiType;
      usageRecord.isPassthrough = true;
      usageRecord.durationMs = Date.now() - startTime;
      usageRecord.responseStatus = 'success';

      const pricing = unifiedResponse.plexus?.pricing;
      const providerDiscount = unifiedResponse.plexus?.providerDiscount;
      calculateCosts(usageRecord, pricing, providerDiscount);

      await usageStorage.saveRequest(usageRecord as UsageRecord);

      DebugManager.getInstance().addTransformedResponse(requestId, {
        created: unifiedResponse.created,
        imageCount: unifiedResponse.data?.length || 0,
      });
      DebugManager.getInstance().flush(requestId);

      return reply.send(unifiedResponse);

    } catch (e: any) {
      usageRecord.responseStatus = 'error';
      usageRecord.durationMs = Date.now() - startTime;
      usageStorage.saveRequest(usageRecord as UsageRecord);

      const errorDetails = {
        apiType: 'images',
        ...(e.routingContext || {})
      };

      usageStorage.saveError(requestId, e, errorDetails);
      logger.error('Error processing image edit request', e);

      return reply.code(500).send({
        error: { message: e.message, type: 'api_error' }
      });
    }
  });
}
