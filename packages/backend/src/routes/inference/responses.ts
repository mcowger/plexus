import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { Dispatcher } from '../../services/dispatch/dispatcher';
import { applyRequestedServiceTierFromError } from '../../services/dispatch/service-tier-metadata';
import { DebugManager } from '../../services/observability/debug-manager';
import { UsageStorageService } from '../../services/observability/usage-storage';
import { getReasoningLogValue } from '../../services/pi-ai/reasoning';
import { QuotaEnforcer } from '../../services/quota/quota-enforcer';
import { attachQuotaContext, checkQuotaMiddleware } from '../../services/quota/quota-middleware';
import { handleResponse } from '../../services/responses/response-handler';
import { ResponsesStorageService } from '../../services/responses/responses-storage';
import {
  normalizeCompositeResponsesCallIds,
  normalizeResponsesFunctionCallItemIds,
  normalizeResponsesNullEntries,
  normalizeResponsesReasoningContent,
  ResponsesTransformer,
} from '../../transformers/responses';
import type { UnifiedResponsesResponse } from '../../types/responses';
import { UsageRecord } from '../../types/usage';
import { attachKeyAccessPolicy } from '../../utils/auth';
import { getCacheRoutingHeaders } from '../../utils/cache-routing-headers';
import { CLIENT_REQUEST_ID_HEADER, getClientRequestId } from '../../utils/client-request-id';
import { getClientIp } from '../../utils/ip';
import { logger } from '../../utils/logger';
import { sanitizeHeaders } from '../../utils/sanitize-headers';
import { getGlobalStallConfig, wireStallDetection } from '../../utils/stall';
import { wireEarlyDisconnectDetection, wireUpstreamTimeout } from '../../utils/timeout';
import { saveQuotaBlockedUsage, saveQuotaExceededUsage } from './_quota-error';

const responsesStateRequestSchema = z.looseObject({
  model: z.string(),
  input: z.union([z.string(), z.array(z.unknown())]).nullish(),
  store: z.boolean().optional(),
  previous_response_id: z.string().nullish(),
  conversation: z.union([z.string(), z.looseObject({ id: z.string() })]).nullish(),
  include: z.array(z.string()).optional(),
  tools: z.array(z.unknown()).optional(),
  parallel_tool_calls: z.boolean().optional(),
  prompt_cache_key: z.string().optional(),
});

function isResponsesResponse(value: unknown): value is UnifiedResponsesResponse {
  return (
    value !== null &&
    typeof value === 'object' &&
    'id' in value &&
    typeof value.id === 'string' &&
    'object' in value &&
    value.object === 'response' &&
    'created_at' in value &&
    typeof value.created_at === 'number' &&
    'model' in value &&
    typeof value.model === 'string' &&
    'status' in value &&
    typeof value.status === 'string' &&
    'output' in value &&
    Array.isArray(value.output)
  );
}

export function detectResponsesApiType(
  headers: Record<string, unknown>,
  body: any
): 'responses' | 'responses:lite' {
  const rawHeader = headers['x-openai-internal-codex-responses-lite'];
  const header = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (typeof header === 'string' && header.toLowerCase() === 'true') {
    return 'responses:lite';
  }

  const hasAdditionalTools =
    Array.isArray(body?.input) && body.input.some((item: any) => item?.type === 'additional_tools');
  // A declared `tool_search` tool is Codex CLI's lazy tool-discovery
  // mechanism — the defining feature of "lite" mode (the client hasn't sent
  // its full tool catalog upfront and expects to discover more via a
  // tool_search_call mid-turn). Recognizing it here, not just
  // `additional_tools`/the internal header, lets routing correctly prefer
  // providers that explicitly advertise `responses:lite` support (see
  // router.ts's subtype-first target matching) for a request that's
  // genuinely Codex-native, instead of silently defaulting to the base
  // `responses` type and losing that routing preference.
  const hasToolSearch =
    Array.isArray(body?.tools) && body.tools.some((tool: any) => tool?.type === 'tool_search');
  return hasAdditionalTools || hasToolSearch ? 'responses:lite' : 'responses';
}

export async function registerResponsesRoute(
  fastify: FastifyInstance,
  dispatcher: Dispatcher,
  usageStorage: UsageStorageService,
  quotaEnforcer?: QuotaEnforcer
) {
  const responsesStorage = new ResponsesStorageService();

  /**
   * POST /v1/responses
   * OpenAI Responses API Compatible Endpoint
   * Creates a new response with support for multi-turn conversations, tool use, and reasoning
   *
   * previous_response_id resolves Plexus-owned history. Only explicit store:true
   * retains responses; upstream requests are stateless full-history replays.
   */
  // Handler for Responses API requests (shared between /v1/responses and /v1/codex/responses)
  const responsesHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = crypto.randomUUID();
    const clientRequestId = getClientRequestId(request.headers);
    reply.header('x-request-id', requestId);
    if (clientRequestId) reply.header(CLIENT_REQUEST_ID_HEADER, clientRequestId);
    const startTime = Date.now();
    const incomingApiType = detectResponsesApiType(
      request.headers as Record<string, unknown>,
      request.body
    );
    let usageRecord: Partial<UsageRecord> = {
      requestId,
      clientRequestId,
      date: new Date().toISOString(),
      sourceIp: getClientIp(request),
      incomingApiType,
      startTime,
      isStreamed: false,
      responseStatus: 'pending',
      reasoningEffort: getReasoningLogValue(undefined, request.body) ?? null,
    };

    // Emit 'started' event immediately - this allows frontend to show in-flight requests
    usageStorage.emitStartedAsync(usageRecord);

    let earlyDisconnect: ReturnType<typeof wireEarlyDisconnectDetection> | undefined;
    try {
      const parsedBody = responsesStateRequestSchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply.code(400).send({
          error: { message: parsedBody.error.message, type: 'invalid_request_error' },
        });
      }
      const body = parsedBody.data;
      const shouldStore = body.store === true;
      const previousResponseId = body.previous_response_id;
      if (previousResponseId != null && body.conversation != null) {
        return reply.code(400).send({
          error: {
            message: 'conversation and previous_response_id cannot be used together',
            type: 'invalid_request_error',
          },
        });
      }
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

      logger.silly('Incoming Responses API Request', body);

      const transformer = new ResponsesTransformer();

      // Helper to normalize input into the standardized array format
      function normalizeInput(input: unknown): unknown[] {
        if (input == null) return [];
        return Array.isArray(input)
          ? input
          : [
              {
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text: String(input) }],
              },
            ];
      }

      const currentInput = normalizeInput(body.input);
      body.input = currentInput;

      // Check for previous_response_id and load context
      if (previousResponseId) {
        const previousResponse = await responsesStorage.getResponse(previousResponseId);
        if (!previousResponse?.inputItems) {
          return reply.code(404).send({
            error: {
              message: `Previous response history not found: ${previousResponseId}`,
              type: 'invalid_request_error',
              code: 'response_not_found',
              param: 'previous_response_id',
            },
          });
        }

        body.input = [
          ...JSON.parse(previousResponse.inputItems),
          ...JSON.parse(previousResponse.outputItems),
          ...currentInput,
        ];
      }

      // Check for conversation and load context
      if (body.conversation) {
        const conversationId =
          typeof body.conversation === 'string' ? body.conversation : body.conversation.id;

        const conversation = await responsesStorage.getConversation(conversationId);
        if (!conversation) {
          return reply.code(404).send({
            error: {
              message: `Conversation not found: ${conversationId}`,
              type: 'invalid_request_error',
              code: 'conversation_not_found',
              param: 'conversation',
            },
          });
        }

        // Prepend conversation items to input
        const conversationItems = JSON.parse(conversation.items);
        const currentInput = normalizeInput(body.input);
        body.input = [...conversationItems, ...currentInput];
      }

      // State belongs to Plexus, never to the selected upstream account.
      delete body.previous_response_id;
      body.store = false;
      if (shouldStore) {
        body.include = Array.from(
          new Set([...(body.include ?? []), 'reasoning.encrypted_content'])
        );
      }

      // Keep debug capture faithful to the client payload, then repair the
      // dispatch body so strict Responses providers don't reject composite
      // tool call IDs observed in replayed Codex CLI conversations.
      const rawBodyForDebug = structuredClone(request.body);
      // Start debug capture before parsing so malformed payloads are still traced.
      DebugManager.getInstance().startLog(
        requestId,
        rawBodyForDebug,
        sanitizeHeaders(request.headers as any)
      );
      const removedNullEntries = normalizeResponsesNullEntries(body);
      if (removedNullEntries > 0) {
        logger.warn(
          `Removed ${removedNullEntries} null Responses input/content entr(ies) for request ${requestId}`
        );
      }
      const normalizedCallIds = normalizeCompositeResponsesCallIds(body);
      const normalizedItemIds = normalizeResponsesFunctionCallItemIds(body);
      const normalizedReasoningItems = normalizeResponsesReasoningContent(body);
      if (normalizedCallIds > 0) {
        logger.warn(
          `Normalized ${normalizedCallIds} composite Responses call_id value(s) for request ${requestId}`
        );
      }
      if (normalizedItemIds > 0) {
        logger.warn(
          `Removed call-ID-shaped item id(s) from ${normalizedItemIds} Responses function_call item(s) for request ${requestId}`
        );
      }
      if (normalizedReasoningItems > 0) {
        logger.warn(
          `Removed plaintext content from ${normalizedReasoningItems} Responses reasoning item(s) for request ${requestId}`
        );
      }

      let unifiedRequest = await transformer.parseRequest(body);
      unifiedRequest.incomingApiType = incomingApiType;
      unifiedRequest.originalBody = body;
      unifiedRequest.requestId = requestId;
      usageRecord.reasoningEffort = getReasoningLogValue(unifiedRequest, body) ?? null;
      if (previousResponseId) {
        unifiedRequest.previousResponseId = previousResponseId;
      }

      unifiedRequest.cacheRoutingHeaders = getCacheRoutingHeaders(
        request.headers,
        body.prompt_cache_key
      );
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
      earlyDisconnect = wireEarlyDisconnectDetection(
        request,
        abortController,
        requestId,
        incomingApiType === 'responses:lite'
      );
      const stallDetectionResult = wireStallDetection(abortController, getGlobalStallConfig());
      const unifiedResponse = await dispatcher.dispatch(
        unifiedRequest,
        dispatchSignal,
        resolveTimeoutMs,
        stallDetectionResult.addStallConfig
      );

      // Emit 'updated' event with routing decision details
      usageStorage.emitUpdatedAsync({
        requestId,
        provider: unifiedResponse.plexus?.provider,
        selectedModelName: unifiedResponse.plexus?.model,
        canonicalModelName: unifiedResponse.plexus?.canonicalModel,
        reasoningEffort: usageRecord.reasoningEffort,
        requestedServiceTier: unifiedResponse.plexus?.requestedServiceTier,
        requestedServiceTierRaw: unifiedResponse.plexus?.requestedServiceTierRaw,
        serviceTier: unifiedResponse.plexus?.serviceTier,
        serviceTierRaw: unifiedResponse.plexus?.serviceTierRaw,
      });

      // Determine if token estimation is needed
      const shouldEstimateTokens = unifiedResponse.plexus?.config?.estimateTokens || false;

      // Capture request metadata
      usageRecord.toolsDefined = body.tools?.length ?? 0;
      // Count messages from the parsed request (normalized from input items)
      usageRecord.messageCount = unifiedRequest.messages?.length ?? 0;
      usageRecord.parallelToolCallsEnabled = body.parallel_tool_calls ?? null;

      const storageRequest = {
        ...body,
        store: shouldStore,
        previous_response_id: previousResponseId,
      };
      const responseMetadata = unifiedResponse.plexus;
      let stored = false;
      const onResponse = async (value: unknown, event?: string) => {
        if (!isResponsesResponse(value)) return;
        const response = value;
        response.store = shouldStore;
        response.previous_response_id = previousResponseId ?? undefined;
        if (
          !shouldStore ||
          stored ||
          (event && event !== 'response.completed' && event !== 'response.incomplete') ||
          (response.status !== 'completed' && response.status !== 'incomplete')
        )
          return;
        await responsesStorage.storeResponse(
          { ...response, plexus: responseMetadata },
          storageRequest
        );
        stored = true;
        if (body.conversation) {
          const conversationId =
            typeof body.conversation === 'string' ? body.conversation : body.conversation.id;
          await responsesStorage.updateConversation(conversationId, response.output, currentInput);
        }
      };
      const result = await handleResponse(
        request,
        reply,
        unifiedResponse,
        transformer,
        usageRecord,
        usageStorage,
        startTime,
        'responses',
        shouldEstimateTokens,
        storageRequest,
        quotaEnforcer,
        (request as any).keyName,
        abortController,
        stallDetectionResult,
        onResponse
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
        applyRequestedServiceTierFromError(usageRecord, e);
        usageStorage.saveRequest(usageRecord as UsageRecord);
        logger.info(
          `Request ${requestId}: ${e.message}, usage recorded as ${e?.routingContext?.code === 'upstream_timeout' ? 'timeout' : 'cancelled'}`
        );
        return;
      }
      if (e?.routingContext?.code === 'quota_exceeded') {
        saveQuotaExceededUsage(e, 'responses', usageRecord, usageStorage, requestId, startTime);
        return reply.code(429).send(e.routingContext.body);
      }
      usageRecord.responseStatus =
        e?.routingContext?.code === 'upstream_timeout' ? 'timeout' : 'error';
      usageRecord.durationMs = Date.now() - startTime;
      usageRecord.attemptCount = e.routingContext?.attemptCount || usageRecord.attemptCount || 1;
      usageRecord.retryHistory = e.routingContext?.retryHistory || usageRecord.retryHistory || null;
      applyRequestedServiceTierFromError(usageRecord, e);
      usageStorage.saveRequest(usageRecord as UsageRecord);

      const errorDetails = {
        apiType: incomingApiType,
        ...(e.routingContext || {}),
      };

      usageStorage.saveError(requestId, e, errorDetails);

      DebugManager.getInstance().flush(requestId);

      logger.error('Error processing Responses API request', e);

      const statusCode = e.routingContext?.statusCode || 500;
      const errorCode = e.routingContext?.code;
      return reply.code(statusCode).send({
        error: {
          message: e.message || 'Internal server error',
          type: statusCode >= 500 ? 'server_error' : 'invalid_request_error',
          ...(errorCode && { code: errorCode }),
          ...(e.routingContext && {
            routing_context: {
              provider: e.routingContext.provider,
              target_model: e.routingContext.targetModel,
              target_api_type: e.routingContext.targetApiType,
            },
          }),
        },
      });
    }
  };

  fastify.post('/v1/responses', responsesHandler);
  // Codex CLI sends requests to /v1/codex/responses — alias to the same handler
  fastify.post('/v1/codex/responses', responsesHandler);

  /**
   * GET /v1/responses/:response_id
   * Retrieves a stored response
   */
  fastify.get(
    '/v1/responses/:response_id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { response_id } = request.params as { response_id: string };

      try {
        const response = await responsesStorage.getResponse(response_id);

        if (!response) {
          return reply.code(404).send({
            error: {
              message: `Response not found: ${response_id}`,
              type: 'invalid_request_error',
              code: 'response_not_found',
            },
          });
        }

        return reply.send(responsesStorage.formatStoredResponse(response));
      } catch (error: any) {
        logger.error(`Error retrieving response ${response_id}:`, error);
        return reply.code(500).send({
          error: {
            message: 'Internal server error',
            type: 'server_error',
          },
        });
      }
    }
  );

  /**
   * DELETE /v1/responses/:response_id
   * Deletes a stored response
   */
  fastify.delete(
    '/v1/responses/:response_id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { response_id } = request.params as { response_id: string };

      try {
        const deleted = await responsesStorage.deleteResponse(response_id);

        if (!deleted) {
          return reply.code(404).send({
            error: {
              message: `Response not found: ${response_id}`,
              type: 'invalid_request_error',
              code: 'response_not_found',
            },
          });
        }

        return reply.send({ deleted: true, id: response_id });
      } catch (error: any) {
        logger.error(`Error deleting response ${response_id}:`, error);
        return reply.code(500).send({
          error: {
            message: 'Internal server error',
            type: 'server_error',
          },
        });
      }
    }
  );

  /**
   * GET /v1/conversations/:conversation_id
   * Retrieves a conversation
   */
  fastify.get(
    '/v1/conversations/:conversation_id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { conversation_id } = request.params as { conversation_id: string };

      try {
        const conversation = await responsesStorage.getConversation(conversation_id);

        if (!conversation) {
          return reply.code(404).send({
            error: {
              message: `Conversation not found: ${conversation_id}`,
              type: 'invalid_request_error',
              code: 'conversation_not_found',
            },
          });
        }

        return reply.send(responsesStorage.formatStoredConversation(conversation));
      } catch (error: any) {
        logger.error(`Error retrieving conversation ${conversation_id}:`, error);
        return reply.code(500).send({
          error: {
            message: 'Internal server error',
            type: 'server_error',
          },
        });
      }
    }
  );
}
