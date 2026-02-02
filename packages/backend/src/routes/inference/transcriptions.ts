import { FastifyInstance } from 'fastify';
import { logger } from '../../utils/logger';
import { Dispatcher } from '../../services/dispatcher';
import { TranscriptionsTransformer } from '../../transformers';
import { UsageStorageService } from '../../services/usage-storage';
import { UsageRecord } from '../../types/usage';
import { getClientIp } from '../../utils/ip';
import { calculateCosts } from '../../utils/calculate-costs';
import { DebugManager } from '../../services/debug-manager';
import { UnifiedTranscriptionRequest } from '../../types/unified';

export async function registerTranscriptionsRoute(
  fastify: FastifyInstance,
  dispatcher: Dispatcher,
  usageStorage: UsageStorageService
) {
  /**
   * POST /v1/audio/transcriptions
   * OpenAI Compatible Audio Transcriptions Endpoint.
   * Accepts multipart/form-data with audio file and transcription parameters.
   */
  fastify.post('/v1/audio/transcriptions', async (request, reply) => {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    
    let usageRecord: Partial<UsageRecord> = {
      requestId,
      date: new Date().toISOString(),
      sourceIp: getClientIp(request),
      incomingApiType: 'transcriptions',
      startTime,
      isStreamed: false,
      responseStatus: 'pending'
    };

    try {
      // Extract form fields from request.body
      // @fastify/multipart with attachFieldsToBody puts form fields and file in request.body
      const body = request.body as any;
      
      // Get file data from body.file
      const fileData = body.file;
      if (!fileData) {
        return reply.code(400).send({
          error: { message: 'No file uploaded', type: 'invalid_request_error' }
        });
      }
      
      // Validate file size (25MB limit)
      const fileSize = fileData.file?.bytesRead || 0;
      if (fileSize > 25 * 1024 * 1024) {
        return reply.code(400).send({
          error: { message: 'File size exceeds 25MB limit', type: 'invalid_request_error' }
        });
      }
      
      // Validate MIME type
      const validMimeTypes = [
        'audio/flac', 'audio/mpeg', 'audio/mp4', 'audio/mpeg',
        'audio/mpga', 'audio/m4a', 'audio/ogg', 'audio/wav',
        'audio/webm', 'audio/x-wav', 'audio/x-m4a'
      ];
      
      if (fileData.mimetype && !validMimeTypes.includes(fileData.mimetype)) {
        logger.warn(`Unsupported MIME type: ${fileData.mimetype}, proceeding anyway`);
      }
      
      // Read file buffer
      const fileBuffer = await fileData.toBuffer();
      
      // Extract model (required)
      const model = body.model?.value;
      if (!model) {
        return reply.code(400).send({
          error: { message: 'Missing required parameter: model', type: 'invalid_request_error' }
        });
      }
      
      // Extract optional fields
      const language = body.language?.value;
      const prompt = body.prompt?.value;
      const response_format = body.response_format?.value || 'json';
      const temperature = body.temperature?.value ? parseFloat(body.temperature.value) : undefined;
      
      // Validate response_format
      if (!['json', 'text'].includes(response_format)) {
        return reply.code(400).send({
          error: { 
            message: `Unsupported response_format: ${response_format}. Supported formats: json, text`,
            type: 'invalid_request_error'
          }
        });
      }
      
      // Build unified request
      const transformer = new TranscriptionsTransformer();
      const unifiedRequest: UnifiedTranscriptionRequest = {
        file: fileBuffer,
        filename: fileData.filename,
        mimeType: fileData.mimetype,
        model,
        language,
        prompt,
        response_format,
        temperature,
        requestId,
        incomingApiType: 'transcriptions'
      };
      
      usageRecord.incomingModelAlias = model;
      usageRecord.apiKey = (request as any).keyName;
      usageRecord.attribution = (request as any).attribution || null;
      
      DebugManager.getInstance().startLog(requestId, { 
        model, 
        filename: fileData.filename,
        fileSize,
        mimeType: fileData.mimetype,
        language,
        prompt: prompt ? '(provided)' : undefined,
        response_format,
        temperature
      });
      
      // Dispatch
      const unifiedResponse = await dispatcher.dispatchTranscription(unifiedRequest);
      
      // Record usage
      usageRecord.provider = unifiedResponse.plexus?.provider;
      usageRecord.selectedModelName = unifiedResponse.plexus?.model;
      usageRecord.canonicalModelName = unifiedResponse.plexus?.canonicalModel;
      usageRecord.outgoingApiType = unifiedResponse.plexus?.apiType;
      usageRecord.isPassthrough = true; // Transcriptions are pass-through (OpenAI format)
      usageRecord.tokensInput = unifiedResponse.usage?.input_tokens || 0;
      usageRecord.tokensOutput = unifiedResponse.usage?.output_tokens || 0;
      usageRecord.durationMs = Date.now() - startTime;
      usageRecord.responseStatus = 'success';
      
      // Calculate costs
      const pricing = unifiedResponse.plexus?.pricing;
      const providerDiscount = unifiedResponse.plexus?.providerDiscount;
      calculateCosts(usageRecord, pricing, providerDiscount);
      
      await usageStorage.saveRequest(usageRecord as UsageRecord);
      
      const formattedResponse = await transformer.formatResponse(unifiedResponse, response_format);
      
      DebugManager.getInstance().addTransformedResponse(requestId, formattedResponse);
      DebugManager.getInstance().flush(requestId);
      
      // Set appropriate content type
      if (response_format === 'text') {
        reply.type('text/plain');
      } else {
        reply.type('application/json');
      }
      
      return reply.send(formattedResponse);
      
    } catch (e: any) {
      usageRecord.responseStatus = 'error';
      usageRecord.durationMs = Date.now() - startTime;
      usageStorage.saveRequest(usageRecord as UsageRecord);
      
      const errorDetails = {
        apiType: 'transcriptions',
        ...(e.routingContext || {})
      };
      
      usageStorage.saveError(requestId, e, errorDetails);
      logger.error('Error processing transcription request', e);
      
      return reply.code(500).send({ 
        error: { message: e.message, type: 'api_error' } 
      });
    }
  });
}
