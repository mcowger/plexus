import { FastifyInstance } from 'fastify';
import { logger } from '../../utils/logger';
import { Dispatcher } from '../../services/dispatcher';
import { GeminiTransformer } from '../../transformers';
import { UsageStorageService } from '../../services/usage-storage';
import { UsageRecord } from '../../types/usage';
import { handleResponse } from '../../services/response-handler';
import { getClientIp } from '../../utils/ip';
import { DebugManager } from '../../services/debug-manager';

export async function registerGeminiRoute(fastify: FastifyInstance, dispatcher: Dispatcher, usageStorage: UsageStorageService) {
    /**
     * POST /v1beta/models/:modelWithAction
     * Gemini Compatible Endpoint.
     * Supports both unary and streamGenerateContent actions.
     */
    fastify.post('/v1beta/models/:modelWithAction', async (request, reply) => {
        const requestId = crypto.randomUUID();
        const startTime = Date.now();
        let usageRecord: Partial<UsageRecord> = {
            requestId,
            date: new Date().toISOString(),
            sourceIp: getClientIp(request),
            incomingApiType: 'gemini',
            startTime,
            isStreamed: false,
            responseStatus: 'pending'
        };

        try {
            const body = request.body as any;
            const params = request.params as any;
            const modelWithAction = params.modelWithAction;
            const modelName = modelWithAction.split(':')[0];
            usageRecord.incomingModelAlias = modelName;
            
            const query = request.query as any;
            // Use the key name identified by the auth middleware, not the raw secret
            usageRecord.apiKey = (request as any).keyName;
            // Capture attribution if provided in the API key
            usageRecord.attribution = (request as any).attribution || null;

            logger.silly('Incoming Gemini Request', body);
            const transformer = new GeminiTransformer();
            const unifiedRequest = await transformer.parseRequest({ ...body, model: modelName });
            unifiedRequest.incomingApiType = 'gemini';
            unifiedRequest.originalBody = body;
            unifiedRequest.requestId = requestId;

            DebugManager.getInstance().startLog(requestId, body);
            
            if (modelWithAction.includes('streamGenerateContent')) {
                unifiedRequest.stream = true;
            }

            const unifiedResponse = await dispatcher.dispatch(unifiedRequest);
            
            return await handleResponse(
                request,
                reply,
                unifiedResponse,
                transformer,
                usageRecord,
                usageStorage,
                startTime,
                'gemini'
            );
        } catch (e: any) {
            usageRecord.responseStatus = 'error';
            usageRecord.durationMs = Date.now() - startTime;
            usageStorage.saveRequest(usageRecord as UsageRecord);

            // Extract routing context if available from enriched error
            const errorDetails = {
                apiType: 'gemini',
                ...(e.routingContext || {})
            };

            usageStorage.saveError(requestId, e, errorDetails);

            logger.error('Error processing Gemini request', e);
            return reply.code(500).send({ error: { message: e.message, code: 500, status: "INTERNAL" } });
        }
    });
}
