import {
  UnifiedImageEditRequest,
  UnifiedImageEditResponse,
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
import type { RetryAttemptRecord } from './dispatcher-types';

interface MediaDispatchHost {
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
    request: UnifiedImageGenerationRequest
  ): Promise<UnifiedImageGenerationResponse> {
    const host = this.host;
    const { ImageTransformer } = await import('../../transformers/image');
    const transformer = new ImageTransformer();

    const config = getConfig();
    const failover = config.failover;
    const failoverEnabled = failover?.enabled !== false;

    let candidates = await Router.resolveCandidates(request.model, 'images');
    if (candidates.length === 0) {
      const singleRoute = await Router.resolve(request.model, 'images');
      candidates = [singleRoute];
    }

    candidates = applyKeyAccessPolicy(request, candidates, 'images');

    const retryHistory: RetryAttemptRecord[] = [];
    candidates = host.applyQuotaFilter(request, candidates, retryHistory, 'images');

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
          'images'
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
          'images'
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
        const baseUrl = host.resolveBaseUrl(route, 'images');
        const url = `${baseUrl}/images/generations`;

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

        const payload = await transformer.transformGenerationRequest({
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

        logger.info(
          `Dispatching image generation ${request.model} to ${route.provider}:${route.model}`
        );
        logger.silly('Image Generation Request Payload', payload);

        if (request.requestId) {
          DebugManager.getInstance().addTransformedRequest(request.requestId, payload);
        }

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
              'images',
              request.requestId
            );
          } catch (e: any) {
            lastError = e;
            host.appendFailureAttempt(retryHistory, route, e, 'images', canRetry);
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
              host.saveIntermediateError(request.requestId, 'images', e);
              logger.warn(
                `Failover: retrying image generation after HTTP ${response.status} from ${route.provider}/${route.model}`
              );
              continue;
            }
            throw e;
          }
        }

        const responseBody = await response.json();
        logger.silly('Image Generation Response', responseBody);

        if (request.requestId) {
          DebugManager.getInstance().addRawResponse(request.requestId, responseBody);
        }

        const unifiedResponse = await transformer.transformGenerationResponse(responseBody);

        unifiedResponse.plexus = {
          provider: route.provider,
          model: route.model,
          apiType: 'images',
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

        host.appendFailureAttempt(retryHistory, route, error, 'images', canRetryNetwork);

        if (canRetryNetwork) {
          host.saveIntermediateError(request.requestId, 'images', error);
          logger.warn(
            `Failover: retrying image generation after network/transport error from ${route.provider}/${route.model}: ${error.message}`
          );
          continue;
        }

        throw host.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
      }
    }

    throw host.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
  }

  /**
   * Dispatches image editing requests
   * Handles multipart/form-data requests to OpenAI-compatible image editing endpoints
   * Supports single image upload with optional mask
   */
  async dispatchImageEdits(request: UnifiedImageEditRequest): Promise<UnifiedImageEditResponse> {
    const host = this.host;
    const { ImageTransformer } = await import('../../transformers/image');
    const transformer = new ImageTransformer();

    const config = getConfig();
    const failover = config.failover;
    const failoverEnabled = failover?.enabled !== false;

    let candidates = await Router.resolveCandidates(request.model, 'images');
    if (candidates.length === 0) {
      const singleRoute = await Router.resolve(request.model, 'images');
      candidates = [singleRoute];
    }

    candidates = applyKeyAccessPolicy(request, candidates, 'images');

    const retryHistory: RetryAttemptRecord[] = [];
    candidates = host.applyQuotaFilter(request, candidates, retryHistory, 'images');

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
          'images'
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
          'images'
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
        const baseUrl = host.resolveBaseUrl(route, 'images');
        const url = `${baseUrl}/images/edits`;

        const headers: Record<string, string> = {};

        if (route.config.api_key) {
          headers['Authorization'] = `Bearer ${route.config.api_key}`;
        }

        if (route.config.headers) {
          Object.assign(headers, route.config.headers);
        }

        const formData = await transformer.transformEditRequest({
          ...request,
          model: route.model,
        });

        logger.info(`Dispatching image edit ${request.model} to ${route.provider}:${route.model}`);
        logger.silly('Image Edit Request', {
          model: request.model,
          filename: request.filename,
          hasMask: !!request.mask,
        });

        if (request.requestId) {
          DebugManager.getInstance().addTransformedRequest(request.requestId, {
            model: request.model,
            filename: request.filename,
            hasMask: !!request.mask,
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
              'images',
              request.requestId
            );
          } catch (e: any) {
            lastError = e;
            host.appendFailureAttempt(retryHistory, route, e, 'images', canRetry);
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
              host.saveIntermediateError(request.requestId, 'images', e);
              logger.warn(
                `Failover: retrying image edit after HTTP ${response.status} from ${route.provider}/${route.model}`
              );
              continue;
            }
            throw e;
          }
        }

        const responseBody = await response.json();
        logger.silly('Image Edit Response', responseBody);

        if (request.requestId) {
          DebugManager.getInstance().addRawResponse(request.requestId, responseBody);
        }

        const unifiedResponse = await transformer.transformEditResponse(responseBody);

        unifiedResponse.plexus = {
          provider: route.provider,
          model: route.model,
          apiType: 'images',
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

        host.appendFailureAttempt(retryHistory, route, error, 'images', canRetryNetwork);

        if (canRetryNetwork) {
          host.saveIntermediateError(request.requestId, 'images', error);
          logger.warn(
            `Failover: retrying image edit after network/transport error from ${route.provider}/${route.model}: ${error.message}`
          );
          continue;
        }

        throw host.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
      }
    }

    throw host.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
  }
}
