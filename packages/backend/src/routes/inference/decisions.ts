import { wireUpstreamTimeout, wireEarlyDisconnectDetection } from '../../utils/timeout';
import { FastifyInstance } from 'fastify';
import { logger } from '../../utils/logger';
import { Dispatcher } from '../../services/dispatch/dispatcher';
import { DecisionsIngressSchema } from '../../types/decisions';
import type { UnifiedDecisionsRequest } from '../../types/unified';
import { UsageStorageService } from '../../services/observability/usage-storage';
import { UsageRecord } from '../../types/usage';
import { getClientIp } from '../../utils/ip';
import { calculateCosts } from '../../utils/calculate-costs';
import { DebugManager } from '../../services/observability/debug-manager';
import { attachKeyAccessPolicy } from '../../utils/auth';
import { QuotaEnforcer } from '../../services/quota/quota-enforcer';
import {
  checkQuotaMiddleware,
  attachQuotaContext,
  buildQuotaHeaders,
  recordQuotaUsage,
} from '../../services/quota/quota-middleware';
import { saveQuotaBlockedUsage, saveQuotaExceededUsage } from './_quota-error';
import { sanitizeHeaders } from '../../utils/sanitize-headers';
import { CLIENT_REQUEST_ID_HEADER, getClientRequestId } from '../../utils/client-request-id';

export async function registerDecisionsRoute(
  fastify: FastifyInstance,
  dispatcher: Dispatcher,
  usageStorage: UsageStorageService,
  quotaEnforcer?: QuotaEnforcer
) {
  /**
   * POST /v1/decisions
   * Buffered Jev-style Decisions endpoint (questions and answers).
   * Accepts `{model, state, questions}` on the System One protocol.
   */
  fastify.post('/v1/decisions', async (request: any, reply: any) => {
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
      incomingApiType: 'decisions',
      startTime,
      isStreamed: false,
      responseStatus: 'pending',
    };

    // Emit 'started' event immediately - this allows frontend to show in-flight requests
    usageStorage.emitStartedAsync(usageRecord);

    try {
      const body = (request.body ?? {}) as any;
      const parsed = DecisionsIngressSchema.safeParse(body);
      if (!parsed.success) {
        const message = parsed.error.issues[0]?.message ?? 'Invalid decisions request';
        const error = new Error(message) as any;
        error.routingContext = { statusCode: 400, code: 'invalid_request_error' };
        throw error;
      }

      usageRecord.incomingModelAlias = parsed.data.model;
      usageRecord.apiKey = (request as any).keyName;
      usageRecord.attribution = (request as any).attribution || null;

      // Emit 'updated' event with parsed request details
      usageStorage.emitUpdatedAsync({
        requestId,
        incomingModelAlias: parsed.data.model,
        apiKey: (request as any).keyName,
        attribution: (request as any).attribution || null,
      });

      logger.silly('Incoming Decisions Request', body);

      let unifiedRequest: UnifiedDecisionsRequest = {
        model: parsed.data.model,
        state: parsed.data.state,
        questions: parsed.data.questions,
        requestId,
        incomingApiType: 'decisions',
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

      // Check quota before processing
      if (quotaEnforcer) {
        const quotaCheck = await checkQuotaMiddleware(request, reply, quotaEnforcer);
        if (!quotaCheck.ok) {
          saveQuotaBlockedUsage(usageRecord, usageStorage, requestId, startTime);
          return;
        }
        unifiedRequest = attachQuotaContext(unifiedRequest, quotaCheck.context);
      }

      const unifiedResponse = await dispatcher.dispatchDecisions(
        unifiedRequest,
        signal,
        resolveTimeoutMs
      );

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
      usageRecord.outgoingApiType =
        unifiedResponse.plexus?.targetApiType ?? unifiedResponse.plexus?.apiType ?? null;
      usageRecord.isPassthrough = false;
      usageRecord.tokensInput = unifiedResponse.usage?.input_tokens ?? null;
      usageRecord.tokensOutput = unifiedResponse.usage?.output_tokens ?? null;
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

      // Quota headers (x-plexus-quota*) — computed from the context
      // checkQuotaMiddleware stashed on the raw request and the FINAL
      // attempt's resolved provider/model, mirroring response-handler.ts.
      const quotaContext = (request as any).quotaContext ?? null;
      if (quotaContext) {
        const quotaHeaders = buildQuotaHeaders(
          quotaContext,
          unifiedResponse.plexus?.provider || '',
          unifiedResponse.plexus?.model || ''
        );
        for (const [headerName, headerValue] of Object.entries(quotaHeaders)) {
          reply.header(headerName, headerValue);
        }
      }

      // Record quota usage against the final attempt's resolved provider/model.
      if (quotaEnforcer) {
        await recordQuotaUsage(
          (request as any).keyName,
          unifiedResponse.plexus?.provider,
          unifiedResponse.plexus?.model,
          {
            tokensInput: usageRecord.tokensInput,
            tokensOutput: usageRecord.tokensOutput,
            costTotal: usageRecord.costTotal,
          },
          quotaEnforcer
        );
      }

      DebugManager.getInstance().addTransformedResponse(requestId, {
        model: unifiedResponse.model,
        answerCount: Object.keys(unifiedResponse.answers ?? {}).length,
      });
      DebugManager.getInstance().flush(requestId);

      // The client shape mirrors the upstream response (model/answers/usage
      // plus optional id/provider extras). Internal plexus metadata never
      // leaves the gateway.
      const clientResponse: Record<string, any> = {
        model: unifiedResponse.model,
        answers: unifiedResponse.answers,
        usage: unifiedResponse.usage,
      };
      if (unifiedResponse.id !== undefined) clientResponse.id = unifiedResponse.id;
      if (unifiedResponse.provider !== undefined)
        clientResponse.provider = unifiedResponse.provider;

      return reply.send(clientResponse);
    } catch (e: any) {
      if (e?.routingContext?.code === 'quota_exceeded') {
        saveQuotaExceededUsage(e, 'decisions', usageRecord, usageStorage, requestId, startTime);
        return reply.code(429).send(e.routingContext.body);
      }
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
        apiType: 'decisions',
        ...(e.routingContext || {}),
      };

      usageStorage.saveError(requestId, e, errorDetails);
      DebugManager.getInstance().flush(requestId);
      logger.error('Error processing decisions request', e);

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
