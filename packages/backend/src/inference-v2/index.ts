/**
 * inference-v2 route registration — the pi-ai native inference path.
 *
 * Exports `registerInferenceV2Routes(fastify, usageStorage, quotaEnforcer?)`.
 *
 * Routes:
 *   POST /beta/v1/chat/completions              — Stage 1 (OpenAI chat-completions via pi-ai)
 *   POST /beta/v1/messages                      — Stage 2 (Anthropic messages via pi-ai)
 *   POST /beta/v1/responses                     — Stage 3 (OpenAI Responses API via pi-ai)
 *   POST /beta/v1beta/models/:model:generateContent  — Stage 4 (Gemini via pi-ai, non-streaming)
 *   POST /beta/v1beta/models/:model:streamGenerateContent — Stage 4 (Gemini via pi-ai, streaming)
 *
 * Each handler:
 *  1. Sets x-request-id.
 *  2. debug.startLog().
 *  3. Quota check.
 *  4. wireUpstreamTimeout + wireEarlyDisconnectDetection.
 *  5. Parses body via the stage-specific parser.
 *  6. Calls runPiAiExecutor() with serializeMessage / serializeChunks callbacks.
 *  7. Writes JSON or pumps SSE/NDJSON stream.
 *  8. Error shape is protocol-specific:
 *       Stage 1 → OpenAI     { error: { message, type } }
 *       Stage 2 → Anthropic  { type:"error", error:{ type, message } }
 *       Stage 3 → Responses  { error: { message, type, code } }
 *       Stage 4 → Gemini     { error: { code, message, status } }
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { DebugManager } from '../services/debug-manager';
import type { UsageStorageService } from '../services/usage-storage';
import type { QuotaEnforcer } from '../services/quota/quota-enforcer';
import { checkQuotaMiddleware } from '../services/quota/quota-middleware';
import { wireUpstreamTimeout, wireEarlyDisconnectDetection } from '../utils/timeout';
import { getClientIp } from '../utils/ip';
import { sanitizeHeaders } from '../utils/sanitize-headers';
import { logger } from '../utils/logger';
import { openaiRequestToContext } from './openai/openai-to-context';
import {
  messageToCompletion,
  eventToChunks,
  chunkToSSE,
  makeChunkSerialiserState,
  SSE_DONE,
} from './openai/context-to-openai';
import { anthropicRequestToContext } from './anthropic/anthropic-to-context';
import {
  messageToAnthropicResponse,
  eventToAnthropicSSE,
  makeAnthropicChunkSerialiserState,
} from './anthropic/context-to-anthropic';
import { responsesToContext, normalizeResponsesInput } from './responses/responses-to-context';
import {
  messageToResponsesObject,
  eventToResponsesSSE,
  makeResponsesChunkSerialiserState,
} from './responses/context-to-responses';
import { ResponsesStorageService } from '../services/responses-storage';
import { geminiRequestToContext } from './gemini/gemini-to-context';
import {
  messageToGeminiResponse,
  eventToGeminiNDJSON,
  makeGeminiChunkSerialiserState,
} from './gemini/context-to-gemini';
import { runPiAiExecutor } from './shared/pi-ai-executor';
import { installFetchTap } from './shared/fetch-tap';

// Install the global fetch tap once when this module loads
installFetchTap();

export interface BetaInferenceDeps {
  usageStorage: UsageStorageService;
  quotaEnforcer?: QuotaEnforcer;
  responsesStorage?: ResponsesStorageService;
}

function saveBetaErrorUsage(
  usageStorage: UsageStorageService,
  request: FastifyRequest,
  requestId: string,
  startTime: number,
  incomingApiType: string,
  modelAlias: string,
  error: any,
  streaming = false
) {
  usageStorage.saveRequest({
    requestId,
    date: new Date().toISOString(),
    sourceIp: (request as any).ip ?? null,
    apiKey: (request as any).keyName ?? null,
    attribution: (request as any).attribution ?? null,
    incomingApiType,
    provider: null,
    attemptCount: error?.routingContext?.attemptCount ?? 1,
    retryHistory: error?.routingContext?.retryHistory ?? null,
    incomingModelAlias: modelAlias,
    canonicalModelName: null,
    selectedModelName: null,
    finalAttemptProvider: null,
    finalAttemptModel: null,
    allAttemptedProviders: null,
    outgoingApiType: null,
    tokensInput: null,
    tokensOutput: null,
    tokensReasoning: null,
    tokensCached: null,
    tokensCacheWrite: null,
    costInput: null,
    costOutput: null,
    costCached: null,
    costCacheWrite: null,
    costTotal: null,
    costSource: null,
    costMetadata: null,
    startTime,
    durationMs: Date.now() - startTime,
    isStreamed: streaming,
    responseStatus: error?.routingContext?.code === 'client_disconnected' ? 'cancelled' : 'error',
  } as any);
}

/**
 * OpenAI chat-completions via the pi-ai native execution path.
 * Fails closed with HTTP 400 when no registry-valid beta-compatible
 * candidate remains — never falls back to the Transformer path.
 */
export async function handleBetaChatCompletions(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: BetaInferenceDeps
): Promise<unknown> {
  const { usageStorage, quotaEnforcer } = deps;
  const requestId = crypto.randomUUID();
  reply.header('x-request-id', requestId);
  const startTime = Date.now();

  const debug = DebugManager.getInstance();
  const body = request.body as any;

  debug.startLog(requestId, body, sanitizeHeaders(request.headers as any));

  // ── Quota check ────────────────────────────────────────────────────────
  if (quotaEnforcer) {
    const allowed = await checkQuotaMiddleware(request, reply, quotaEnforcer);
    if (!allowed) return;
  }

  // ── Wire abort / disconnect ────────────────────────────────────────────
  const abortController = new AbortController();
  const { signal } = wireUpstreamTimeout(abortController);
  const earlyDisconnect = wireEarlyDisconnectDetection(request, abortController);
  const modelAlias: string = body.model ?? '';

  try {
    // ── Parse inbound ──────────────────────────────────────────────────
    const parsed = openaiRequestToContext(body);

    // ── Serialiser state (per-request, so tool-call index resets per stream) ──
    const chunkState = makeChunkSerialiserState(modelAlias);

    // ── Execute ────────────────────────────────────────────────────────
    const result = await runPiAiExecutor({
      requestId,
      incomingApiType: 'chat',
      modelAlias,
      context: parsed.context,
      generationIntent: parsed.generationIntent,
      toolChoice: parsed.toolChoice,
      parallelToolCalls: parsed.parallelToolCalls,
      streaming: parsed.streaming,
      request,
      usageStorage,
      quotaEnforcer,
      signal,
      toolsDefined: parsed.toolsDefined,
      messageCount: parsed.messageCount,
      onSuccess: async () => {
        // Stage 1: no-op
      },
      serializeMessage: (msg) => messageToCompletion(msg, modelAlias, requestId),
      serializeChunks: (event) => {
        const chunks = eventToChunks(event, chunkState);
        const frames = chunks.map(chunkToSSE);
        // Append SSE_DONE on the terminal event
        if (event.type === 'done' || event.type === 'error') {
          frames.push(SSE_DONE);
        }
        return frames;
      },
    });

    earlyDisconnect.cleanup();

    if (result.response != null) {
      // Non-streaming
      if (result.compaction) {
        reply
          .header('x-plexus-compaction-strategy', String(result.compaction.strategy ?? ''))
          .header('x-plexus-compaction-tokens-before', String(result.compaction.tokensBefore))
          .header('x-plexus-compaction-tokens-after', String(result.compaction.tokensAfter));
      }
      return reply.code(200).header('content-type', 'application/json').send(result.response);
    }

    if (result.stream != null) {
      // Streaming — SSE. Compaction headers must be set before the stream starts.
      if (result.compaction) {
        reply
          .header('x-plexus-compaction-strategy', String(result.compaction.strategy ?? ''))
          .header('x-plexus-compaction-tokens-before', String(result.compaction.tokensBefore))
          .header('x-plexus-compaction-tokens-after', String(result.compaction.tokensAfter));
      }
      reply
        .code(200)
        .header('content-type', 'text/event-stream; charset=utf-8')
        .header('cache-control', 'no-cache')
        .header('connection', 'keep-alive')
        .header('x-accel-buffering', 'no');

      const readable = new ReadableStream<string>({
        async start(controller) {
          try {
            for await (const frame of result.stream!) {
              controller.enqueue(frame);
            }
          } catch (e: any) {
            logger.error('[beta/chat] Stream error during pump', e);
          } finally {
            controller.close();
          }
        },
      });

      // Encode to bytes
      const encoded = readable.pipeThrough(new TextEncoderStream());
      return reply.send(encoded);
    }

    // Should not reach here
    return reply
      .code(500)
      .send({ error: { message: 'Executor returned no result', type: 'api_error' } });
  } catch (e: any) {
    earlyDisconnect.cleanup();

    logger.error('[beta/chat] Error processing request', e);

    const statusCode = e?.routingContext?.statusCode ?? 500;
    const errorType =
      statusCode === 401
        ? 'authentication_error'
        : statusCode === 400
          ? 'invalid_request_error'
          : statusCode === 403
            ? 'access_denied'
            : 'api_error';
    const errorCode = e?.routingContext?.code;

    saveBetaErrorUsage(usageStorage, request, requestId, startTime, 'chat', modelAlias, e);

    // Save error to storage
    usageStorage
      .saveError(requestId, e, { apiType: 'chat', ...(e?.routingContext ?? {}) })
      .catch(() => {});

    return reply.code(statusCode).send({
      error: {
        message: e?.message ?? 'Internal server error',
        type: errorType,
        ...(errorCode ? { code: errorCode } : {}),
      },
    });
  }
}

/**
 * Anthropic messages API via the pi-ai native execution path.
 * Errors are in Anthropic shape: { type:"error", error:{ type, message } }.
 * Fails closed with 400 when no registry-valid beta-compatible candidate remains.
 */
export async function handleBetaMessages(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: BetaInferenceDeps
): Promise<unknown> {
  const { usageStorage, quotaEnforcer } = deps;
  const requestId = crypto.randomUUID();
  reply.header('x-request-id', requestId);
  const startTime = Date.now();

  const debug = DebugManager.getInstance();
  const body = request.body as any;

  debug.startLog(requestId, body, sanitizeHeaders(request.headers as any));

  // ── Quota check ──────────────────────────────────────────────────────────
  if (quotaEnforcer) {
    const allowed = await checkQuotaMiddleware(request, reply, quotaEnforcer);
    if (!allowed) return;
  }

  // ── Wire abort / disconnect ──────────────────────────────────────────────
  const abortController = new AbortController();
  const { signal } = wireUpstreamTimeout(abortController);
  const earlyDisconnect = wireEarlyDisconnectDetection(request, abortController);
  const modelAlias: string = body.model ?? '';

  const anthropicError = (e: any) => {
    const statusCode = e?.routingContext?.statusCode ?? 500;
    const errorType =
      statusCode === 401
        ? 'authentication_error'
        : statusCode === 400
          ? 'invalid_request_error'
          : statusCode === 403
            ? 'permission_error'
            : 'api_error';
    return reply.code(statusCode).send({
      type: 'error',
      error: {
        type: errorType,
        message: e?.message ?? 'Internal server error',
      },
    });
  };

  try {
    // ── Parse inbound ────────────────────────────────────────────────────
    const parsed = anthropicRequestToContext(body);

    // ── Serialiser state ─────────────────────────────────────────────────
    const chunkState = makeAnthropicChunkSerialiserState(modelAlias);

    // ── Execute ──────────────────────────────────────────────────────────
    const result = await runPiAiExecutor({
      requestId,
      incomingApiType: 'messages',
      modelAlias,
      context: parsed.context,
      generationIntent: parsed.generationIntent,
      toolChoice: parsed.toolChoice,
      streaming: parsed.streaming,
      request,
      usageStorage,
      quotaEnforcer,
      signal,
      toolsDefined: parsed.toolsDefined,
      messageCount: parsed.messageCount,
      onSuccess: async () => {
        // Stage 2: no-op
      },
      serializeMessage: (msg) => messageToAnthropicResponse(msg, modelAlias, requestId),
      serializeChunks: (event) => eventToAnthropicSSE(event, chunkState),
    });

    earlyDisconnect.cleanup();

    if (result.response != null) {
      if (result.compaction) {
        reply
          .header('x-plexus-compaction-strategy', String(result.compaction.strategy ?? ''))
          .header('x-plexus-compaction-tokens-before', String(result.compaction.tokensBefore))
          .header('x-plexus-compaction-tokens-after', String(result.compaction.tokensAfter));
      }
      return reply.code(200).header('content-type', 'application/json').send(result.response);
    }

    if (result.stream != null) {
      // Compaction headers must be set before the stream starts.
      if (result.compaction) {
        reply
          .header('x-plexus-compaction-strategy', String(result.compaction.strategy ?? ''))
          .header('x-plexus-compaction-tokens-before', String(result.compaction.tokensBefore))
          .header('x-plexus-compaction-tokens-after', String(result.compaction.tokensAfter));
      }
      reply
        .code(200)
        .header('content-type', 'text/event-stream; charset=utf-8')
        .header('cache-control', 'no-cache')
        .header('connection', 'keep-alive')
        .header('x-accel-buffering', 'no');

      const readable = new ReadableStream<string>({
        async start(controller) {
          try {
            for await (const frame of result.stream!) {
              controller.enqueue(frame);
            }
          } catch (e: any) {
            logger.error('[beta/messages] Stream error during pump', e);
          } finally {
            controller.close();
          }
        },
      });

      return reply.send(readable.pipeThrough(new TextEncoderStream()));
    }

    return reply.code(500).send({
      type: 'error',
      error: { type: 'api_error', message: 'Executor returned no result' },
    });
  } catch (e: any) {
    earlyDisconnect.cleanup();
    logger.error('[beta/messages] Error processing request', e);
    saveBetaErrorUsage(usageStorage, request, requestId, startTime, 'messages', modelAlias, e);
    usageStorage
      .saveError(requestId, e, { apiType: 'messages', ...(e?.routingContext ?? {}) })
      .catch(() => {});
    return anthropicError(e);
  }
}

/**
 * OpenAI Responses API via the pi-ai native execution path.
 * State loading (previous_response_id / conversation) happens BEFORE parsing.
 * post-response storage is wired via the onSuccess hook.
 * Error shape: OpenAI Responses { error: { message, type, code } }.
 */
export async function handleBetaResponses(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: BetaInferenceDeps
): Promise<unknown> {
  const { usageStorage, quotaEnforcer } = deps;
  const responsesStorage = deps.responsesStorage ?? new ResponsesStorageService();
  const requestId = crypto.randomUUID();
  reply.header('x-request-id', requestId);
  const startTime = Date.now();

  const debug = DebugManager.getInstance();
  const body = request.body as any;
  const modelAlias: string = body.model ?? '';

  debug.startLog(requestId, body, sanitizeHeaders(request.headers as any));

  // ── Quota check ──────────────────────────────────────────────────────────
  if (quotaEnforcer) {
    const allowed = await checkQuotaMiddleware(request, reply, quotaEnforcer);
    if (!allowed) return;
  }

  // ── State loading: previous_response_id ──────────────────────────────────
  if (body.previous_response_id) {
    const prev = await responsesStorage.getResponse(body.previous_response_id);
    if (!prev) {
      return reply.code(404).send({
        error: {
          message: `Previous response not found: ${body.previous_response_id}`,
          type: 'invalid_request_error',
          code: 'response_not_found',
          param: 'previous_response_id',
        },
      });
    }
    const previousItems = JSON.parse(prev.outputItems);
    const currentInput = normalizeResponsesInput(body.input);
    body.input = [...previousItems, ...currentInput];
  }

  // ── State loading: conversation ───────────────────────────────────────────
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
    const conversationItems = JSON.parse(conversation.items);
    const currentInput = normalizeResponsesInput(body.input);
    body.input = [...conversationItems, ...currentInput];
  }

  // ── Wire abort / disconnect ──────────────────────────────────────────────
  const abortController = new AbortController();
  const { signal } = wireUpstreamTimeout(abortController);
  const earlyDisconnect = wireEarlyDisconnectDetection(request, abortController);

  try {
    // ── Parse inbound ────────────────────────────────────────────────────
    const parsed = responsesToContext(body);
    const inputItems: any[] = Array.isArray(body.input) ? body.input : [];

    // ── Serialiser state ─────────────────────────────────────────────────
    const chunkState = makeResponsesChunkSerialiserState(modelAlias);

    // ── onSuccess: post-response storage (non-streaming only, matching existing handler) ──
    const onSuccess = async (msg: import('@earendil-works/pi-ai').AssistantMessage) => {
      if (body.store !== false && !body.stream) {
        const storedObj = messageToResponsesObject(
          msg,
          modelAlias,
          chunkState.responseId,
          parsed.wantsSummary
        );
        try {
          await responsesStorage.storeResponse(storedObj as any, body);
          if (body.conversation) {
            const conversationId =
              typeof body.conversation === 'string' ? body.conversation : body.conversation.id;
            await responsesStorage.updateConversation(
              conversationId,
              (storedObj.output as any[]) ?? [],
              inputItems
            );
          }
        } catch (err) {
          logger.error('[beta/responses] Failed to store response', err);
        }
      }
    };

    // ── Execute ──────────────────────────────────────────────────────────
    const result = await runPiAiExecutor({
      requestId,
      incomingApiType: 'responses',
      modelAlias,
      context: parsed.context,
      generationIntent: parsed.generationIntent,
      toolChoice: parsed.toolChoice,
      streaming: parsed.streaming,
      request,
      usageStorage,
      quotaEnforcer,
      signal,
      toolsDefined: parsed.toolsDefined,
      messageCount: parsed.messageCount,
      onSuccess,
      serializeMessage: (msg) =>
        messageToResponsesObject(msg, modelAlias, chunkState.responseId, parsed.wantsSummary),
      serializeChunks: (event) => eventToResponsesSSE(event, chunkState),
    });

    earlyDisconnect.cleanup();

    if (result.response != null) {
      if (result.compaction) {
        reply
          .header('x-plexus-compaction-strategy', String(result.compaction.strategy ?? ''))
          .header('x-plexus-compaction-tokens-before', String(result.compaction.tokensBefore))
          .header('x-plexus-compaction-tokens-after', String(result.compaction.tokensAfter));
      }
      return reply.code(200).header('content-type', 'application/json').send(result.response);
    }

    if (result.stream != null) {
      // Compaction headers must be set before the stream starts.
      if (result.compaction) {
        reply
          .header('x-plexus-compaction-strategy', String(result.compaction.strategy ?? ''))
          .header('x-plexus-compaction-tokens-before', String(result.compaction.tokensBefore))
          .header('x-plexus-compaction-tokens-after', String(result.compaction.tokensAfter));
      }
      reply
        .code(200)
        .header('content-type', 'text/event-stream; charset=utf-8')
        .header('cache-control', 'no-cache')
        .header('connection', 'keep-alive')
        .header('x-accel-buffering', 'no');

      const readable = new ReadableStream<string>({
        async start(controller) {
          try {
            for await (const frame of result.stream!) {
              controller.enqueue(frame);
            }
          } catch (e: any) {
            logger.error('[beta/responses] Stream error during pump', e);
          } finally {
            controller.close();
          }
        },
      });

      return reply.send(readable.pipeThrough(new TextEncoderStream()));
    }

    return reply.code(500).send({
      error: { message: 'Executor returned no result', type: 'api_error' },
    });
  } catch (e: any) {
    earlyDisconnect.cleanup();
    logger.error('[beta/responses] Error processing request', e);
    const statusCode = e?.routingContext?.statusCode ?? 500;
    const errorType =
      statusCode === 401
        ? 'authentication_error'
        : statusCode === 400
          ? 'invalid_request_error'
          : statusCode === 403
            ? 'access_denied'
            : 'api_error';
    const errorCode = e?.routingContext?.code;
    saveBetaErrorUsage(usageStorage, request, requestId, startTime, 'responses', modelAlias, e);
    usageStorage
      .saveError(requestId, e, { apiType: 'responses', ...(e?.routingContext ?? {}) })
      .catch(() => {});
    return reply.code(statusCode).send({
      error: {
        message: e?.message ?? 'Internal server error',
        type: errorType,
        ...(errorCode ? { code: errorCode } : {}),
      },
    });
  }
}

/**
 * Shared beta handler for Gemini generateContent and streamGenerateContent.
 * Streaming is passed in directly. Error shape: Gemini { error: { code, message, status } }.
 */
export async function handleBetaGeminiRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  streaming: boolean,
  deps: BetaInferenceDeps
): Promise<unknown> {
  const { usageStorage, quotaEnforcer } = deps;
  const requestId = crypto.randomUUID();
  reply.header('x-request-id', requestId);
  const startTime = Date.now();

  const debug = DebugManager.getInstance();
  const body = request.body as any;
  // Model alias comes from the URL param — inject into body for the parser
  const params = request.params as any;
  const modelAlias: string =
    params?.model ??
    (typeof params?.modelWithAction === 'string'
      ? params.modelWithAction.split(':')[0]
      : (body.model ?? ''));
  body.model = modelAlias;

  debug.startLog(requestId, body, sanitizeHeaders(request.headers as any));

  // ── Quota check ──────────────────────────────────────────────────────────
  if (quotaEnforcer) {
    const allowed = await checkQuotaMiddleware(request, reply, quotaEnforcer);
    if (!allowed) return;
  }

  // ── Wire abort / disconnect ──────────────────────────────────────────────
  const abortController = new AbortController();
  const { signal } = wireUpstreamTimeout(abortController);
  const earlyDisconnect = wireEarlyDisconnectDetection(request, abortController);

  try {
    // ── Parse inbound ────────────────────────────────────────────────────
    const parsed = geminiRequestToContext(body, streaming);

    // ── Serialiser state ─────────────────────────────────────────────────
    const chunkState = makeGeminiChunkSerialiserState(modelAlias);

    // ── Execute ──────────────────────────────────────────────────────────
    const result = await runPiAiExecutor({
      requestId,
      incomingApiType: 'gemini',
      modelAlias,
      context: parsed.context,
      generationIntent: parsed.generationIntent,
      streaming: parsed.streaming,
      request,
      usageStorage,
      quotaEnforcer,
      signal,
      toolsDefined: parsed.toolsDefined,
      messageCount: parsed.messageCount,
      onSuccess: async () => {
        // No post-response storage for Gemini
      },
      serializeMessage: (msg) => messageToGeminiResponse(msg, modelAlias),
      serializeChunks: (event) => eventToGeminiNDJSON(event, chunkState),
    });

    earlyDisconnect.cleanup();

    if (result.response != null) {
      if (result.compaction) {
        reply
          .header('x-plexus-compaction-strategy', String(result.compaction.strategy ?? ''))
          .header('x-plexus-compaction-tokens-before', String(result.compaction.tokensBefore))
          .header('x-plexus-compaction-tokens-after', String(result.compaction.tokensAfter));
      }
      return reply.code(200).header('content-type', 'application/json').send(result.response);
    }

    if (result.stream != null) {
      // Gemini streamGenerateContent uses data-prefixed JSON frames.
      reply
        .code(200)
        .header('content-type', 'text/event-stream')
        .header('cache-control', 'no-cache')
        .header('connection', 'keep-alive')
        .header('x-accel-buffering', 'no');

      const readable = new ReadableStream<string>({
        async start(controller) {
          try {
            for await (const frame of result.stream!) {
              controller.enqueue(frame);
            }
          } catch (e: any) {
            logger.error('[beta/gemini] Stream error during pump', e);
          } finally {
            controller.close();
          }
        },
      });

      return reply.send(readable.pipeThrough(new TextEncoderStream()));
    }

    return reply.code(500).send({
      error: { code: 500, message: 'Executor returned no result', status: 'INTERNAL' },
    });
  } catch (e: any) {
    earlyDisconnect.cleanup();
    logger.error('[beta/gemini] Error processing request', e);
    const statusCode = e?.routingContext?.statusCode ?? 500;
    const geminiStatus =
      statusCode === 401
        ? 'UNAUTHENTICATED'
        : statusCode === 403
          ? 'PERMISSION_DENIED'
          : statusCode === 400
            ? 'INVALID_ARGUMENT'
            : statusCode === 429
              ? 'RESOURCE_EXHAUSTED'
              : 'INTERNAL';
    saveBetaErrorUsage(
      usageStorage,
      request,
      requestId,
      startTime,
      'gemini',
      modelAlias,
      e,
      streaming
    );
    usageStorage
      .saveError(requestId, e, { apiType: 'gemini', ...(e?.routingContext ?? {}) })
      .catch(() => {});
    return reply.code(statusCode).send({
      error: {
        code: statusCode,
        message: e?.message ?? 'Internal server error',
        status: geminiStatus,
      },
    });
  }
}

export async function registerInferenceV2Routes(
  fastify: FastifyInstance,
  usageStorage: UsageStorageService,
  quotaEnforcer?: QuotaEnforcer
): Promise<void> {
  const deps: BetaInferenceDeps = {
    usageStorage,
    quotaEnforcer,
    responsesStorage: new ResponsesStorageService(),
  };

  fastify.post('/beta/v1/chat/completions', async (request: FastifyRequest, reply) =>
    handleBetaChatCompletions(request, reply, deps)
  );

  fastify.post('/beta/v1/messages', async (request: FastifyRequest, reply) =>
    handleBetaMessages(request, reply, deps)
  );

  fastify.post('/beta/v1/responses', async (request: FastifyRequest, reply) =>
    handleBetaResponses(request, reply, deps)
  );

  fastify.post('/beta/v1beta/models/:modelWithAction', async (request: FastifyRequest, reply) => {
    const modelWithAction = (request.params as any).modelWithAction as string;
    return handleBetaGeminiRequest(
      request,
      reply,
      modelWithAction.includes('streamGenerateContent'),
      deps
    );
  });
}
