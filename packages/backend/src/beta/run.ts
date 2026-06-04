/**
 * Beta inference path — orchestrator.
 *
 * Resolves a model alias to a plexus provider via the existing Router, builds a
 * pi-ai Model (getModel + baseUrl/apiKey override), converts the OpenAI request
 * body into a pi-ai Context, then drives streamSimple() or completeSimple() from
 * pi-ai and yields the result as OpenAI chat-completions JSON / SSE.
 *
 * Uses streamSimple/completeSimple (the canonical pi-ai API) which maps a single
 * ThinkingLevel to the correct per-provider option shape internally.
 *
 * Usage recording and debug logging happen here directly (not via handleResponse,
 * which is tied to UnifiedChatResponse).
 */
import { getModel, stream, complete, calculateCost } from '@earendil-works/pi-ai';
import type {
  AssistantMessage,
  AssistantMessageEvent,
  ProviderStreamOptions,
} from '@earendil-works/pi-ai';
import { buildThinkingOptions } from '../transformers/oauth/oauth-transformer';

import { Router } from '../services/router';
import { DebugManager } from '../services/debug-manager';
import { UsageStorageService } from '../services/usage-storage';
import { logger } from '../utils/logger';
import { getClientIp } from '../utils/ip';
import type { UsageRecord } from '../types/usage';
import type { FastifyRequest } from 'fastify';

import { openaiRequestToContext, type OpenAIChatRequest } from './openai-to-context';
import {
  assistantMessageToOpenAIResponse,
  assistantEventToOpenAIChunk,
  chunkToSSE,
  SSE_DONE,
  type OpenAIChatCompletion,
  type OpenAIChatChunk,
} from './context-to-openai';

/** Resolve a string-or-record api_base_url to a single URL string.
 *  For anthropic-messages, the Anthropic SDK appends /v1 itself, so we strip
 *  a trailing bare /v1. All other providers (OpenAI SDK, Google SDK) expect
 *  the full URL including /v1 and append only the endpoint path. */
function resolveBaseUrl(
  apiBaseUrl: string | Record<string, string>,
  apiType: string,
  piApi: string
): string {
  let raw: string;
  if (typeof apiBaseUrl === 'string') {
    raw = apiBaseUrl;
  } else {
    raw = apiBaseUrl[apiType] ?? apiBaseUrl['default'] ?? Object.values(apiBaseUrl)[0] ?? '';
  }
  raw = raw.replace(/\/$/, '');
  if (piApi === 'anthropic-messages') {
    raw = raw.replace(/\/v\d+$/, '');
  }
  return raw;
}

/** Build the per-API thinking/reasoning options for stream().
 *  When effort is provided, uses buildThinkingOptions (same as the oauth path).
 *  When no effort, applies the provider's disabled-thinking config so thinking
 *  tokens aren't silently consumed (mirrors streamSimple's internal behaviour). */
function buildReasoningOptions(
  piApi: string,
  piModelId: string,
  effort?: string
): Record<string, unknown> {
  if (effort) {
    return buildThinkingOptions(piApi, piModelId, effort);
  }
  // No caller reasoning requested — explicitly disable thinking where supported.
  // This mirrors what streamSimpleAnthropic and streamSimpleGoogle do internally.
  if (piApi === 'anthropic-messages') {
    return { thinkingEnabled: false };
  }
  if (piApi === 'google-generative-ai') {
    return { thinking: { enabled: false } };
  }
  // OpenAI-family: leave reasoning unset — the model registry drives defaults.
  return {};
}

export interface BetaRunResult {
  response?: OpenAIChatCompletion;
  stream?: AsyncIterable<string>;
}

export async function runBeta(
  body: OpenAIChatRequest,
  requestId: string,
  request: FastifyRequest,
  usageStorage: UsageStorageService,
  signal?: AbortSignal
): Promise<BetaRunResult> {
  const startTime = Date.now();
  const debug = DebugManager.getInstance();

  // ── Usage record skeleton ────────────────────────────────────────────────────
  const usageRecord: Partial<UsageRecord> = {
    requestId,
    date: new Date().toISOString(),
    sourceIp: getClientIp(request),
    apiKey: (request as any).keyName ?? null,
    attribution: (request as any).attribution ?? null,
    incomingApiType: 'chat',
    incomingModelAlias: body.model,
    startTime,
    isStreamed: !!body.stream,
    responseStatus: 'pending',
    toolsDefined: body.tools?.length ?? 0,
    messageCount: body.messages?.length ?? 0,
  };

  usageStorage.emitStartedAsync(usageRecord);
  debug.startLog(requestId, body, request.headers as Record<string, string>);

  // ── Route resolution ─────────────────────────────────────────────────────────
  let route: Awaited<ReturnType<typeof Router.resolve>>;
  try {
    route = await Router.resolve(body.model, 'chat');
  } catch (err: any) {
    await finishWithError(usageRecord, err, startTime, requestId, usageStorage, debug);
    throw err;
  }

  const { config: providerConfig, modelConfig, provider, model: resolvedModel } = route;

  const piAiProvider = providerConfig.pi_ai_provider;
  const piAiModelId = modelConfig?.pi_ai_model_id;

  if (!piAiProvider || !piAiModelId) {
    const msg =
      `Beta path requires pi_ai_provider on the provider and pi_ai_model_id on the model. ` +
      `Provider '${provider}' has pi_ai_provider=${JSON.stringify(piAiProvider)}, ` +
      `model '${resolvedModel}' has pi_ai_model_id=${JSON.stringify(piAiModelId)}.`;
    const err = Object.assign(new Error(msg), {
      routingContext: { statusCode: 400, code: 'missing_pi_ai_hint' },
    });
    await finishWithError(usageRecord, err, startTime, requestId, usageStorage, debug);
    throw err;
  }

  usageStorage.emitUpdatedAsync({
    requestId,
    provider,
    selectedModelName: resolvedModel,
    canonicalModelName: route.canonicalModel ?? null,
  });
  debug.setProviderForRequest(requestId, provider);

  // ── Build pi-ai Model, override baseUrl for plexus upstream ─────────────────
  const piModel = { ...getModel(piAiProvider as any, piAiModelId as any) };
  if (providerConfig.api_base_url) {
    piModel.baseUrl = resolveBaseUrl(
      providerConfig.api_base_url as string | Record<string, string>,
      'chat',
      piModel.api
    );
  }

  // ── Build Context ────────────────────────────────────────────────────────────
  const { context, options } = openaiRequestToContext(body, {
    provider: piModel.provider,
    model: piAiModelId,
    api: piModel.api,
  });

  // ── Assemble ProviderStreamOptions ───────────────────────────────────────────
  // Use stream() directly (not streamSimple) so all options — toolChoice,
  // parallelToolCalls, etc. — are passed through to the provider unchanged.
  // We replicate only the thinking/reasoning mapping that streamSimple does.
  const reasoningOptions = buildReasoningOptions(piModel.api, piAiModelId, body.reasoning_effort);

  const requestOptions: ProviderStreamOptions = {
    ...reasoningOptions,
    ...(options.temperature != null ? { temperature: options.temperature } : {}),
    ...(options.maxTokens != null ? { maxTokens: options.maxTokens } : {}),
    ...(options.toolChoice != null ? { toolChoice: options.toolChoice } : {}),
    ...(body.parallel_tool_calls != null ? { parallelToolCalls: body.parallel_tool_calls } : {}),
    ...((body as any).prompt_cache_key ? { sessionId: (body as any).prompt_cache_key } : {}),
    ...(Array.isArray((body as any).include) && (body as any).include.length > 0
      ? { include: (body as any).include }
      : {}),
    apiKey: providerConfig.api_key ?? '',
    ...(providerConfig.headers ? { headers: providerConfig.headers } : {}),
    ...(signal ? { signal } : {}),
    onPayload: (payload: unknown) => {
      debug.addTransformedRequest(requestId, payload);
      logger.debug(`Beta: OUTGOING-PAYLOAD ${JSON.stringify(payload)}`);
      return payload;
    },
  };

  logger.info(
    `Beta: ${body.stream ? 'streaming' : 'complete'} request { alias: "${body.model}", provider: "${provider}", model: "${resolvedModel}", piModel: "${piAiModelId}@${piAiProvider}", reasoning: "${body.reasoning_effort ?? 'none'}" }`
  );

  // ── Execute ──────────────────────────────────────────────────────────────────
  if (body.stream) {
    const eventStream = await stream(piModel, context, requestOptions);
    return {
      stream: buildSSEStream(
        eventStream,
        usageRecord,
        startTime,
        requestId,
        usageStorage,
        debug,
        piModel,
        resolvedModel
      ),
    };
  }

  let assistantMsg: AssistantMessage;
  try {
    assistantMsg = await complete(piModel, context, requestOptions);
  } catch (err: any) {
    await finishWithError(usageRecord, err, startTime, requestId, usageStorage, debug);
    throw wrapAbortError(err, signal);
  }

  const openAiResponse = assistantMessageToOpenAIResponse(assistantMsg, resolvedModel);
  const cost = calculateCost(piModel, assistantMsg.usage);

  fillUsageFromMessage(usageRecord, assistantMsg, cost);
  usageRecord.durationMs = Date.now() - startTime;
  usageRecord.responseStatus = 'success';
  usageRecord.finishReason = openAiResponse.choices[0]?.finish_reason ?? null;
  usageRecord.toolCallsCount = openAiResponse.choices[0]?.message.tool_calls?.length ?? 0;

  debug.addTransformedResponse(requestId, openAiResponse);
  debug.flush(requestId);
  usageStorage.saveRequest(usageRecord as UsageRecord);

  return { response: openAiResponse };
}

async function* buildSSEStream(
  eventStream: AsyncIterable<AssistantMessageEvent>,
  usageRecord: Partial<UsageRecord>,
  startTime: number,
  requestId: string,
  usageStorage: UsageStorageService,
  debug: DebugManager,
  piModel: ReturnType<typeof getModel>,
  resolvedModel: string
): AsyncIterable<string> {
  let ttft: number | null = null;
  let lastMessage: AssistantMessage | undefined;

  try {
    for await (const event of eventStream) {
      if (ttft === null && event.type !== 'start') {
        ttft = Date.now() - startTime;
      }

      const chunk: OpenAIChatChunk | null = assistantEventToOpenAIChunk(event, resolvedModel);
      if (chunk) yield chunkToSSE(chunk);

      if (event.type === 'done') lastMessage = event.message;
    }
    yield SSE_DONE;
  } catch (err: any) {
    await finishWithError(usageRecord, err, startTime, requestId, usageStorage, debug);
    throw err;
  }

  if (lastMessage) {
    fillUsageFromMessage(usageRecord, lastMessage, calculateCost(piModel, lastMessage.usage));
  }

  usageRecord.durationMs = Date.now() - startTime;
  usageRecord.ttftMs = ttft;
  usageRecord.responseStatus = 'success';

  debug.flush(requestId);
  usageStorage.saveRequest(usageRecord as UsageRecord);
}

function fillUsageFromMessage(
  record: Partial<UsageRecord>,
  msg: AssistantMessage,
  cost: ReturnType<typeof calculateCost>
) {
  record.tokensInput = msg.usage.input;
  record.tokensOutput = msg.usage.output;
  record.tokensCached = msg.usage.cacheRead;
  record.tokensCacheWrite = msg.usage.cacheWrite;
  record.costInput = cost?.input ?? null;
  record.costOutput = cost?.output ?? null;
  record.costCached = cost?.cacheRead ?? null;
  record.costCacheWrite = cost?.cacheWrite ?? null;
  record.costTotal = cost?.total ?? null;
  record.costSource = 'pi-ai';
}

async function finishWithError(
  record: Partial<UsageRecord>,
  err: any,
  startTime: number,
  requestId: string,
  usageStorage: UsageStorageService,
  debug: DebugManager
) {
  const isAbort = err?.name === 'AbortError';
  const isTimeout = err?.routingContext?.code === 'upstream_timeout';
  record.responseStatus = isTimeout ? 'timeout' : isAbort ? 'cancelled' : 'error';
  record.durationMs = Date.now() - startTime;
  debug.flush(requestId);
  usageStorage.saveRequest(record as UsageRecord);
  await usageStorage.saveError(requestId, err, { apiType: 'chat' });
}

function wrapAbortError(err: any, signal?: AbortSignal): any {
  if (err?.name === 'AbortError' || signal?.aborted) {
    const isTimeout = signal?.reason?.name === 'TimeoutError';
    const wrapped = new Error(isTimeout ? 'Upstream timeout' : 'Client disconnected') as any;
    wrapped.routingContext = {
      statusCode: isTimeout ? 504 : 499,
      code: isTimeout ? 'upstream_timeout' : 'client_disconnected',
    };
    return wrapped;
  }
  return err;
}
