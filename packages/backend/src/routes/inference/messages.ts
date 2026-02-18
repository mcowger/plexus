import { FastifyInstance } from 'fastify';
import { logger } from '../../utils/logger';
import { Dispatcher } from '../../services/dispatcher';
import { AnthropicTransformer } from '../../transformers';
import { UsageStorageService } from '../../services/usage-storage';
import { UsageRecord } from '../../types/usage';
import { handleResponse } from '../../services/response-handler';
import { getClientIp } from '../../utils/ip';
import { DebugManager } from '../../services/debug-manager';
import { QuotaEnforcer } from '../../services/quota/quota-enforcer';
import { checkQuotaMiddleware, recordQuotaUsage } from '../../services/quota/quota-middleware';

export async function registerMessagesRoute(fastify: FastifyInstance, dispatcher: Dispatcher, usageStorage: UsageStorageService, quotaEnforcer?: QuotaEnforcer) {
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
            const xAppHeader = Array.isArray(request.headers['x-app'])
                ? request.headers['x-app'][0]
                : request.headers['x-app'];
            if (typeof xAppHeader === 'string' && xAppHeader.trim()) {
                unifiedRequest.metadata = {
                    ...(unifiedRequest.metadata || {}),
                    clientHeaders: {
                        'x-app': xAppHeader
                    }
                };
            }

            DebugManager.getInstance().startLog(requestId, body);

            // Check quota before processing
            if (quotaEnforcer) {
                const allowed = await checkQuotaMiddleware(request, reply, quotaEnforcer);
                if (!allowed) return;
            }

            const unifiedResponse = await dispatcher.dispatch(unifiedRequest);

            // Determine if token estimation is needed
            const shouldEstimateTokens = unifiedResponse.plexus?.config?.estimateTokens || false;

            // Capture request metadata
            usageRecord.toolsDefined = unifiedRequest.tools?.length ?? 0;
            usageRecord.messageCount = unifiedRequest.messages?.length ?? 0;
            // Anthropic doesn't have a direct parallel tool calls setting like OpenAI, but can check for multi-tool preference
            usageRecord.parallelToolCallsEnabled = null;

            const result = await handleResponse(
                request,
                reply,
                unifiedResponse,
                transformer,
                usageRecord,
                usageStorage,
                startTime,
                'messages',
                shouldEstimateTokens,
                body
            );

            // Record quota usage after request completes
            if (quotaEnforcer) {
                await recordQuotaUsage((request as any).keyName, usageRecord, quotaEnforcer);
            }

            return result;
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
            const statusCode = e.routingContext?.statusCode || 500;
            const errorType = statusCode === 401 ? 'authentication_error' : 'api_error';
            return reply.code(statusCode).send({ type: 'error', error: { type: errorType, message: e.message } });
        }
    });
}
