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
import { attachKeyAccessPolicy } from '../../utils/auth';

export async function registerMessagesRoute(
  fastify: FastifyInstance,
  dispatcher: Dispatcher,
  usageStorage: UsageStorageService,
  quotaEnforcer?: QuotaEnforcer
) {
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
      responseStatus: 'pending',
    };

    // Emit 'started' event immediately - this allows frontend to show in-flight requests
    usageStorage.emitStartedAsync(usageRecord);

    try {
      const body = request.body as any;
      usageRecord.incomingModelAlias = body.model;
      // Use the key name identified by the auth middleware, not the raw secret
      usageRecord.apiKey = (request as any).keyName;
      // Capture attribution if provided in the API key
      usageRecord.attribution = (request as any).attribution || null;

      // Emit 'updated' event with parsed request details
      usageStorage.emitUpdatedAsync({
        requestId,
        incomingModelAlias: body.model,
        apiKey: (request as any).keyName,
        attribution: (request as any).attribution || null,
      });

      logger.silly('Incoming Anthropic Request', body);
      const transformer = new AnthropicTransformer();
      let unifiedRequest = await transformer.parseRequest(body);
      unifiedRequest.incomingApiType = 'messages';
      unifiedRequest.originalBody = body;
      unifiedRequest.requestId = requestId;
      unifiedRequest = attachKeyAccessPolicy(request, unifiedRequest);
      const xAppHeader = Array.isArray(request.headers['x-app'])
        ? request.headers['x-app'][0]
        : request.headers['x-app'];
      if (typeof xAppHeader === 'string' && xAppHeader.trim()) {
        unifiedRequest.metadata = {
          ...(unifiedRequest.metadata || {}),
          plexus_metadata: {
            ...((unifiedRequest.metadata as any)?.plexus_metadata || {}),
            clientHeaders: {
              'x-app': xAppHeader,
            },
          },
        };
      }

      DebugManager.getInstance().startLog(requestId, body);

      // Check quota before processing
      if (quotaEnforcer) {
        const allowed = await checkQuotaMiddleware(request, reply, quotaEnforcer);
        if (!allowed) return;
      }

      const unifiedResponse = await dispatcher.dispatch(unifiedRequest);

      // Emit 'updated' event with routing decision details
      usageStorage.emitUpdatedAsync({
        requestId,
        provider: unifiedResponse.plexus?.provider,
        selectedModelName: unifiedResponse.plexus?.model,
        canonicalModelName: unifiedResponse.plexus?.canonicalModel,
      });

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
      usageRecord.attemptCount = e.routingContext?.attemptCount || usageRecord.attemptCount || 1;
      usageRecord.retryHistory = e.routingContext?.retryHistory || usageRecord.retryHistory || null;
      usageStorage.saveRequest(usageRecord as UsageRecord);

      // Extract routing context if available from enriched error
      const errorDetails = {
        apiType: 'messages',
        ...(e.routingContext || {}),
      };

      usageStorage.saveError(requestId, e, errorDetails);

      DebugManager.getInstance().flush(requestId);

      logger.error('Error processing Anthropic request', e);
      const statusCode = e.routingContext?.statusCode || 500;
      const errorType =
        statusCode === 401
          ? 'authentication_error'
          : statusCode === 400
            ? 'invalid_request_error'
            : 'api_error';
      const errorCode = e.routingContext?.code;
      return reply.code(statusCode).send({
        type: 'error',
        error: {
          type: errorType,
          message: e.message,
          ...(errorCode && { code: errorCode }),
        },
      });
    }
  });
}
