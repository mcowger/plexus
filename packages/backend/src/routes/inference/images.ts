import { wireUpstreamTimeout, wireEarlyDisconnectDetection } from '../../utils/timeout';
import { FastifyInstance } from 'fastify';
import { logger } from '../../utils/logger';
import { Dispatcher } from '../../services/dispatch/dispatcher';
import { ImageTransformer } from '../../transformers';
import { formatOpenRouterImageResponse, imageReferenceFromBuffer } from '../../transformers/image';
import { UsageStorageService } from '../../services/observability/usage-storage';
import { UsageRecord } from '../../types/usage';
import { getClientIp } from '../../utils/ip';
import { calculateCosts } from '../../utils/calculate-costs';
import { DebugManager } from '../../services/observability/debug-manager';
import { UnifiedImageGenerationRequest } from '../../types/unified';
import { attachKeyAccessPolicy } from '../../utils/auth';
import { sanitizeHeaders } from '../../utils/sanitize-headers';
import { CLIENT_REQUEST_ID_HEADER, getClientRequestId } from '../../utils/client-request-id';

/**
 * Normalised view of a multipart image-edit upload, shared by both ingress
 * shapes (fields attached to `request.body` and the streaming `request.parts()`
 * iterator).
 */
type MultipartEditUpload = {
  imageBuffer?: Buffer;
  imageFilename?: string;
  imageMimeType?: string;
  maskBuffer?: Buffer;
  maskFilename?: string;
  maskMimeType?: string;
  formFields: Record<string, any>;
};

/** Repeated field names arrive as arrays (`MultipartFields`); the first entry wins. */
function firstMultipartEntry(raw: any): any {
  return Array.isArray(raw) ? raw[0] : raw;
}

/** `MultipartFile`: `{ type: 'file', fieldname, filename, mimetype, file, _buf, toBuffer() }`. */
function isMultipartFileEntry(entry: any): boolean {
  return (
    !!entry &&
    typeof entry === 'object' &&
    (entry.type === 'file' || typeof entry.toBuffer === 'function')
  );
}

/** `MultipartValue`: `{ type: 'field', fieldname, value, ... }`. */
function isMultipartValueEntry(entry: any): boolean {
  return !!entry && typeof entry === 'object' && (entry.type === 'field' || 'value' in entry);
}

/**
 * `@fastify/multipart` is registered with `attachFieldsToBody: true`, so its
 * preValidation hook drains the request and hangs the parsed parts off
 * `request.body` (a `MultipartFields` record) before the route handler runs.
 * Detect that shape so the handler reads the upload from the body instead of an
 * already-exhausted `request.parts()` iterator.
 */
function hasAttachedMultipartFields(body: any): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  return Object.values(body).some((raw) => {
    const entry = firstMultipartEntry(raw);
    return isMultipartFileEntry(entry) || isMultipartValueEntry(entry);
  });
}

/**
 * `MultipartFile.toBuffer()` caches into `_buf`; the attach hook already awaited
 * it, so this resolves from cache rather than re-reading the `file` stream.
 */
async function readMultipartFileBuffer(entry: any): Promise<Buffer | undefined> {
  if (!entry) return undefined;
  if (typeof entry.toBuffer === 'function') return await entry.toBuffer();
  if (Buffer.isBuffer(entry._buf)) return entry._buf;
  return undefined;
}

/**
 * Collapse either multipart ingress shape into a single record so the edits
 * handler works both on the running server (fields attached to the body) and
 * against a raw `request.parts()` stream.
 */
async function extractImageEditUpload(request: any): Promise<MultipartEditUpload> {
  const upload: MultipartEditUpload = { formFields: {} };

  const assignFile = (fieldname: string, entry: any, buffer: Buffer) => {
    if (fieldname === 'image') {
      upload.imageBuffer = buffer;
      upload.imageFilename = entry.filename;
      upload.imageMimeType = entry.mimetype;
    } else if (fieldname === 'mask') {
      upload.maskBuffer = buffer;
      upload.maskFilename = entry.filename;
      upload.maskMimeType = entry.mimetype;
    }
  };

  if (hasAttachedMultipartFields(request?.body)) {
    for (const [name, raw] of Object.entries(request.body as Record<string, any>)) {
      const entry = firstMultipartEntry(raw);
      if (isMultipartFileEntry(entry)) {
        const buffer = await readMultipartFileBuffer(entry);
        if (buffer) assignFile(entry.fieldname ?? name, entry, buffer);
      } else if (isMultipartValueEntry(entry)) {
        upload.formFields[entry.fieldname ?? name] = entry.value;
      }
    }
    return upload;
  }

  if (typeof request?.parts !== 'function') return upload;

  for await (const part of request.parts()) {
    if (part.type === 'file') {
      // Every file stream has to be drained for busboy to keep emitting parts.
      const buffer = await part.toBuffer();
      assignFile(part.fieldname, part, buffer);
    } else {
      upload.formFields[part.fieldname] = part.value;
    }
  }

  return upload;
}

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
  const imageGenerationHandler = async (request: any, reply: any) => {
    const requestId = crypto.randomUUID();
    const clientRequestId = getClientRequestId(request.headers);
    reply.header('x-request-id', requestId);
    if (clientRequestId) reply.header(CLIENT_REQUEST_ID_HEADER, clientRequestId);
    const startTime = Date.now();
    const abortController = new AbortController();
    const { signal, resolveTimeoutMs } = wireUpstreamTimeout(abortController);
    const disconnect = wireEarlyDisconnectDetection(request, abortController, requestId);

    let usageRecord: Partial<UsageRecord> = {
      requestId,
      clientRequestId,
      date: new Date().toISOString(),
      sourceIp: getClientIp(request),
      incomingApiType: 'images',
      startTime,
      isStreamed: false,
      responseStatus: 'pending',
    };

    // Emit 'started' event immediately - this allows frontend to show in-flight requests
    usageStorage.emitStartedAsync(usageRecord);

    try {
      const body = (request.body ?? {}) as any;
      const isOpenRouterImageRoute = request.url?.split('?')[0] === '/v1/images';

      usageRecord.incomingModelAlias = body.model;
      usageRecord.apiKey = (request as any).keyName;
      usageRecord.attribution = (request as any).attribution || null;

      // Emit 'updated' event with parsed request details
      usageStorage.emitUpdatedAsync({
        requestId,
        incomingModelAlias: body.model,
        apiKey: (request as any).keyName,
        attribution: (request as any).attribution || null,
      });

      logger.silly('Incoming Image Generation Request', body);

      const transformer = new ImageTransformer();

      let unifiedRequest: UnifiedImageGenerationRequest = isOpenRouterImageRoute
        ? await transformer.parseOpenRouterGenerationRequest({
            ...body,
            requestId,
            incomingApiType: 'images',
            originalBody: body,
          })
        : {
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
      unifiedRequest = attachKeyAccessPolicy(request, unifiedRequest);

      DebugManager.getInstance().startLog(
        requestId,
        {
          ...body,
        },
        sanitizeHeaders(request.headers as any)
      );

      const unifiedResponse = await dispatcher.dispatchImageGenerations(
        unifiedRequest,
        signal,
        resolveTimeoutMs
      );
      const clientResponse = isOpenRouterImageRoute
        ? await formatOpenRouterImageResponse(unifiedResponse, signal)
        : unifiedResponse;

      // Emit 'updated' event with routing decision details
      usageStorage.emitUpdatedAsync({
        requestId,
        provider: unifiedResponse.plexus?.provider,
        selectedModelName: unifiedResponse.plexus?.model,
        canonicalModelName: unifiedResponse.plexus?.canonicalModel,
      });

      usageRecord.provider = unifiedResponse.plexus?.provider;
      usageRecord.selectedModelName = unifiedResponse.plexus?.model;
      usageRecord.canonicalModelName = unifiedResponse.plexus?.canonicalModel;
      usageRecord.outgoingApiType = unifiedResponse.plexus?.apiType;
      usageRecord.isPassthrough = !isOpenRouterImageRoute;
      usageRecord.tokensInput =
        unifiedResponse.usage?.input_tokens ?? unifiedResponse.usage?.prompt_tokens ?? null;
      usageRecord.tokensOutput =
        unifiedResponse.usage?.output_tokens ?? unifiedResponse.usage?.completion_tokens ?? null;
      usageRecord.providerReportedCost = unifiedResponse.usage?.cost ?? null;
      usageRecord.durationMs = Date.now() - startTime;
      usageRecord.responseStatus = 'success';

      const pricing = unifiedResponse.plexus?.pricing;
      const providerDiscount = unifiedResponse.plexus?.providerDiscount;
      calculateCosts(usageRecord, pricing, providerDiscount);
      usageRecord.attemptCount = (unifiedResponse.plexus as any)?.attemptCount || 1;
      usageRecord.retryHistory =
        ((unifiedResponse.plexus as any)?.retryHistory as string | undefined) || null;

      usageStorage.saveRequest(usageRecord as UsageRecord);

      DebugManager.getInstance().addTransformedResponse(requestId, {
        created: unifiedResponse.created,
        imageCount: unifiedResponse.data?.length || 0,
      });
      DebugManager.getInstance().flush(requestId);

      // Remove internal plexus metadata before sending to client
      if (unifiedResponse.plexus) {
        delete (unifiedResponse as any).plexus;
      }

      return reply.send(clientResponse);
    } catch (e: any) {
      if (signal.aborted) {
        e = Object.assign(new Error('Client disconnected'), {
          routingContext: { ...e.routingContext, statusCode: 499, code: 'client_disconnected' },
        });
      }
      usageRecord.responseStatus = 'error';
      usageRecord.durationMs = Date.now() - startTime;
      usageRecord.attemptCount = e.routingContext?.attemptCount || usageRecord.attemptCount || 1;
      usageRecord.retryHistory = e.routingContext?.retryHistory || usageRecord.retryHistory || null;
      usageStorage.saveRequest(usageRecord as UsageRecord);

      const errorDetails = {
        apiType: 'images',
        ...(e.routingContext || {}),
      };

      usageStorage.saveError(requestId, e, errorDetails);
      DebugManager.getInstance().flush(requestId);
      logger.error('Error processing image generation request', e);

      const statusCode = e.routingContext?.statusCode || 500;
      return reply.code(statusCode).send({
        error: {
          message: e.message,
          type:
            e.routingContext?.code || (statusCode === 400 ? 'invalid_request_error' : 'api_error'),
        },
      });
    } finally {
      disconnect.cleanup();
    }
  };

  fastify.post('/v1/images', imageGenerationHandler);
  fastify.post('/v1/images/generations', imageGenerationHandler);

  /**
   * POST /v1/images/edits
   * OpenAI Compatible Image Editing Endpoint.
   * Accepts multipart/form-data with image file, prompt, and editing parameters.
   */
  fastify.post('/v1/images/edits', async (request, reply) => {
    const requestId = crypto.randomUUID();
    const clientRequestId = getClientRequestId(request.headers);
    reply.header('x-request-id', requestId);
    if (clientRequestId) reply.header(CLIENT_REQUEST_ID_HEADER, clientRequestId);
    const startTime = Date.now();
    const abortController = new AbortController();
    const { signal, resolveTimeoutMs } = wireUpstreamTimeout(abortController);
    const disconnect = wireEarlyDisconnectDetection(request, abortController, requestId);

    let usageRecord: Partial<UsageRecord> = {
      requestId,
      clientRequestId,
      date: new Date().toISOString(),
      sourceIp: getClientIp(request),
      incomingApiType: 'images',
      startTime,
      isStreamed: false,
      responseStatus: 'pending',
    };

    usageStorage.emitStartedAsync(usageRecord);

    try {
      // Parse multipart/form-data from whichever shape the plugin produced.
      const { imageBuffer, imageFilename, imageMimeType, maskBuffer, maskMimeType, formFields } =
        await extractImageEditUpload(request);

      if (!imageBuffer) {
        return reply.code(400).send({
          error: { message: 'Missing required field: image', type: 'validation_error' },
        });
      }

      if (!formFields.prompt) {
        return reply.code(400).send({
          error: { message: 'Missing required field: prompt', type: 'validation_error' },
        });
      }

      usageRecord.incomingModelAlias = formFields.model;
      usageRecord.apiKey = (request as any).keyName;
      usageRecord.attribution = (request as any).attribution || null;

      usageStorage.emitUpdatedAsync({
        requestId,
        incomingModelAlias: formFields.model,
        apiKey: (request as any).keyName,
        attribution: (request as any).attribution || null,
      });

      logger.silly('Incoming Image Edit Request', {
        model: formFields.model,
        prompt: formFields.prompt?.substring(0, 100),
        filename: imageFilename,
        hasMask: !!maskBuffer,
      });

      // Edits share the generation IR: the upload is the single input
      // reference and the optional mask rides alongside it.
      let unifiedRequest: UnifiedImageGenerationRequest = {
        model: formFields.model,
        prompt: formFields.prompt,
        input_references: [imageReferenceFromBuffer(imageBuffer, imageMimeType)],
        ...(maskBuffer ? { mask: imageReferenceFromBuffer(maskBuffer, maskMimeType) } : {}),
        n: formFields.n ? parseInt(formFields.n) : undefined,
        size: formFields.size,
        response_format: formFields.response_format,
        quality: formFields.quality,
        user: formFields.user,
        requestId,
        incomingApiType: 'images',
        originalBody: formFields,
      };
      unifiedRequest = attachKeyAccessPolicy(request, unifiedRequest);

      DebugManager.getInstance().startLog(
        requestId,
        {
          model: formFields.model,
          prompt: formFields.prompt?.substring(0, 100),
          filename: imageFilename,
          hasMask: !!maskBuffer,
          n: formFields.n,
          size: formFields.size,
        },
        sanitizeHeaders(request.headers as any)
      );

      const unifiedResponse = await dispatcher.dispatchImageGenerations(
        unifiedRequest,
        signal,
        resolveTimeoutMs
      );

      usageStorage.emitUpdatedAsync({
        requestId,
        provider: unifiedResponse.plexus?.provider,
        selectedModelName: unifiedResponse.plexus?.model,
        canonicalModelName: unifiedResponse.plexus?.canonicalModel,
      });

      usageRecord.provider = unifiedResponse.plexus?.provider;
      usageRecord.selectedModelName = unifiedResponse.plexus?.model;
      usageRecord.canonicalModelName = unifiedResponse.plexus?.canonicalModel;
      usageRecord.outgoingApiType = unifiedResponse.plexus?.apiType;
      // The multipart body is translated into the image IR, never forwarded verbatim.
      usageRecord.isPassthrough = false;
      usageRecord.durationMs = Date.now() - startTime;
      usageRecord.responseStatus = 'success';

      const pricing = unifiedResponse.plexus?.pricing;
      const providerDiscount = unifiedResponse.plexus?.providerDiscount;
      calculateCosts(usageRecord, pricing, providerDiscount);
      usageRecord.attemptCount = (unifiedResponse.plexus as any)?.attemptCount || 1;
      usageRecord.retryHistory =
        ((unifiedResponse.plexus as any)?.retryHistory as string | undefined) || null;

      usageStorage.saveRequest(usageRecord as UsageRecord);

      DebugManager.getInstance().addTransformedResponse(requestId, {
        created: unifiedResponse.created,
        imageCount: unifiedResponse.data?.length || 0,
      });
      DebugManager.getInstance().flush(requestId);

      // Remove internal plexus metadata before sending to client
      if (unifiedResponse.plexus) {
        delete (unifiedResponse as any).plexus;
      }

      return reply.send(unifiedResponse);
    } catch (e: any) {
      if (signal.aborted) {
        e = Object.assign(new Error('Client disconnected'), {
          routingContext: { ...e.routingContext, statusCode: 499, code: 'client_disconnected' },
        });
      }
      usageRecord.responseStatus = 'error';
      usageRecord.durationMs = Date.now() - startTime;
      usageRecord.attemptCount = e.routingContext?.attemptCount || usageRecord.attemptCount || 1;
      usageRecord.retryHistory = e.routingContext?.retryHistory || usageRecord.retryHistory || null;
      usageStorage.saveRequest(usageRecord as UsageRecord);

      const errorDetails = {
        apiType: 'images',
        ...(e.routingContext || {}),
      };

      usageStorage.saveError(requestId, e, errorDetails);
      DebugManager.getInstance().flush(requestId);
      logger.error('Error processing image edit request', e);

      const statusCode = e.routingContext?.statusCode || 500;
      return reply.code(statusCode).send({
        error: {
          message: e.message,
          type:
            e.routingContext?.code || (statusCode === 400 ? 'invalid_request_error' : 'api_error'),
        },
      });
    } finally {
      disconnect.cleanup();
    }
  });
}
