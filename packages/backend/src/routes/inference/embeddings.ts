import { FastifyInstance } from 'fastify';
import { logger } from '../../utils/logger';
import { Dispatcher } from '../../services/dispatcher';
import { EmbeddingsTransformer } from '../../transformers';
import { UsageStorageService } from '../../services/usage-storage';
import { UsageRecord } from '../../types/usage';
import { getClientIp } from '../../utils/ip';
import { calculateCosts } from '../../utils/calculate-costs';
import { DebugManager } from '../../services/debug-manager';

export async function registerEmbeddingsRoute(
  fastify: FastifyInstance,
  dispatcher: Dispatcher,
  usageStorage: UsageStorageService
) {
  /**
   * POST /v1/embeddings
   * OpenAI Compatible Embeddings Endpoint.
   * Supports any provider that implements the OpenAI embeddings API format.
   */
  fastify.post('/v1/embeddings', async (request, reply) => {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    
    let usageRecord: Partial<UsageRecord> = {
      requestId,
      date: new Date().toISOString(),
      sourceIp: getClientIp(request),
      incomingApiType: 'embeddings',
      startTime,
      isStreamed: false,
      responseStatus: 'pending'
    };

    try {
      const body = request.body as any;
      usageRecord.incomingModelAlias = body.model;
      usageRecord.apiKey = (request as any).keyName;
      usageRecord.attribution = (request as any).attribution || null;

      logger.silly('Incoming Embeddings Request', body);
      
      const transformer = new EmbeddingsTransformer();
      const unifiedRequest = await transformer.parseRequest(body);
      unifiedRequest.incomingApiType = 'embeddings';
      unifiedRequest.originalBody = body;
      unifiedRequest.requestId = requestId;

      DebugManager.getInstance().startLog(requestId, body);

      const unifiedResponse = await dispatcher.dispatchEmbeddings(unifiedRequest);

      // Record usage
      usageRecord.provider = unifiedResponse.plexus?.provider;
      usageRecord.selectedModelName = unifiedResponse.plexus?.model;
      usageRecord.canonicalModelName = unifiedResponse.plexus?.canonicalModel;
      usageRecord.outgoingApiType = unifiedResponse.plexus?.apiType;
      usageRecord.isPassthrough = true; // Embeddings are always pass-through (OpenAI format)
      usageRecord.tokensInput = unifiedResponse.usage.prompt_tokens;
      usageRecord.tokensOutput = 0; // Embeddings don't have output tokens
      usageRecord.durationMs = Date.now() - startTime;
      usageRecord.responseStatus = 'success';

      // Calculate cost using existing utility
      const pricing = unifiedResponse.plexus?.pricing;
      const providerDiscount = unifiedResponse.plexus?.providerDiscount;
      calculateCosts(usageRecord, pricing, providerDiscount);

      await usageStorage.saveRequest(usageRecord as UsageRecord);

      const formattedResponse = await transformer.formatResponse(unifiedResponse);
      
      DebugManager.getInstance().addTransformedResponse(requestId, formattedResponse);
      DebugManager.getInstance().flush(requestId);
      
      return reply.send(formattedResponse);

    } catch (e: any) {
      usageRecord.responseStatus = 'error';
      usageRecord.durationMs = Date.now() - startTime;
      usageStorage.saveRequest(usageRecord as UsageRecord);

      const errorDetails = {
        apiType: 'embeddings',
        ...(e.routingContext || {})
      };

      usageStorage.saveError(requestId, e, errorDetails);
      logger.error('Error processing embeddings request', e);
      
      return reply.code(500).send({ 
        error: { message: e.message, type: 'api_error' } 
      });
    }
  });
}
