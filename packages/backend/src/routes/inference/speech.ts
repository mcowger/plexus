import { FastifyInstance } from 'fastify';
import { logger } from '../../utils/logger';
import { Dispatcher } from '../../services/dispatcher';
import { SpeechTransformer } from '../../transformers';
import { UsageStorageService } from '../../services/usage-storage';
import { UsageRecord } from '../../types/usage';
import { getClientIp } from '../../utils/ip';
import { calculateCosts } from '../../utils/calculate-costs';
import { DebugManager } from '../../services/debug-manager';
import { UnifiedSpeechRequest } from '../../types/unified';

const VALID_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];
const VALID_FORMATS = ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'];
const VALID_STREAM_FORMATS = ['sse', 'audio'];

export async function registerSpeechRoute(
  fastify: FastifyInstance,
  dispatcher: Dispatcher,
  usageStorage: UsageStorageService
) {
  /**
   * POST /v1/audio/speech
   * OpenAI Compatible Text-to-Speech Endpoint.
   * Accepts JSON body with text, voice, and model parameters.
   */
  fastify.post('/v1/audio/speech', async (request, reply) => {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();

    let usageRecord: Partial<UsageRecord> = {
      requestId,
      date: new Date().toISOString(),
      sourceIp: getClientIp(request),
      incomingApiType: 'speech',
      startTime,
      isStreamed: false,
      responseStatus: 'pending'
    };

    try {
      const body = request.body as any;

      usageRecord.incomingModelAlias = body.model;
      usageRecord.apiKey = (request as any).keyName;
      usageRecord.attribution = (request as any).attribution || null;

      logger.silly('Incoming Speech Request', body);

      const transformer = new SpeechTransformer();

      const unifiedRequest: UnifiedSpeechRequest = {
        model: body.model,
        input: body.input,
        voice: body.voice,
        instructions: body.instructions,
        response_format: body.response_format,
        speed: body.speed,
        stream_format: body.stream_format,
        requestId,
        incomingApiType: 'speech',
        originalBody: body,
      };

      DebugManager.getInstance().startLog(requestId, {
        model: body.model,
        voice: body.voice,
        inputLength: body.input?.length || 0,
        response_format: body.response_format,
        speed: body.speed,
        stream_format: body.stream_format,
        instructions: body.instructions ? '(provided)' : undefined,
      });

      const unifiedResponse = await dispatcher.dispatchSpeech(unifiedRequest);

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
        size: unifiedResponse.audio?.length || 0,
        isStreamed: unifiedResponse.isStreamed,
      });
      DebugManager.getInstance().flush(requestId);

      const mimeType = transformer.getMimeType(unifiedRequest.response_format);
      reply.type(mimeType);

      if (unifiedResponse.stream) {
        usageRecord.isStreamed = true;
        return reply.send(unifiedResponse.stream);
      }

      return reply.send(unifiedResponse.audio);

    } catch (e: any) {
      usageRecord.responseStatus = 'error';
      usageRecord.durationMs = Date.now() - startTime;
      usageStorage.saveRequest(usageRecord as UsageRecord);

      const errorDetails = {
        apiType: 'speech',
        ...(e.routingContext || {})
      };

      usageStorage.saveError(requestId, e, errorDetails);
      logger.error('Error processing speech request', e);

      return reply.code(500).send({
        error: { message: e.message, type: 'api_error' }
      });
    }
  });
}