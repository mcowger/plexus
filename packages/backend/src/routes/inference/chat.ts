import { FastifyInstance } from 'fastify';
import { logger } from '../../utils/logger';
import { Dispatcher } from '../../services/dispatcher';
import { OpenAITransformer } from '../../transformers';
import { UsageStorageService } from '../../services/usage-storage';
import { UsageRecord } from '../../types/usage';
import { handleResponse } from '../../services/response-handler';
import { getClientIp } from '../../utils/ip';
import { DebugManager } from '../../services/debug-manager';
import { QuotaEnforcer } from '../../services/quota/quota-enforcer';
import { checkQuotaMiddleware, attachQuotaContext } from '../../services/quota/quota-middleware';
import { saveQuotaBlockedUsage, saveQuotaExceededUsage } from './_quota-error';
import { attachKeyAccessPolicy } from '../../utils/auth';
import { wireUpstreamTimeout, wireEarlyDisconnectDetection } from '../../utils/timeout';
import { wireStallDetection, getGlobalStallConfig } from '../../utils/stall';
import { sanitizeHeaders } from '../../utils/sanitize-headers';

export async function registerChatRoute(
  fastify: FastifyInstance,
  dispatcher: Dispatcher,
  usageStorage: UsageStorageService,
  quotaEnforcer?: QuotaEnforcer
) {
  /**
   * POST /v1/chat/completions
   * OpenAI Compatible Endpoint.
   * Translates OpenAI format to internal Unified format, dispatches to target,
   * and translates the response back to OpenAI format.
   */
  fastify.post('/v1/chat/completions', async (request, reply) => {
    const requestId = crypto.randomUUID();
    reply.header('x-request-id', requestId);
    const startTime = Date.now();
    let usageRecord: Partial<UsageRecord> = {
      requestId,
      date: new Date().toISOString(),
      sourceIp: getClientIp(request),
      incomingApiType: 'chat',
      startTime,
      isStreamed: false,
      responseStatus: 'pending',
    };

    // Emit 'started' event immediately - this allows frontend to show in-flight requests
    usageStorage.emitStartedAsync(usageRecord);

    let earlyDisconnect: ReturnType<typeof wireEarlyDisconnectDetection> | undefined;
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

      logger.silly('Incoming OpenAI Request', body);
      const transformer = new OpenAITransformer();
      let unifiedRequest = await transformer.parseRequest(body);
      unifiedRequest.incomingApiType = 'chat';
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

      DebugManager.getInstance().startLog(requestId, body, sanitizeHeaders(request.headers as any));

      // Check quota before processing
      if (quotaEnforcer) {
        const quotaCheck = await checkQuotaMiddleware(request, reply, quotaEnforcer);
        if (!quotaCheck.ok) {
          saveQuotaBlockedUsage(usageRecord, usageStorage, requestId, startTime);
          return;
        }
        unifiedRequest = attachQuotaContext(unifiedRequest, quotaCheck.context);
      }

      const abortController = new AbortController();
      const { signal: dispatchSignal, resolveTimeoutMs } = wireUpstreamTimeout(abortController);
      earlyDisconnect = wireEarlyDisconnectDetection(request, abortController);
      const stallDetectionResult = wireStallDetection(abortController, getGlobalStallConfig());
      const unifiedResponse = await dispatcher.dispatch(
        unifiedRequest,
        dispatchSignal,
        resolveTimeoutMs,
        stallDetectionResult?.addStallConfig
      );

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
      usageRecord.parallelToolCallsEnabled = body.parallel_tool_calls ?? null;

      const result = await handleResponse(
        request,
        reply,
        unifiedResponse,
        transformer,
        usageRecord,
        usageStorage,
        startTime,
        'chat',
        shouldEstimateTokens,
        body,
        quotaEnforcer,
        (request as any).keyName,
        abortController,
        stallDetectionResult
      );

      earlyDisconnect?.cleanup();
      return result;
    } catch (e: any) {
      earlyDisconnect?.cleanup();
      if (e?.routingContext?.code === 'client_disconnected') {
        usageRecord.responseStatus = 'cancelled';
        usageRecord.durationMs = Date.now() - startTime;
        usageRecord.attemptCount = e.routingContext?.attemptCount || usageRecord.attemptCount || 1;
        usageRecord.retryHistory =
          e.routingContext?.retryHistory || usageRecord.retryHistory || null;
        usageStorage.saveRequest(usageRecord as UsageRecord);
        logger.info(
          `Request ${requestId}: ${e.message}, usage recorded as ${e?.routingContext?.code === 'upstream_timeout' ? 'timeout' : 'cancelled'}`
        );
        return;
      }
      if (e?.routingContext?.code === 'quota_exceeded') {
        saveQuotaExceededUsage(e, 'chat', usageRecord, usageStorage, requestId, startTime);
        return reply.code(429).send(e.routingContext.body);
      }
      usageRecord.responseStatus =
        e?.routingContext?.code === 'upstream_timeout' ? 'timeout' : 'error';
      usageRecord.durationMs = Date.now() - startTime;
      usageRecord.attemptCount = e.routingContext?.attemptCount || usageRecord.attemptCount || 1;
      usageRecord.retryHistory = e.routingContext?.retryHistory || usageRecord.retryHistory || null;
      usageStorage.saveRequest(usageRecord as UsageRecord);

      // Extract routing context if available from enriched error
      const errorDetails = {
        apiType: 'chat',
        ...(e.routingContext || {}),
      };

      usageStorage.saveError(requestId, e, errorDetails);

      DebugManager.getInstance().flush(requestId);

      logger.error('Error processing OpenAI request', e);
      const statusCode = e.routingContext?.statusCode || 500;
      const errorType =
        statusCode === 401
          ? 'authentication_error'
          : statusCode === 400
            ? 'invalid_request_error'
            : 'api_error';
      const errorCode = e.routingContext?.code;
      return reply.code(statusCode).send({
        error: {
          message: e.message,
          type: errorType,
          ...(errorCode && { code: errorCode }),
        },
      });
    }
  });
}
