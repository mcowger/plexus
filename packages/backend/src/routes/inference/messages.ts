import { FastifyInstance } from 'fastify';
import { logger } from '../../utils/logger';
import { Dispatcher } from '../../services/dispatcher';
import { AnthropicTransformer } from '../../transformers';
import { UsageStorageService } from '../../services/usage-storage';
import { UsageRecord } from '../../types/usage';
import { handleResponse } from '../../services/response-handler';
import { getClientIp } from '../../utils/ip';
import { DebugManager } from '../../services/debug-manager';

export async function registerMessagesRoute(fastify: FastifyInstance, dispatcher: Dispatcher, usageStorage: UsageStorageService) {
    /**
     * POST /v1/messages
     * Anthropic Compatible Endpoint.
     */
    fastify.post('/v1/messages', async (request, reply) => {
        const requestId = crypto.randomUUID();
        const startTime = Date.now();
        let usageRecord: Partial<UsageRecord> = {
            requestId,
            date: new Date().toISOString(),
            sourceIp: getClientIp(request),
            incomingApiType: 'messages',
            startTime,
            isStreamed: false,
            responseStatus: 'pending'
        };

        try {
            const body = request.body as any;
            usageRecord.incomingModelAlias = body.model;
            // Use the key name identified by the auth middleware, not the raw secret
            usageRecord.apiKey = (request as any).keyName;
            // Capture attribution if provided in the API key
            usageRecord.attribution = (request as any).attribution || null;

            logger.silly('Incoming Anthropic Request', body);
            const transformer = new AnthropicTransformer();
            const unifiedRequest = await transformer.parseRequest(body);
            unifiedRequest.incomingApiType = 'messages';
            unifiedRequest.originalBody = body;
            unifiedRequest.requestId = requestId;

            DebugManager.getInstance().startLog(requestId, body);
            
            const unifiedResponse = await dispatcher.dispatch(unifiedRequest);
            
            return await handleResponse(
                request,
                reply,
                unifiedResponse,
                transformer,
                usageRecord,
                usageStorage,
                startTime,
                'messages'
            );
        } catch (e: any) {
            usageRecord.responseStatus = 'error';
            usageRecord.durationMs = Date.now() - startTime;
            usageStorage.saveRequest(usageRecord as UsageRecord);

            // Extract routing context if available from enriched error
            const errorDetails = {
                apiType: 'messages',
                ...(e.routingContext || {})
            };

            usageStorage.saveError(requestId, e, errorDetails);

            logger.error('Error processing Anthropic request', e);
            return reply.code(500).send({ type: 'error', error: { type: 'api_error', message: e.message } });
        }
    });
}
