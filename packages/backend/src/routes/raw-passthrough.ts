import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { finished } from 'node:stream/promises';
import bearerAuth from '@fastify/bearer-auth';
import { getConfig } from '../config';
import { createAuthHook } from '../utils/auth';
import { getClientIp } from '../utils/ip';
import { sanitizeHeaders } from '../utils/sanitize-headers';
import { getClientRequestId } from '../utils/client-request-id';
import { logger } from '../utils/logger';
import { listAllows } from '../services/scope-match';
import { UsageStorageService } from '../services/usage-storage';
import type { UsageRecord } from '../types/usage';
import { DebugManager } from '../services/debug-manager';
import { QuotaEnforcer } from '../services/quota/quota-enforcer';
import {
  buildQuotaExceededBody,
  buildQuotaHeaders,
  checkQuotaMiddleware,
  recordQuotaUsage,
} from '../services/quota/quota-middleware';
import { ConcurrencyTracker } from '../services/concurrency-tracker';
import { wireEarlyDisconnectDetection } from '../utils/timeout';
import { DebugLoggingInspector, extractUsageFromReconstructed } from '../services/inspectors';
import { calculateCosts } from '../utils/calculate-costs';
import { applyProviderReportedCost, applyUsageCostDetails } from '../utils/provider-cost';
import { extractUsageCostDetails } from '../utils/usage-normalizer';
import {
  buildRawUpstreamHeaders,
  buildRawUpstreamUrl,
  executeRawUpstreamRequest,
  filterRawResponseHeaders,
  validateRawProviderSlug,
} from '../services/raw-passthrough';

const RAW_METHODS = ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT'] as const;

function extractRawSuffix(rawUrl: string): string {
  const queryIndex = rawUrl.indexOf('?');
  const pathname = queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex);
  const suffixStart = pathname.indexOf('/', '/raw/'.length);
  const query = queryIndex === -1 ? '' : rawUrl.slice(queryIndex);
  return `${suffixStart === -1 ? '/' : pathname.slice(suffixStart)}${query}`;
}

function inferObservedApiType(rawSuffix: string): string {
  const pathname = rawSuffix.split('?')[0]?.toLowerCase() ?? '';
  if (pathname.endsWith('/chat/completions') || pathname.endsWith('/completions')) return 'chat';
  if (pathname.endsWith('/messages')) return 'messages';
  if (pathname.endsWith('/responses')) return 'responses';
  if (pathname.includes(':generatecontent') || pathname.includes(':streamgeneratecontent')) {
    return 'gemini';
  }
  return 'unknown';
}

function parseRawJsonBody(body: Buffer | null): Record<string, any> | null {
  if (!body || body.length === 0) return null;
  const text = body.toString('utf8').trim();
  if (!text.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function resolveRawModelPricing(
  provider: ReturnType<typeof getConfig>['providers'][string],
  model: string
) {
  if (!model || !provider.models || Array.isArray(provider.models)) return undefined;
  const exact = provider.models[model];
  if (exact) return exact.pricing;
  const matched = Object.entries(provider.models).find(
    ([configuredModel, config]) =>
      configuredModel.startsWith(`${model}:`) || config.pi_ai_model_id === model
  );
  return matched?.[1].pricing;
}

function applyObservedUsage(
  usageRecord: Partial<UsageRecord>,
  reconstructed: any,
  apiType: string,
  pricing: unknown,
  providerDiscount: number | undefined
): void {
  const usage = extractUsageFromReconstructed(reconstructed, apiType);
  if (usage) {
    usageRecord.tokensInput = usage.inputTokens;
    usageRecord.tokensOutput = usage.outputTokens;
    usageRecord.tokensCached = usage.cachedTokens;
    usageRecord.tokensCacheWrite = usage.cacheWriteTokens;
    usageRecord.tokensReasoning = usage.reasoningTokens;
  }

  calculateCosts(usageRecord, pricing, providerDiscount);
  if (reconstructed?.providerReportedCost) {
    applyProviderReportedCost(usageRecord, reconstructed.providerReportedCost);
    return;
  }
  if (reconstructed?.usage) {
    const costDetails = extractUsageCostDetails(reconstructed.usage);
    if (costDetails) applyUsageCostDetails(usageRecord, costDetails);
  }
}

function isTextualContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const normalized = contentType.toLowerCase();
  return (
    normalized.startsWith('text/') ||
    normalized.includes('json') ||
    normalized.includes('xml') ||
    normalized.includes('x-www-form-urlencoded') ||
    normalized.includes('javascript')
  );
}

function formatDebugBody(body: Buffer, contentType: string | undefined): unknown {
  if (isTextualContentType(contentType)) {
    return body.toString('utf8');
  }
  return {
    encoding: 'base64',
    data: body.toString('base64'),
    byteLength: body.length,
  };
}

function waitForDrainOrClose(reply: FastifyReply): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      reply.raw.removeListener('drain', onDrain);
      reply.raw.removeListener('close', onClose);
      reply.raw.removeListener('error', onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new DOMException('Client disconnected', 'AbortError'));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    reply.raw.once('drain', onDrain);
    reply.raw.once('close', onClose);
    reply.raw.once('error', onError);
  });
}

function saveCompletedUsage(
  usageStorage: UsageStorageService,
  usageRecord: Partial<UsageRecord>,
  startTime: number,
  status: number
): void {
  usageRecord.durationMs = Date.now() - startTime;
  usageRecord.responseStatus = status < 400 ? 'success' : `HTTP ${status}`;
  usageStorage.saveRequest(usageRecord as UsageRecord);
}

export async function registerRawPassthroughRoutes(
  fastify: FastifyInstance,
  usageStorage: UsageStorageService,
  quotaEnforcer?: QuotaEnforcer
): Promise<void> {
  fastify.register(async (rawRoutes) => {
    rawRoutes.removeAllContentTypeParsers();
    rawRoutes.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => {
      done(null, body);
    });

    const auth = createAuthHook({ allowQueryKey: false });
    rawRoutes.addHook('onRequest', auth.onRequest);
    await rawRoutes.register(bearerAuth, auth.bearerAuthOptions);

    rawRoutes.route({
      method: [...RAW_METHODS],
      url: '/raw/:provider/*',
      handler: async (
        request: FastifyRequest<{ Params: { provider: string; '*': string } }>,
        reply: FastifyReply
      ) => {
        const providerSlug = request.params.provider;
        const provider = getConfig().providers[providerSlug];
        if (
          !validateRawProviderSlug(providerSlug) ||
          !provider ||
          provider.enabled === false ||
          provider.raw_passthrough?.enabled !== true
        ) {
          return reply.code(404).send({
            error: { message: `Raw provider '${providerSlug}' not found`, type: 'not_found' },
          });
        }

        const keyConfig = (request as any).keyConfig as
          | {
              allowRawPassthrough?: boolean;
              allowedProviders?: string[];
              excludedProviders?: string[];
            }
          | undefined;
        if (
          keyConfig?.allowRawPassthrough !== true ||
          !listAllows(keyConfig.allowedProviders, keyConfig.excludedProviders, providerSlug)
        ) {
          return reply.code(403).send({
            error: {
              message: `Key is not allowed raw access to provider '${providerSlug}'`,
              type: 'access_denied',
            },
          });
        }

        const requestId = crypto.randomUUID();
        const clientRequestId = getClientRequestId(request.headers);
        const startTime = Date.now();
        const rawSuffix = extractRawSuffix(request.raw.url || request.url);
        const body = Buffer.isBuffer(request.body) ? request.body : null;
        const parsedBody = parseRawJsonBody(body);
        const requestedModel =
          typeof parsedBody?.model === 'string' && parsedBody.model.trim()
            ? parsedBody.model.trim()
            : '';
        const rawModel = requestedModel;
        const observedApiType = inferObservedApiType(rawSuffix);
        const usageRecord: Partial<UsageRecord> = {
          requestId,
          clientRequestId,
          date: new Date().toISOString(),
          sourceIp: getClientIp(request),
          apiKey: (request as any).keyName,
          attribution: (request as any).attribution || null,
          incomingApiType: 'raw',
          outgoingApiType: 'raw',
          provider: providerSlug,
          incomingModelAlias: requestedModel || null,
          selectedModelName: requestedModel || null,
          attemptCount: 1,
          finalAttemptProvider: providerSlug,
          finalAttemptModel: requestedModel || null,
          allAttemptedProviders: JSON.stringify([providerSlug]),
          startTime,
          isStreamed: false,
          isPassthrough: false,
          isRaw: true,
          requestMethod: request.method,
          requestPath: rawSuffix,
          responseStatus: 'pending',
          toolsDefined: Array.isArray(parsedBody?.tools) ? parsedBody.tools.length : 0,
          messageCount: Array.isArray(parsedBody?.messages) ? parsedBody.messages.length : 0,
          parallelToolCallsEnabled:
            typeof parsedBody?.parallel_tool_calls === 'boolean'
              ? parsedBody.parallel_tool_calls
              : null,
        };

        usageStorage.emitStartedAsync(usageRecord);
        usageStorage.emitUpdatedAsync({
          requestId,
          provider: providerSlug,
          incomingModelAlias: requestedModel || null,
          selectedModelName: requestedModel || null,
        });

        const debugManager = DebugManager.getInstance();
        const captureDebugBody = debugManager.isCaptureEnabled();
        const debugRequest =
          captureDebugBody && body
            ? formatDebugBody(body, request.headers['content-type'])
            : { method: request.method, path: rawSuffix };
        debugManager.startLog(requestId, debugRequest, sanitizeHeaders(request.headers as any));
        debugManager.setProviderForRequest(requestId, providerSlug);
        debugManager.setModelAliasForRequest(
          requestId,
          requestedModel || null,
          debugRequest,
          sanitizeHeaders(request.headers as any)
        );
        debugManager.addTransformedRequest(requestId, debugRequest);

        if (quotaEnforcer) {
          const quotaCheck = await checkQuotaMiddleware(request, reply, quotaEnforcer);
          if (!quotaCheck.ok) {
            usageRecord.responseStatus = 'quota_exceeded';
            usageRecord.durationMs = Date.now() - startTime;
            usageStorage.saveRequest(usageRecord as UsageRecord);
            debugManager.flush(requestId);
            return;
          }
          if (quotaCheck.context) {
            const { allowed, blocked } = QuotaEnforcer.filterCandidates(quotaCheck.context, [
              { provider: providerSlug, model: rawModel },
            ]);
            if (allowed.length === 0 && blocked.length > 0) {
              usageRecord.responseStatus = 'quota_exceeded';
              usageRecord.durationMs = Date.now() - startTime;
              usageStorage.saveRequest(usageRecord as UsageRecord);
              debugManager.flush(requestId);
              return reply
                .code(429)
                .send(buildQuotaExceededBody(blocked.map((entry) => entry.quota)));
            }
          }
        }

        if (!ConcurrencyTracker.getInstance().acquire(providerSlug, rawModel)) {
          usageRecord.responseStatus = 'concurrency_exceeded';
          usageRecord.durationMs = Date.now() - startTime;
          usageStorage.saveRequest(usageRecord as UsageRecord);
          debugManager.flush(requestId);
          return reply.code(429).send({
            error: { message: 'Provider concurrency limit exceeded', type: 'concurrency_exceeded' },
          });
        }

        const abortController = new AbortController();
        const disconnectDetection = wireEarlyDisconnectDetection(request, abortController);
        const timeoutMs = provider.timeoutMs ?? (getConfig().timeout?.defaultSeconds ?? 300) * 1000;
        const timeout = setTimeout(() => {
          abortController.abort(new DOMException('Upstream request timed out', 'TimeoutError'));
        }, timeoutMs);
        timeout.unref?.();

        try {
          const upstreamUrl = buildRawUpstreamUrl(provider.raw_passthrough.base_url, rawSuffix);
          const upstreamHeaders = buildRawUpstreamHeaders(
            request.headers,
            provider,
            body ? body.byteLength : null
          );
          const upstream = await executeRawUpstreamRequest({
            url: upstreamUrl,
            method: request.method,
            headers: upstreamHeaders,
            body,
            signal: abortController.signal,
          });

          const responseHeaders = filterRawResponseHeaders(upstream.headers);
          const quotaHeaders = quotaEnforcer
            ? buildQuotaHeaders((request as any).quotaContext ?? null, providerSlug, rawModel)
            : {};
          if (
            !Object.keys(responseHeaders).some(
              (name) => name.toLowerCase() === 'x-plexus-request-id'
            )
          ) {
            responseHeaders['x-plexus-request-id'] = requestId;
          }
          if (!Object.keys(responseHeaders).some((name) => name.toLowerCase() === 'x-request-id')) {
            responseHeaders['x-request-id'] = requestId;
          }
          for (const [name, value] of Object.entries(quotaHeaders)) {
            if (!Object.keys(responseHeaders).some((existing) => existing.toLowerCase() === name)) {
              responseHeaders[name] = value;
            }
          }

          usageRecord.isStreamed =
            upstream.headers['content-type']?.includes('text/event-stream') ?? false;
          usageRecord.ttftMs = Date.now() - startTime;
          debugManager.addResponseMeta(
            requestId,
            upstream.statusCode ?? 502,
            Object.fromEntries(
              Object.entries(responseHeaders).map(([name, value]) => [
                name,
                Array.isArray(value) ? value.join(', ') : value,
              ])
            )
          );

          reply.hijack();
          reply.raw.writeHead(upstream.statusCode ?? 502, responseHeaders);
          reply.raw.flushHeaders();

          const rawResponseInspector = new DebugLoggingInspector(requestId, 'raw').createInspector(
            observedApiType
          );
          const transformedResponseInspector = new DebugLoggingInspector(
            requestId,
            'transformed'
          ).createInspector(observedApiType);
          const errorResponseChunks: Buffer[] = [];
          const captureErrorBody = (upstream.statusCode ?? 502) >= 400;
          const onClose = () => {
            abortController.abort(new DOMException('Client disconnected', 'AbortError'));
            upstream.destroy();
          };
          reply.raw.once('close', onClose);

          try {
            for await (const chunk of upstream) {
              const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              rawResponseInspector.write(buffer);
              transformedResponseInspector.write(buffer);
              if (captureErrorBody) errorResponseChunks.push(buffer);
              if (!reply.raw.write(buffer)) await waitForDrainOrClose(reply);
            }
          } finally {
            reply.raw.removeListener('close', onClose);
          }

          rawResponseInspector.end();
          transformedResponseInspector.end();
          await Promise.all([
            finished(rawResponseInspector),
            finished(transformedResponseInspector),
          ]);
          const reconstructed = debugManager.getReconstructedRawResponse(requestId);
          applyObservedUsage(
            usageRecord,
            reconstructed,
            observedApiType,
            resolveRawModelPricing(provider, requestedModel),
            provider.discount
          );
          const capturedErrorResponse = captureErrorBody
            ? Buffer.concat(errorResponseChunks)
            : null;
          if ((upstream.statusCode ?? 502) >= 400) {
            const upstreamError = new Error(`Upstream returned HTTP ${upstream.statusCode ?? 502}`);
            usageStorage.saveError(
              requestId,
              upstreamError,
              {
                apiType: 'raw',
                provider: providerSlug,
                path: rawSuffix,
                statusCode: upstream.statusCode ?? 502,
                providerResponse: capturedErrorResponse
                  ? formatDebugBody(capturedErrorResponse, upstream.headers['content-type'])
                  : null,
                providerResponseHeaders: responseHeaders,
              },
              (request as any).keyName
            );
          }
          debugManager.flush(requestId);
          saveCompletedUsage(usageStorage, usageRecord, startTime, upstream.statusCode ?? 502);
          reply.raw.end();
        } catch (error: any) {
          const isTimeout = abortController.signal.reason?.name === 'TimeoutError';
          const isClientDisconnect = abortController.signal.reason?.name === 'AbortError';
          usageRecord.responseStatus = isTimeout
            ? 'timeout'
            : isClientDisconnect
              ? 'cancelled'
              : 'error';
          usageRecord.durationMs = Date.now() - startTime;
          usageStorage.saveRequest(usageRecord as UsageRecord);
          if (!isClientDisconnect) {
            usageStorage.saveError(requestId, error, {
              apiType: 'raw',
              provider: providerSlug,
              path: rawSuffix,
            });
          }
          debugManager.flush(requestId);
          if (isClientDisconnect) {
            logger.info(`Raw passthrough client disconnected for ${providerSlug}${rawSuffix}`);
          } else {
            logger.error(`Raw passthrough failed for ${providerSlug}${rawSuffix}`, error);
          }
          if (!reply.sent) {
            return reply.code(isTimeout ? 504 : 502).send({
              error: {
                message: isTimeout ? 'Upstream request timed out' : 'Upstream request failed',
                type: isTimeout ? 'upstream_timeout' : 'upstream_error',
              },
            });
          }
          if (!reply.raw.writableEnded) reply.raw.end();
        } finally {
          if (quotaEnforcer) {
            await recordQuotaUsage(
              (request as any).keyName,
              providerSlug,
              rawModel,
              {
                tokensInput: usageRecord.tokensInput,
                tokensOutput: usageRecord.tokensOutput,
                tokensCached: usageRecord.tokensCached,
                tokensCacheWrite: usageRecord.tokensCacheWrite,
                tokensReasoning: usageRecord.tokensReasoning,
                costTotal: usageRecord.costTotal,
              },
              quotaEnforcer
            );
          }
          clearTimeout(timeout);
          disconnectDetection.cleanup();
          ConcurrencyTracker.getInstance().release(providerSlug, rawModel);
        }
      },
    });
  });
}
