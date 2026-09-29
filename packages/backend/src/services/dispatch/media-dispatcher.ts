import {
  UnifiedDecisionsRequest,
  UnifiedDecisionsResponse,
  UnifiedImageGenerationRequest,
  UnifiedImageGenerationResponse,
  UnifiedSpeechRequest,
  UnifiedSpeechResponse,
  UnifiedTranscriptionRequest,
  UnifiedTranscriptionResponse,
} from '../../types/unified';
import { getConfig, getProviderTypes } from '../../config';
import { logger } from '../../utils/logger';
import { applyKeyAccessPolicy } from '../routing/key-access-policy';
import { Router, type RouteResult } from '../routing/router';
import { CooldownManager } from '../runtime/cooldown-manager';
import { ConcurrencyTracker } from '../runtime/concurrency-tracker';
import { DebugManager } from '../observability/debug-manager';
import { EmbeddingsTransformerFactory } from './embeddings-transformer-factory';
import { ImageGenerationTransformerFactory } from './image-transformer-factory';
import {
  resolveImageProviderBaseUrl,
  selectTargetApiType,
} from '../providers/provider-api-selection';
import { isOAuthRoute } from '../oauth/oauth-dispatcher';
import { prepareCodexImagesDispatch } from '../oauth/oauth-native-request';
import { getApiBaseType } from '../../utils/api-format';
import type { ImageGenerationTransformer } from '../../types/image-transformer';
import type { RetryAttemptRecord } from './dispatcher-types';
import {
  createAttemptTimeout,
  type AttemptTimeout,
  type ResolveTimeoutMs,
} from './upstream-execution';
import { admitProvider } from '../runtime/provider-admission';
import {
  OPENROUTER_DECISIONS_API_TYPE,
  SYSTEMONE_API_TYPE,
  SYSTEMONE_ENDPOINT,
  TYPESAFE_DECISIONS_API_TYPE,
  parseDecisionsUpstreamResponse,
} from '../../types/decisions';

function imageRoutingError(message: string): Error {
  const error = new Error(message) as any;
  error.routingContext = { statusCode: 400, code: 'invalid_request_error' };
  return error;
}

function decisionsRoutingError(message: string): Error {
  const error = new Error(message) as any;
  error.routingContext = { statusCode: 400, code: 'invalid_request_error' };
  return error;
}

/** Upstream path for a decisions target; anything else is misconfiguration. */
function decisionsEndpointForTarget(targetApiType: string | undefined): string {
  switch (getApiBaseType(targetApiType ?? '')) {
    case SYSTEMONE_API_TYPE:
    // Deprecated aliases route to the same System One endpoint. Stored
    // configs are normalized onto `systemone` at load time (see
    // normalizeSystemOneProviderConfig), so these cases are a safety net.
    case OPENROUTER_DECISIONS_API_TYPE:
    case TYPESAFE_DECISIONS_API_TYPE:
      return SYSTEMONE_ENDPOINT;
    default:
      throw decisionsRoutingError(
        `Target API type '${targetApiType}' cannot serve decisions requests`
      );
  }
}

/**
 * Builds the upstream Decisions body. Only the core fields (`model`,
 * `state`, `questions`) are sent: every upstream serves the same System One
 * protocol. The routed model always wins: neither the client body nor
 * operator `extraBody` may override it, and the legacy OpenRouter-only
 * routing/observability fields (`provider`, `session_id`, `trace`, `user`)
 * are stripped even when an operator extra introduces them.
 */
function buildDecisionsUpstreamPayload(
  request: UnifiedDecisionsRequest,
  route: RouteResult
): Record<string, any> {
  const payload: Record<string, any> = {
    model: route.model,
    state: request.state,
    questions: request.questions,
  };

  const extraBodies = [
    route.config.extraBody,
    route.modelConfig?.extraBody,
    route.canonicalModel ? getConfig().models?.[route.canonicalModel]?.extraBody : undefined,
  ];
  for (const extraBody of extraBodies) {
    if (!extraBody) continue;
    // Operator extras may carry defaults, but never the caller's core
    // fields (`model` is the routed model; `state`/`questions` are the
    // caller's evaluation input) nor the removed OpenRouter-only
    // routing/observability fields (`provider`, `session_id`, `trace`,
    // `user`), which no upstream receives anymore.
    const {
      model: _model,
      provider: _provider,
      state: _state,
      questions: _questions,
      session_id: _sessionId,
      trace: _trace,
      user: _user,
      ...rest
    } = extraBody;
    Object.assign(payload, rest);
  }

  // The routed model and the caller's evaluation input always win over
  // operator extras.
  payload.model = route.model;
  payload.state = request.state;
  payload.questions = request.questions;
  return payload;
}

/** Stop this attempt's wait without cancelling credential work shared by other requests. */
function waitForImageSetup<T>(setup: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    setup.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * Resolves the upstream endpoint + auth for one image dispatch.
 *
 * Two seams, not one. An API-key provider carries both its own base URL and its
 * own key. An OAuth provider carries neither: `api_base_url` is the `oauth://`
 * placeholder (which `resolveProviderBaseUrl` refuses to dispatch) and
 * `api_key` is a stub, so the real endpoint and Bearer token come from the
 * OAuth manager instead. Codex Images is the only OAuth image backend today,
 * so any other OAuth/image-target pairing is a caller configuration error
 * rather than a dispatch. `route.config.headers` still win last on both paths.
 */
async function resolveImageDispatchTarget(
  route: RouteResult,
  targetApiType: string,
  transformer: ImageGenerationTransformer,
  signal: AbortSignal
): Promise<{ baseUrl: string; headers: Record<string, string> }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  let baseUrl: string;

  if (isOAuthRoute(route, targetApiType)) {
    const oauthProvider = route.config.oauth_provider || route.provider;
    if (oauthProvider !== 'openai-codex' || getApiBaseType(targetApiType) !== 'codex-images') {
      throw imageRoutingError(
        `OAuth provider ${oauthProvider} cannot serve image target ${targetApiType}`
      );
    }
    const prepared = await waitForImageSetup(
      prepareCodexImagesDispatch({
        modelId: route.model,
        oauthAccountId: route.config.oauth_account?.trim(),
      }),
      signal
    );
    baseUrl = prepared.baseUrl;
    Object.assign(headers, prepared.headers);
  } else {
    baseUrl = resolveImageProviderBaseUrl(route, targetApiType);
    if (route.config.api_key) {
      if (transformer.getAuthHeaders) {
        transformer.getAuthHeaders(route.config.api_key, headers);
      } else {
        headers['Authorization'] = `Bearer ${route.config.api_key}`;
      }
    }
  }

  if (route.config.headers) {
    Object.assign(headers, route.config.headers);
  }

  return { baseUrl, headers };
}

const BASE64_DATA_URL_PATTERN = /^data:([^;,]*);base64,([\s\S]*)$/;

function isPlainObject(value: unknown): value is Record<string, any> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Decoded byte count of a base64 string, without allocating the buffer. */
function base64ByteLength(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

/**
 * Summarizes a multipart body for the debug trace: field name → the string
 * value (data URLs redacted as everywhere else) or `"<mime>;[N bytes]"` for a
 * Blob/File part. A `FormData` has no enumerable own properties, so without
 * this it serializes as `{}` and the debug copy of every OpenAI-compatible
 * edit loses its entire summary. Repeated field names collapse to an array.
 */
function summarizeFormData(form: FormData): Record<string, any> {
  const summary: Record<string, any> = {};
  // The ambient FormData iterator types entries as strings; Blob parts are
  // just as legal on the wire (and are exactly what needs summarizing).
  for (const [key, entry] of form.entries() as Iterable<[string, string | Blob]>) {
    const value =
      typeof entry === 'string'
        ? redactImageDataUrls(entry)
        : `${entry.type || 'application/octet-stream'};[${entry.size} bytes]`;
    const existing = summary[key];
    if (existing === undefined) summary[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else summary[key] = [existing, value];
  }
  return summary;
}

/**
 * Returns a copy of an image payload with base64 data URLs replaced by a size
 * summary. A Codex edit body can carry five multi-MB reference images; storing
 * those verbatim in the debug trace bloats every captured request for no
 * diagnostic gain. Only the debug copy is redacted — the wire body is untouched.
 */
function redactImageDataUrls(value: any): any {
  if (typeof value === 'string') {
    const match = BASE64_DATA_URL_PATTERN.exec(value);
    if (!match) return value;
    return `data:${match[1]};base64,[${base64ByteLength(match[2]!)} bytes]`;
  }
  if (Array.isArray(value)) return value.map((item) => redactImageDataUrls(item));
  if (value instanceof FormData) return summarizeFormData(value);
  if (isPlainObject(value)) {
    const copy: Record<string, any> = {};
    for (const [key, item] of Object.entries(value)) copy[key] = redactImageDataUrls(item);
    return copy;
  }
  // Buffers and other exotic payloads pass through untouched.
  return value;
}

function applyImageProviderPreferences(
  candidates: RouteResult[],
  request: UnifiedImageGenerationRequest
): RouteResult[] {
  const preferences = request.provider;
  if (!preferences) return candidates;

  if (preferences.sort !== undefined) {
    throw imageRoutingError('provider.sort is not supported for image routing');
  }

  const ignored = new Set(preferences.ignore ?? []);
  let eligible = candidates.filter((candidate) => !ignored.has(candidate.provider));

  if (preferences.only && preferences.only.length > 0) {
    const allowed = new Set(preferences.only);
    eligible = eligible.filter((candidate) => allowed.has(candidate.provider));
    if (eligible.length === 0) {
      throw imageRoutingError('provider.only did not match any configured image target');
    }
  }

  if (preferences.order && preferences.order.length > 0) {
    const order = new Map(preferences.order.map((provider, index) => [provider, index]));
    eligible = eligible
      .map((candidate, index) => ({
        candidate,
        index,
        rank: order.get(candidate.provider) ?? Number.MAX_SAFE_INTEGER,
      }))
      .sort((left, right) => left.rank - right.rank || left.index - right.index)
      .map(({ candidate }) => candidate);
  }

  if (eligible.length === 0) {
    throw imageRoutingError('Image provider preferences excluded every configured target');
  }
  return eligible;
}

function mergeImagePayload(payload: any, extraBody: Record<string, any> | undefined): any {
  if (!extraBody) return payload;
  if (!(payload instanceof FormData)) return { ...payload, ...extraBody };

  for (const [key, value] of Object.entries(extraBody)) {
    if (value === undefined || value === null) continue;
    payload.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  return payload;
}

const RESERVED_IMAGE_PROVIDER_OPTION_KEYS = new Set([
  'model',
  'prompt',
  'n',
  'resolution',
  'aspect_ratio',
  'size',
  'quality',
  'output_format',
  'background',
  'output_compression',
  'seed',
  'input_references',
  'image',
  'mask',
  'response_format',
  'stream',
  'provider',
  'headers',
  'authorization',
  'api_key',
  'base_url',
  'endpoint',
]);

function providerImageOptions(
  request: UnifiedImageGenerationRequest,
  provider: string
): Record<string, any> | undefined {
  const options = request.provider?.options;
  if (!options || typeof options !== 'object' || Array.isArray(options)) return undefined;
  const scoped = options[provider];
  if (!scoped || typeof scoped !== 'object' || Array.isArray(scoped)) return undefined;

  const sanitized = Object.fromEntries(
    Object.entries(scoped).filter(([key]) => !RESERVED_IMAGE_PROVIDER_OPTION_KEYS.has(key))
  );
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

interface MediaDispatchHost {
  buildCancelledError(signal: AbortSignal): Error;
  buildTimeoutError(): Error;
  resolveBaseUrl(route: RouteResult, apiType: string): string;
  executeProviderRequest(
    url: string,
    headers: Record<string, string>,
    payload: any,
    signal?: AbortSignal
  ): Promise<Response>;
  handleProviderError(...args: any[]): Promise<never>;
  parseJsonResponseBody(...args: any[]): Promise<any>;
  extractResponseHeaders(response: Response): Record<string, string>;
  applyQuotaFilter(
    request: any,
    candidates: RouteResult[],
    retryHistory: RetryAttemptRecord[],
    apiType?: string
  ): RouteResult[];
  appendSkippedAttempt(...args: any[]): void;
  appendSuccessAttempt(...args: any[]): void;
  appendFailureAttempt(...args: any[]): void;
  attachAttemptMetadata(...args: any[]): void;
  buildAllTargetsFailedError(...args: any[]): Error;
  emitRoutingUpdate(...args: any[]): void;
  recordAttemptMetric(...args: any[]): Promise<void>;
  saveIntermediateError(...args: any[]): void;
  formatFailureReason(...args: any[]): string;
  isRetryableStatus(...args: any[]): boolean;
  isRetryableNetworkError(...args: any[]): boolean;
  probeStreamingStart(...args: any[]): Promise<any>;
}

export class MediaDispatcher {
  constructor(private readonly host: MediaDispatchHost) {}

  /**
   * Dispatch embeddings request to provider
   * Uses EmbeddingsTransformerFactory for provider-type-aware:
   * - URL construction (e.g. Gemini /v1beta/models/{model}:embedContent)
   * - Auth headers (e.g. x-goog-api-key for Gemini)
   * - Request/response transformation
   */
  async dispatchEmbeddings(request: any): Promise<any> {
    const host = this.host;
    const config = getConfig();
    const failover = config.failover;
    const failoverEnabled = failover?.enabled !== false;

    let candidates = await Router.resolveCandidates(request.model, 'embeddings');
    if (candidates.length === 0) {
      const singleRoute = await Router.resolve(request.model, 'embeddings');
      candidates = [singleRoute];
    }

    candidates = applyKeyAccessPolicy(request, candidates, 'embeddings');

    const retryHistory: RetryAttemptRecord[] = [];
    candidates = host.applyQuotaFilter(request, candidates, retryHistory, 'embeddings');

    const targets = failoverEnabled ? candidates : [candidates[0]!];
    const attemptedProviders: string[] = [];
    let lastError: any = null;

    for (let i = 0; i < targets.length; i++) {
      const route = targets[i]!;

      // Re-check cooldown status before attempting this target
      const isHealthy = await CooldownManager.getInstance().isProviderHealthy(
        route.provider,
        route.model
      );
      if (!isHealthy) {
        logger.warn(`Skipping ${route.provider}/${route.model} - provider is on cooldown`);
        lastError = new Error(`Provider ${route.provider}/${route.model} is on cooldown`);
        host.appendSkippedAttempt(
          retryHistory,
          route,
          `Provider ${route.provider}/${route.model} is on cooldown`,
          'embeddings'
        );
        continue;
      }

      // Acquire concurrency slot before upstream request
      const acquired = ConcurrencyTracker.getInstance().acquire(route.provider, route.model);
      if (!acquired) {
        logger.warn(`Skipping ${route.provider}/${route.model} - concurrency limit exceeded`);
        lastError = new Error(
          `Provider ${route.provider}/${route.model} concurrency limit exceeded`
        );
        host.appendSkippedAttempt(
          retryHistory,
          route,
          `Provider ${route.provider}/${route.model} concurrency limit exceeded`,
          'embeddings'
        );
        continue;
      }

      attemptedProviders.push(`${route.provider}/${route.model}`);

      let released = false;
      const doRelease = () => {
        if (!released) {
          released = true;
          ConcurrencyTracker.getInstance().release(route.provider, route.model);
        }
      };

      host.emitRoutingUpdate(request.requestId, route);

      try {
        const providerTypes = getProviderTypes(route.config);
        const transformer = EmbeddingsTransformerFactory.resolveTransformer(providerTypes);
        const requestWithModel = { ...request, model: route.model };

        const baseUrl = host.resolveBaseUrl(route, 'embeddings');
        const endpoint = transformer.getEndpoint
          ? transformer.getEndpoint(requestWithModel)
          : transformer.defaultEndpoint;
        const url = `${baseUrl}${endpoint}`;

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        };
        if (route.config.api_key) {
          if (transformer.getAuthHeaders) {
            transformer.getAuthHeaders(route.config.api_key, headers);
          } else {
            headers['Authorization'] = `Bearer ${route.config.api_key}`;
          }
        }
        if (route.config.headers) {
          Object.assign(headers, route.config.headers);
        }

        let payload = await transformer.transformRequest(requestWithModel);
        if (route.config.extraBody) {
          Object.assign(payload, route.config.extraBody);
        }
        // Merge model-level extraBody (overrides provider level)
        if (route.modelConfig?.extraBody) {
          Object.assign(payload, route.modelConfig.extraBody);
        }
        // Merge alias-level extraBody (overrides provider and model level)
        if (route.canonicalModel) {
          const aliasConfig = getConfig().models?.[route.canonicalModel];
          if (aliasConfig?.extraBody) {
            Object.assign(payload, aliasConfig.extraBody);
          }
        }

        logger.info(`Dispatching embeddings ${request.model} to ${route.provider}:${route.model}`);
        logger.silly('Embeddings Request Payload', payload);

        if (request.requestId) {
          DebugManager.getInstance().addTransformedRequest(request.requestId, payload);
        }

        const response = await host.executeProviderRequest(url, headers, payload);

        // Capture response metadata for debug logging
        if (request.requestId) {
          DebugManager.getInstance().addResponseMeta(
            request.requestId,
            response.status,
            host.extractResponseHeaders(response)
          );
        }

        if (!response.ok) {
          const errorText = await response.text();
          logger.error(`Embeddings request failed: ${url}`, {
            status: response.status,
            error: errorText,
          });
          const canRetry =
            failoverEnabled &&
            i < targets.length - 1 &&
            host.isRetryableStatus(response.status, failover?.retryableStatusCodes || []);

          try {
            await host.handleProviderError(
              response,
              route,
              errorText,
              url,
              headers,
              'embeddings',
              request.requestId
            );
          } catch (e: any) {
            lastError = e;
            host.appendFailureAttempt(retryHistory, route, e, 'embeddings', canRetry);
            if (canRetry) {
              await host.recordAttemptMetric(route, request.requestId, false);
              // Only mark as failed if cooldown was actually triggered (not a caller error)
              if (e?.routingContext?.cooldownTriggered) {
                CooldownManager.getInstance().markProviderFailure(
                  route.provider,
                  route.model,
                  undefined,
                  host.formatFailureReason(e, true)
                );
              }
              host.saveIntermediateError(request.requestId, 'embeddings', e);
              logger.warn(
                `Failover: retrying embeddings after HTTP ${response.status} from ${route.provider}/${route.model}`
              );
              continue;
            }
            throw e;
          }
        }

        const rawResponseBody = await host.parseJsonResponseBody(
          response,
          request.requestId,
          route,
          'embeddings'
        );
        logger.silly('Embeddings Response Payload', rawResponseBody);

        if (request.requestId) {
          DebugManager.getInstance().addRawResponse(request.requestId, rawResponseBody);
        }
        const transformedResponse = await transformer.transformResponse(
          rawResponseBody,
          requestWithModel
        );
        const enrichedResponse: any = {
          ...transformedResponse,
          plexus: {
            provider: route.provider,
            model: route.model,
            apiType: 'embeddings',
            isPassthrough: true,
            pricing: route.modelConfig?.pricing,
            providerDiscount: route.config.discount,
            canonicalModel: route.canonicalModel,
            config: route.config,
          },
        };

        await host.recordAttemptMetric(route, request.requestId, true);
        CooldownManager.getInstance().markProviderSuccess(route.provider, route.model);
        host.appendSuccessAttempt(retryHistory, route, 'embeddings');
        host.attachAttemptMetadata(
          enrichedResponse,
          attemptedProviders,
          retryHistory,
          route,
          'embeddings'
        );
        doRelease();
        return enrichedResponse;
      } catch (error: any) {
        lastError = error;
        // handleProviderError already called markProviderFailure for HTTP errors.
        // Only call it here for pure network/transport errors (no statusCode).
        if (error?.routingContext?.statusCode === undefined) {
          CooldownManager.getInstance().markProviderFailure(
            route.provider,
            route.model,
            undefined,
            host.formatFailureReason(error)
          );
        }
        await host.recordAttemptMetric(route, request.requestId, false);

        const canRetryNetwork =
          failoverEnabled &&
          i < targets.length - 1 &&
          host.isRetryableNetworkError(error, failover?.retryableErrors || []);

        host.appendFailureAttempt(retryHistory, route, error, 'embeddings', canRetryNetwork);

        if (canRetryNetwork) {
          host.saveIntermediateError(request.requestId, 'embeddings', error);
          logger.warn(
            `Failover: retrying embeddings after network/transport error from ${route.provider}/${route.model}: ${error.message}`
          );
          doRelease();
          continue;
        }

        doRelease();
        throw host.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
      }
    }

    throw host.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
  }

  /**
   * Dispatches audio transcription requests
   * Handles multipart/form-data file uploads to OpenAI-compatible transcription endpoints
   */
  async dispatchTranscription(
    request: UnifiedTranscriptionRequest
  ): Promise<UnifiedTranscriptionResponse> {
    const host = this.host;
    const { TranscriptionsTransformer } = await import('../../transformers/transcriptions');
    const transformer = new TranscriptionsTransformer();

    const config = getConfig();
    const failover = config.failover;
    const failoverEnabled = failover?.enabled !== false;

    let candidates = await Router.resolveCandidates(request.model, 'transcriptions');
    if (candidates.length === 0) {
      const singleRoute = await Router.resolve(request.model, 'transcriptions');
      candidates = [singleRoute];
    }

    candidates = applyKeyAccessPolicy(request, candidates, 'transcriptions');

    const retryHistory: RetryAttemptRecord[] = [];
    candidates = host.applyQuotaFilter(request, candidates, retryHistory, 'transcriptions');

    const targets = failoverEnabled ? candidates : [candidates[0]!];
    const attemptedProviders: string[] = [];
    let lastError: any = null;

    for (let i = 0; i < targets.length; i++) {
      const route = targets[i]!;

      // Re-check cooldown status before attempting this target
      const isHealthy = await CooldownManager.getInstance().isProviderHealthy(
        route.provider,
        route.model
      );
      if (!isHealthy) {
        logger.warn(`Skipping ${route.provider}/${route.model} - provider is on cooldown`);
        lastError = new Error(`Provider ${route.provider}/${route.model} is on cooldown`);
        host.appendSkippedAttempt(
          retryHistory,
          route,
          `Provider ${route.provider}/${route.model} is on cooldown`,
          'transcriptions'
        );
        continue;
      }

      // Acquire concurrency slot before upstream request
      const acquired = ConcurrencyTracker.getInstance().acquire(route.provider, route.model);
      if (!acquired) {
        logger.warn(`Skipping ${route.provider}/${route.model} - concurrency limit exceeded`);
        lastError = new Error(
          `Provider ${route.provider}/${route.model} concurrency limit exceeded`
        );
        host.appendSkippedAttempt(
          retryHistory,
          route,
          `Provider ${route.provider}/${route.model} concurrency limit exceeded`,
          'transcriptions'
        );
        continue;
      }

      attemptedProviders.push(`${route.provider}/${route.model}`);

      let released = false;
      const doRelease = () => {
        if (!released) {
          released = true;
          ConcurrencyTracker.getInstance().release(route.provider, route.model);
        }
      };

      host.emitRoutingUpdate(request.requestId, route);

      try {
        const baseUrl = host.resolveBaseUrl(route, 'transcriptions');
        const url = `${baseUrl}/audio/transcriptions`;

        const headers: Record<string, string> = {};

        if (route.config.api_key) {
          headers['Authorization'] = `Bearer ${route.config.api_key}`;
        }

        if (route.config.headers) {
          Object.assign(headers, route.config.headers);
        }

        const formData = await transformer.transformRequest({
          ...request,
          model: route.model,
        });

        logger.info(
          `Dispatching transcription ${request.model} to ${route.provider}:${route.model}`
        );
        logger.silly('Transcription Request', { model: request.model, filename: request.filename });

        if (request.requestId) {
          DebugManager.getInstance().addTransformedRequest(request.requestId, {
            model: request.model,
            filename: request.filename,
            mimeType: request.mimeType,
            language: request.language,
            prompt: request.prompt,
            response_format: request.response_format,
            temperature: request.temperature,
          });
        }

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: formData,
        });

        // Capture response metadata for debug logging
        if (request.requestId) {
          DebugManager.getInstance().addResponseMeta(
            request.requestId,
            response.status,
            host.extractResponseHeaders(response)
          );
        }

        if (!response.ok) {
          const errorText = await response.text();
          const canRetry =
            failoverEnabled &&
            i < targets.length - 1 &&
            host.isRetryableStatus(response.status, failover?.retryableStatusCodes || []);

          try {
            await host.handleProviderError(
              response,
              route,
              errorText,
              url,
              headers,
              'transcriptions',
              request.requestId
            );
          } catch (e: any) {
            lastError = e;
            host.appendFailureAttempt(retryHistory, route, e, 'transcriptions', canRetry);
            if (canRetry) {
              await host.recordAttemptMetric(route, request.requestId, false);
              // Only mark as failed if cooldown was actually triggered (not a caller error)
              if (e?.routingContext?.cooldownTriggered) {
                CooldownManager.getInstance().markProviderFailure(
                  route.provider,
                  route.model,
                  undefined,
                  host.formatFailureReason(e, true)
                );
              }
              host.saveIntermediateError(request.requestId, 'transcriptions', e);
              logger.warn(
                `Failover: retrying transcription after HTTP ${response.status} from ${route.provider}/${route.model}`
              );
              continue;
            }
            throw e;
          }
        }

        const responseFormat = request.response_format || 'json';
        let responseBody: any;

        if (responseFormat === 'text') {
          responseBody = await response.text();
        } else {
          responseBody = await response.json();
        }

        logger.silly('Transcription Response', responseBody);

        if (request.requestId) {
          DebugManager.getInstance().addRawResponse(request.requestId, responseBody);
        }

        const unifiedResponse = await transformer.transformResponse(responseBody, responseFormat);

        unifiedResponse.plexus = {
          provider: route.provider,
          model: route.model,
          apiType: 'transcriptions',
          pricing: route.modelConfig?.pricing,
          providerDiscount: route.config.discount,
          canonicalModel: route.canonicalModel,
          config: route.config,
        };

        await host.recordAttemptMetric(route, request.requestId, true);
        host.appendSuccessAttempt(retryHistory, route, 'transcriptions');
        host.attachAttemptMetadata(
          unifiedResponse,
          attemptedProviders,
          retryHistory,
          route,
          'transcriptions'
        );
        doRelease();
        return unifiedResponse;
      } catch (error: any) {
        lastError = error;
        doRelease();
        // handleProviderError already called markProviderFailure for HTTP errors.
        // Only call it here for pure network/transport errors (no statusCode).
        if (error?.routingContext?.statusCode === undefined) {
          CooldownManager.getInstance().markProviderFailure(
            route.provider,
            route.model,
            undefined,
            host.formatFailureReason(error)
          );
        }
        await host.recordAttemptMetric(route, request.requestId, false);

        const canRetryNetwork =
          failoverEnabled &&
          i < targets.length - 1 &&
          host.isRetryableNetworkError(error, failover?.retryableErrors || []);

        host.appendFailureAttempt(retryHistory, route, error, 'transcriptions', canRetryNetwork);

        if (canRetryNetwork) {
          host.saveIntermediateError(request.requestId, 'transcriptions', error);
          logger.warn(
            `Failover: retrying transcription after network/transport error from ${route.provider}/${route.model}: ${error.message}`
          );
          continue;
        }

        throw host.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
      }
    }

    throw host.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
  }

  /**
   * Dispatches text-to-speech requests
   * Handles JSON body requests to OpenAI-compatible speech endpoints
   * Supports both binary audio responses and SSE streaming
   */
  async dispatchSpeech(request: UnifiedSpeechRequest): Promise<UnifiedSpeechResponse> {
    const host = this.host;
    const { SpeechTransformer } = await import('../../transformers/speech');
    const transformer = new SpeechTransformer();

    const config = getConfig();
    const failover = config.failover;
    const failoverEnabled = failover?.enabled !== false;

    let candidates = await Router.resolveCandidates(request.model, 'speech');
    if (candidates.length === 0) {
      const singleRoute = await Router.resolve(request.model, 'speech');
      candidates = [singleRoute];
    }

    candidates = applyKeyAccessPolicy(request, candidates, 'speech');

    const retryHistory: RetryAttemptRecord[] = [];
    candidates = host.applyQuotaFilter(request, candidates, retryHistory, 'speech');

    const targets = failoverEnabled ? candidates : [candidates[0]!];
    const attemptedProviders: string[] = [];
    let lastError: any = null;

    for (let i = 0; i < targets.length; i++) {
      const route = targets[i]!;

      // Re-check cooldown status before attempting this target
      const isHealthy = await CooldownManager.getInstance().isProviderHealthy(
        route.provider,
        route.model
      );
      if (!isHealthy) {
        logger.warn(`Skipping ${route.provider}/${route.model} - provider is on cooldown`);
        lastError = new Error(`Provider ${route.provider}/${route.model} is on cooldown`);
        host.appendSkippedAttempt(
          retryHistory,
          route,
          `Provider ${route.provider}/${route.model} is on cooldown`,
          'speech'
        );
        continue;
      }

      // Acquire concurrency slot before upstream request
      const acquired = ConcurrencyTracker.getInstance().acquire(route.provider, route.model);
      if (!acquired) {
        logger.warn(`Skipping ${route.provider}/${route.model} - concurrency limit exceeded`);
        lastError = new Error(
          `Provider ${route.provider}/${route.model} concurrency limit exceeded`
        );
        host.appendSkippedAttempt(
          retryHistory,
          route,
          `Provider ${route.provider}/${route.model} concurrency limit exceeded`,
          'speech'
        );
        continue;
      }

      attemptedProviders.push(`${route.provider}/${route.model}`);

      let released = false;
      const doRelease = () => {
        if (!released) {
          released = true;
          ConcurrencyTracker.getInstance().release(route.provider, route.model);
        }
      };

      host.emitRoutingUpdate(request.requestId, route);

      try {
        const baseUrl = host.resolveBaseUrl(route, 'speech');
        const url = `${baseUrl}/audio/speech`;

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };

        if (route.config.api_key) {
          headers['Authorization'] = `Bearer ${route.config.api_key}`;
        }

        if (route.config.headers) {
          Object.assign(headers, route.config.headers);
        }

        const payload = await transformer.transformRequest({
          ...request,
          model: route.model,
        });

        if (route.config.extraBody) {
          Object.assign(payload, route.config.extraBody);
        }

        // Merge model-level extraBody (overrides provider level)
        if (route.modelConfig?.extraBody) {
          Object.assign(payload, route.modelConfig.extraBody);
        }

        // Merge alias-level extraBody (overrides provider level)
        if (route.canonicalModel) {
          const aliasConfig = getConfig().models?.[route.canonicalModel];
          if (aliasConfig?.extraBody) {
            Object.assign(payload, aliasConfig.extraBody);
          }
        }

        logger.info(`Dispatching speech ${request.model} to ${route.provider}:${route.model}`);
        logger.silly('Speech Request Payload', payload);

        if (request.requestId) {
          DebugManager.getInstance().addTransformedRequest(request.requestId, payload);
        }

        const isStreamed = request.stream_format === 'sse';
        const acceptHeader = isStreamed ? 'text/event-stream' : 'audio/*';
        headers['Accept'] = acceptHeader;

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });

        // Capture response metadata for debug logging
        if (request.requestId) {
          DebugManager.getInstance().addResponseMeta(
            request.requestId,
            response.status,
            host.extractResponseHeaders(response)
          );
        }

        if (!response.ok) {
          const errorText = await response.text();
          const canRetry =
            failoverEnabled &&
            i < targets.length - 1 &&
            host.isRetryableStatus(response.status, failover?.retryableStatusCodes || []);

          try {
            await host.handleProviderError(
              response,
              route,
              errorText,
              url,
              headers,
              'speech',
              request.requestId
            );
          } catch (e: any) {
            lastError = e;
            host.appendFailureAttempt(retryHistory, route, e, 'speech', canRetry);
            if (canRetry) {
              await host.recordAttemptMetric(route, request.requestId, false);
              // Only mark as failed if cooldown was actually triggered (not a caller error)
              if (e?.routingContext?.cooldownTriggered) {
                CooldownManager.getInstance().markProviderFailure(
                  route.provider,
                  route.model,
                  undefined,
                  host.formatFailureReason(e, true)
                );
              }
              host.saveIntermediateError(request.requestId, 'speech', e);
              logger.warn(
                `Failover: retrying speech after HTTP ${response.status} from ${route.provider}/${route.model}`
              );
              continue;
            }
            throw e;
          }
        }

        let responseForProcessing = response;
        if (isStreamed) {
          const streamProbe = await host.probeStreamingStart(response, null);

          if (!streamProbe.ok) {
            const error = streamProbe.error;
            lastError = error;

            const canRetry =
              failoverEnabled &&
              i < targets.length - 1 &&
              !streamProbe.streamStarted &&
              (host.isRetryableNetworkError(error, failover?.retryableErrors || []) ||
                (error as any).isStreamError === true);

            if (canRetry) {
              await host.recordAttemptMetric(route, request.requestId, false);
              host.appendFailureAttempt(retryHistory, route, error, 'speech', true);
              // Always mark as failed when retrying — provider couldn't serve this request
              CooldownManager.getInstance().markProviderFailure(
                route.provider,
                route.model,
                (error as any).cooldownDuration,
                error.message
              );
              host.saveIntermediateError(request.requestId, 'speech', error);
              logger.warn(
                `Failover: retrying speech stream before first byte after ${route.provider}/${route.model} failure: ${error.message}`
              );
              continue;
            }

            if ((error as any).isStreamError) {
              CooldownManager.getInstance().markProviderFailure(
                route.provider,
                route.model,
                (error as any).cooldownDuration,
                error.message
              );
            }

            throw error;
          }

          responseForProcessing = streamProbe.response;
        }

        const responseBuffer = Buffer.from(await responseForProcessing.arrayBuffer());
        logger.silly('Speech Response', { size: responseBuffer.length, isStreamed });

        if (request.requestId) {
          DebugManager.getInstance().addRawResponse(request.requestId, {
            size: responseBuffer.length,
            isStreamed,
          });
        }

        const unifiedResponse = await transformer.transformResponse(responseBuffer, {
          stream_format: request.stream_format,
          response_format: request.response_format,
        });

        unifiedResponse.plexus = {
          provider: route.provider,
          model: route.model,
          apiType: 'speech',
          pricing: route.modelConfig?.pricing,
          providerDiscount: route.config.discount,
          canonicalModel: route.canonicalModel,
          config: route.config,
        };

        await host.recordAttemptMetric(route, request.requestId, true);
        host.appendSuccessAttempt(retryHistory, route, 'speech');
        host.attachAttemptMetadata(
          unifiedResponse,
          attemptedProviders,
          retryHistory,
          route,
          'speech'
        );
        doRelease();
        return unifiedResponse;
      } catch (error: any) {
        lastError = error;
        doRelease();
        // handleProviderError already called markProviderFailure for HTTP errors.
        // Only call it here for pure network/transport errors (no statusCode).
        if (error?.routingContext?.statusCode === undefined) {
          CooldownManager.getInstance().markProviderFailure(
            route.provider,
            route.model,
            undefined,
            host.formatFailureReason(error)
          );
        }
        await host.recordAttemptMetric(route, request.requestId, false);

        const canRetryNetwork =
          failoverEnabled &&
          i < targets.length - 1 &&
          host.isRetryableNetworkError(error, failover?.retryableErrors || []);

        host.appendFailureAttempt(retryHistory, route, error, 'speech', canRetryNetwork);

        if (canRetryNetwork) {
          host.saveIntermediateError(request.requestId, 'speech', error);
          logger.warn(
            `Failover: retrying speech after network/transport error from ${route.provider}/${route.model}: ${error.message}`
          );
          continue;
        }

        throw host.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
      }
    }

    throw host.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
  }

  /**
   * Dispatches image generation requests
   * Handles JSON body requests to OpenAI-compatible image generation endpoints
   */
  async dispatchImageGenerations(
    request: UnifiedImageGenerationRequest,
    signal?: AbortSignal,
    resolveTimeoutMs?: ResolveTimeoutMs
  ): Promise<UnifiedImageGenerationResponse> {
    const host = this.host;
    if (signal?.aborted) throw host.buildCancelledError(signal);

    const config = getConfig();
    const failover = config.failover;
    const failoverEnabled = failover?.enabled !== false;

    let candidates = await Router.resolveCandidates(request.model, 'images');
    if (candidates.length === 0) {
      const singleRoute = await Router.resolve(request.model, 'images');
      candidates = [singleRoute];
    }

    candidates = applyKeyAccessPolicy(request, candidates, 'images');
    candidates = applyImageProviderPreferences(candidates, request);

    const retryHistory: RetryAttemptRecord[] = [];
    candidates = host.applyQuotaFilter(request, candidates, retryHistory, 'images');

    const requestAllowsFallbacks = request.provider?.allow_fallbacks !== false;
    const targets = failoverEnabled && requestAllowsFallbacks ? candidates : [candidates[0]!];
    const attemptedProviders: string[] = [];
    let lastError: any = null;

    for (let i = 0; i < targets.length; i++) {
      const route = targets[i]!;

      if (signal?.aborted) throw host.buildCancelledError(signal);
      const admission = await admitProvider(route);
      if (!admission.admitted) {
        lastError = new Error(admission.reason);
        host.appendSkippedAttempt(retryHistory, route, admission.reason, 'images');
        continue;
      }

      attemptedProviders.push(`${route.provider}/${route.model}`);
      let attemptTimeout: AttemptTimeout | undefined;
      try {
        attemptTimeout = createAttemptTimeout(signal, route.config.timeoutMs, resolveTimeoutMs);
        attemptTimeout.signal.throwIfAborted();
        host.emitRoutingUpdate(request.requestId, route);
        const targetApiType = selectTargetApiType(route, 'images').targetApiType || 'chat';
        const transformer = ImageGenerationTransformerFactory.resolveTransformer(targetApiType);
        const requestWithModel = { ...request, model: route.model };
        const { baseUrl, headers } = await resolveImageDispatchTarget(
          route,
          targetApiType,
          transformer,
          attemptTimeout.signal
        );
        const url = `${baseUrl}${transformer.getEndpoint(requestWithModel)}`;

        attemptTimeout.signal.throwIfAborted();
        let payload = await transformer.transformGenerationRequest(
          requestWithModel,
          attemptTimeout.signal
        );
        attemptTimeout.signal.throwIfAborted();
        payload = mergeImagePayload(payload, route.config.extraBody);
        payload = mergeImagePayload(payload, route.modelConfig?.extraBody);

        if (route.canonicalModel) {
          const aliasConfig = getConfig().models?.[route.canonicalModel];
          payload = mergeImagePayload(payload, aliasConfig?.extraBody);
        }
        payload = mergeImagePayload(payload, providerImageOptions(request, route.provider));

        if (!(payload instanceof FormData)) headers['Content-Type'] = 'application/json';

        logger.info(
          `Dispatching image generation ${request.model} to ${route.provider}:${route.model} via ${targetApiType}`
        );
        // One redacted copy for both sinks: the raw payload can carry several
        // multi-MB base64 data URLs, which belong in neither the log nor the
        // debug trace.
        const debugPayload = redactImageDataUrls(payload);
        logger.silly('Image Generation Request Payload', debugPayload);

        if (request.requestId) {
          DebugManager.getInstance().addTransformedRequest(request.requestId, debugPayload);
        }

        const response = await fetch(url, {
          method: 'POST',
          signal: attemptTimeout.signal,
          headers,
          body: payload instanceof FormData ? payload : JSON.stringify(payload),
        });

        // Capture response metadata for debug logging
        if (request.requestId) {
          DebugManager.getInstance().addResponseMeta(
            request.requestId,
            response.status,
            host.extractResponseHeaders(response)
          );
        }

        // Codex Images tags every response with its own request id; log it so a
        // gateway trace can be correlated with an upstream support ticket.
        const imagegenRequestId = response.headers.get('x-codex-imagegen-request-id');
        if (imagegenRequestId) {
          logger.debug(
            `Codex imagegen request id ${imagegenRequestId} for ${route.provider}/${route.model}`
          );
        }

        if (!response.ok) {
          const errorText = await response.text();
          attemptTimeout.signal.throwIfAborted();
          await host.handleProviderError(
            response,
            route,
            errorText,
            url,
            headers,
            'images',
            request.requestId
          );
        }

        const responseBody = await response.json();
        attemptTimeout.signal.throwIfAborted();
        logger.silly('Image Generation Response', responseBody);

        if (request.requestId) {
          DebugManager.getInstance().addRawResponse(request.requestId, responseBody);
        }

        const unifiedResponse = await transformer.transformGenerationResponse(
          responseBody,
          requestWithModel
        );

        attemptTimeout.signal.throwIfAborted();
        unifiedResponse.plexus = {
          provider: route.provider,
          model: route.model,
          apiType: 'images',
          targetApiType,
          pricing: route.modelConfig?.pricing,
          providerDiscount: route.config.discount,
          canonicalModel: route.canonicalModel,
          config: route.config,
        };

        await host.recordAttemptMetric(route, request.requestId, true);
        host.appendSuccessAttempt(retryHistory, route, 'images');
        host.attachAttemptMetadata(
          unifiedResponse,
          attemptedProviders,
          retryHistory,
          route,
          'images'
        );
        return unifiedResponse;
      } catch (caught: any) {
        if (signal?.aborted) throw host.buildCancelledError(signal);
        const error = attemptTimeout?.isTimedOut() ? host.buildTimeoutError() : caught;
        lastError = error;
        // handleProviderError already called markProviderFailure for HTTP errors.
        // Only call it here for pure network/transport errors (no statusCode).
        if (attemptTimeout?.isTimedOut() || error?.routingContext?.statusCode === undefined) {
          CooldownManager.getInstance().markProviderFailure(
            route.provider,
            route.model,
            undefined,
            host.formatFailureReason(error)
          );
        }
        await host.recordAttemptMetric(route, request.requestId, false);

        const canRetry =
          failoverEnabled &&
          i < targets.length - 1 &&
          (error?.routingContext?.statusCode !== undefined
            ? host.isRetryableStatus(
                error.routingContext.statusCode,
                failover?.retryableStatusCodes || []
              )
            : host.isRetryableNetworkError(error, failover?.retryableErrors || []));

        host.appendFailureAttempt(retryHistory, route, error, 'images', canRetry);

        if (canRetry) {
          host.saveIntermediateError(request.requestId, 'images', error);
          logger.warn(
            `Failover: retrying image generation after failure from ${route.provider}/${route.model}: ${error.message}`
          );
          continue;
        }

        throw host.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
      } finally {
        attemptTimeout?.cleanup();
        admission.release();
      }
    }

    throw host.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
  }

  /**
   * Dispatches buffered Jev-style Decisions requests.
   *
   * Same failover/timeout/admission machinery as the image loop, but the
   * payload is forwarded nearly verbatim: `{model, state, questions}` on the
   * single System One protocol every upstream serves.
   */
  async dispatchDecisions(
    request: UnifiedDecisionsRequest,
    signal?: AbortSignal,
    resolveTimeoutMs?: ResolveTimeoutMs
  ): Promise<UnifiedDecisionsResponse> {
    const host = this.host;
    if (signal?.aborted) throw host.buildCancelledError(signal);

    const config = getConfig();
    const failover = config.failover;
    const failoverEnabled = failover?.enabled !== false;

    let candidates = await Router.resolveCandidates(request.model, 'decisions');
    if (candidates.length === 0) {
      // Strict capability routing: no decisions-capable target is a client
      // configuration error (400), never a silent fallback onto a chat
      // provider. This also covers unknown model names on this endpoint.
      try {
        const singleRoute = await Router.resolve(request.model, 'decisions');
        candidates = [singleRoute];
      } catch {
        throw decisionsRoutingError(
          `No decisions-capable target configured for model '${request.model}'`
        );
      }
    }

    candidates = applyKeyAccessPolicy(request, candidates, 'decisions');

    const retryHistory: RetryAttemptRecord[] = [];
    candidates = host.applyQuotaFilter(request, candidates, retryHistory, 'decisions');

    const targets = failoverEnabled ? candidates : [candidates[0]!];
    const attemptedProviders: string[] = [];
    let lastError: any = null;

    for (let i = 0; i < targets.length; i++) {
      const route = targets[i]!;

      if (signal?.aborted) throw host.buildCancelledError(signal);
      const admission = await admitProvider(route);
      if (!admission.admitted) {
        lastError = new Error(admission.reason);
        host.appendSkippedAttempt(retryHistory, route, admission.reason, 'decisions');
        continue;
      }

      attemptedProviders.push(`${route.provider}/${route.model}`);
      let attemptTimeout: AttemptTimeout | undefined;
      try {
        attemptTimeout = createAttemptTimeout(signal, route.config.timeoutMs, resolveTimeoutMs);
        attemptTimeout.signal.throwIfAborted();
        host.emitRoutingUpdate(request.requestId, route);
        const selectedApiType = selectTargetApiType(route, 'decisions').targetApiType;
        if (!selectedApiType) {
          throw decisionsRoutingError('No API type available for decisions routing');
        }
        const targetApiType = selectedApiType;
        const endpoint = decisionsEndpointForTarget(targetApiType);
        const baseUrl = host.resolveBaseUrl(route, targetApiType);
        const url = `${baseUrl}${endpoint}`;

        attemptTimeout.signal.throwIfAborted();
        const payload = buildDecisionsUpstreamPayload(request, route);
        attemptTimeout.signal.throwIfAborted();

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        };
        if (route.config.api_key) {
          headers['Authorization'] = `Bearer ${route.config.api_key}`;
        }
        if (route.config.headers) {
          Object.assign(headers, route.config.headers);
        }

        logger.info(
          `Dispatching decisions ${request.model} to ${route.provider}:${route.model} via ${targetApiType}`
        );
        logger.silly('Decisions Request Payload', payload);

        if (request.requestId) {
          DebugManager.getInstance().addTransformedRequest(request.requestId, payload);
        }

        const response = await fetch(url, {
          method: 'POST',
          signal: attemptTimeout.signal,
          headers,
          body: JSON.stringify(payload),
        });

        if (request.requestId) {
          DebugManager.getInstance().addResponseMeta(
            request.requestId,
            response.status,
            host.extractResponseHeaders(response)
          );
        }

        if (!response.ok) {
          const errorText = await response.text();
          attemptTimeout.signal.throwIfAborted();
          await host.handleProviderError(
            response,
            route,
            errorText,
            url,
            headers,
            'decisions',
            request.requestId
          );
        }

        const responseBody = await response.json();
        attemptTimeout.signal.throwIfAborted();
        logger.silly('Decisions Response', responseBody);

        if (request.requestId) {
          DebugManager.getInstance().addRawResponse(request.requestId, responseBody);
        }

        // Boundary validation: an unusable upstream payload is a provider
        // failure (502, retryable under default failover policy), never a
        // silent success.
        const parsed = parseDecisionsUpstreamResponse(responseBody);
        attemptTimeout.signal.throwIfAborted();

        const unifiedResponse: UnifiedDecisionsResponse = {
          model: parsed.model,
          answers: parsed.answers,
          usage: parsed.usage,
          ...(parsed.id !== undefined ? { id: parsed.id } : {}),
          ...(parsed.provider !== undefined ? { provider: parsed.provider } : {}),
          plexus: {
            provider: route.provider,
            model: route.model,
            apiType: 'decisions',
            targetApiType,
            pricing: route.modelConfig?.pricing,
            providerDiscount: route.config.discount,
            canonicalModel: route.canonicalModel,
            config: route.config,
          },
        };

        await host.recordAttemptMetric(route, request.requestId, true);
        host.appendSuccessAttempt(retryHistory, route, 'decisions');
        host.attachAttemptMetadata(
          unifiedResponse,
          attemptedProviders,
          retryHistory,
          route,
          'decisions'
        );
        return unifiedResponse;
      } catch (caught: any) {
        if (signal?.aborted) throw host.buildCancelledError(signal);
        const error = attemptTimeout?.isTimedOut() ? host.buildTimeoutError() : caught;
        lastError = error;
        if (attemptTimeout?.isTimedOut() || error?.routingContext?.statusCode === undefined) {
          CooldownManager.getInstance().markProviderFailure(
            route.provider,
            route.model,
            undefined,
            host.formatFailureReason(error)
          );
        }
        await host.recordAttemptMetric(route, request.requestId, false);

        const canRetry =
          failoverEnabled &&
          i < targets.length - 1 &&
          (error?.routingContext?.statusCode !== undefined
            ? host.isRetryableStatus(
                error.routingContext.statusCode,
                failover?.retryableStatusCodes || []
              )
            : host.isRetryableNetworkError(error, failover?.retryableErrors || []));

        host.appendFailureAttempt(retryHistory, route, error, 'decisions', canRetry);

        if (canRetry) {
          host.saveIntermediateError(request.requestId, 'decisions', error);
          logger.warn(
            `Failover: retrying decisions after failure from ${route.provider}/${route.model}: ${error.message}`
          );
          continue;
        }

        throw host.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
      } finally {
        attemptTimeout?.cleanup();
        admission.release();
      }
    }

    throw host.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
  }
}
