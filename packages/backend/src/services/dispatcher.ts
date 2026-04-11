import {
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedTranscriptionRequest,
  UnifiedTranscriptionResponse,
  UnifiedSpeechRequest,
  UnifiedSpeechResponse,
  UnifiedImageGenerationRequest,
  UnifiedImageGenerationResponse,
  UnifiedImageEditRequest,
  UnifiedImageEditResponse,
} from '../types/unified';
import { Router } from './router';
import { TransformerFactory } from './transformer-factory';
import { logger } from '../utils/logger';
import { QUOTA_ERROR_PATTERNS } from '../utils/constants';
import { CooldownManager } from './cooldown-manager';
import { RouteResult } from './router';
import { DebugManager } from './debug-manager';
import { UsageStorageService } from './usage-storage';
import { CooldownParserRegistry } from './cooldown-parsers';
import { getConfig, getProviderTypes } from '../config';
import { applyModelBehaviors } from './model-behaviors';
import { getModels } from '@mariozechner/pi-ai';
import { VisionDescriptorService } from './vision-descriptor-service';
import { ModelMetadataManager } from './model-metadata-manager';
import { DEFAULT_VISION_DESCRIPTION_PROMPT } from '../utils/constants';
import { UsageRecord } from '../types/usage';
import { calculateCosts } from '../utils/calculate-costs';

interface RetryAttemptRecord {
  index: number;
  provider: string;
  model: string;
  apiType?: string;
  status: 'success' | 'failed' | 'skipped';
  reason: string;
  statusCode?: number;
  retryable?: boolean;
}

interface ParseFailureContext {
  rawResponseText: string;
  contentType?: string | null;
}

interface RetryHistoryLikeEntry {
  reason?: unknown;
}

export class Dispatcher {
  private usageStorage?: UsageStorageService;

  private extractFailureReason(value: unknown): string | undefined {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return undefined;
      }

      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          return this.extractFailureReason(parsed) || trimmed;
        } catch {
          return trimmed;
        }
      }

      return trimmed;
    }

    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const record = value as Record<string, unknown>;
    const nestedError =
      record.error && typeof record.error === 'object'
        ? (record.error as Record<string, unknown>)
        : undefined;
    const nestedRoutingContext =
      record.routingContext && typeof record.routingContext === 'object'
        ? (record.routingContext as Record<string, unknown>)
        : undefined;

    const directCandidates = [
      record.errorMessage,
      nestedError?.errorMessage,
      record.message,
      nestedError?.message,
      record.providerResponse,
      record.rawResponseText,
      nestedRoutingContext?.providerResponse,
      nestedRoutingContext?.rawResponseText,
    ];

    for (const candidate of directCandidates) {
      const extracted = this.extractFailureReason(candidate);
      if (extracted) {
        return extracted;
      }
    }

    if (typeof record.retryHistory === 'string') {
      try {
        const parsed = JSON.parse(record.retryHistory) as RetryHistoryLikeEntry[];
        for (let index = parsed.length - 1; index >= 0; index--) {
          const extracted = this.extractFailureReason(parsed[index]?.reason);
          if (extracted) {
            return extracted;
          }
        }
      } catch {
        // Ignore malformed retry history strings.
      }
    }

    return undefined;
  }

  private formatFailureReason(error: any, includeStatusCode = false): string {
    const extracted =
      this.extractFailureReason(error?.routingContext?.providerResponse) ||
      this.extractFailureReason(error?.routingContext?.rawResponseText) ||
      this.extractFailureReason(error?.piAiResponse) ||
      this.extractFailureReason(error) ||
      error?.message ||
      'Unknown provider error';

    const statusCode = error?.routingContext?.statusCode ?? error?.status ?? error?.statusCode;

    if (includeStatusCode && typeof statusCode === 'number') {
      return `HTTP ${statusCode}: ${extracted}`.slice(0, 500);
    }

    return String(extracted).slice(0, 500);
  }

  private async recordAttemptMetric(
    route: RouteResult,
    requestId: string | undefined,
    success: boolean,
    metadata?: { isVisionFallthrough?: boolean; isDescriptorRequest?: boolean; visionFallthroughModel?: string }
  ): Promise<void> {
    if (!this.usageStorage) return;

    const metricRequestId =
      requestId || `failover-attempt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (success) {
      await this.usageStorage.recordSuccessfulAttempt(
        route.provider,
        route.model,
        route.canonicalModel ?? null,
        metricRequestId,
        metadata
      );
      return;
    }

    await this.usageStorage.recordFailedAttempt(
      route.provider,
      route.model,
      route.canonicalModel ?? null,
      metricRequestId,
      metadata
    );
  }

  setUsageStorage(storage: UsageStorageService) {
    this.usageStorage = storage;
  }

  async dispatch(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    const config = getConfig();
    const failover = config.failover;
    const failoverEnabled = failover?.enabled !== false;

    // 1. Route (ordered candidates)
    let candidates = await Router.resolveCandidates(request.model, request.incomingApiType);

    // Fallback for direct/provider/model syntax and legacy single-route behavior
    if (candidates.length === 0) {
      const singleRoute = await Router.resolve(request.model, request.incomingApiType);
      candidates = [singleRoute];
    }

    if (candidates.length === 0) {
      throw new Error(`No route candidates found for model '${request.model}'`);
    }

    const targets = failoverEnabled ? candidates : [candidates[0]!];
    const attemptedProviders: string[] = [];
    const retryHistory: RetryAttemptRecord[] = [];
    let lastError: any = null;

    // Check if this is already a vision descriptor request to prevent recursion
    const isVisionDescriptorRequest = (request as any)._isVisionDescriptorRequest === true;

    for (let i = 0; i < targets.length; i++) {
      let currentRequest = { ...request };
      const route = targets[i]!;

      // Vision Fallthrough (Image-to-Text Preprocessing)
      // Check if:
      // 1. Opt-in is enabled for this alias
      // 2. We're not already in a descriptor call (recursion guard)
      // 3. Request contains images
      // Look up use_image_fallthrough from the alias configuration (not provider's model config)
      const aliasConfig = route.canonicalModel ? config.models?.[route.canonicalModel] : undefined;
      const hasImages = VisionDescriptorService.hasImages(currentRequest.messages);
      logger.debug(
        `[vision-fallthrough] Checking: canonicalModel='${route.canonicalModel}', use_image_fallthrough='${aliasConfig?.use_image_fallthrough}', hasImages='${hasImages}', isVisionDescriptorRequest='${isVisionDescriptorRequest}'`
      );
      if (!isVisionDescriptorRequest && aliasConfig?.use_image_fallthrough && hasImages) {
        const vfConfig = config.vision_fallthrough;
        if (vfConfig?.descriptor_model) {
          try {
            logger.debug(
              `[vision-fallthrough] Before process: ${JSON.stringify(currentRequest.messages.map((m) => ({ role: m.role, contentCount: Array.isArray(m.content) ? m.content.length : 'string' })))}`
            );
            currentRequest = await VisionDescriptorService.process(
              currentRequest,
              vfConfig.descriptor_model,
              vfConfig.default_prompt || DEFAULT_VISION_DESCRIPTION_PROMPT,
              this.usageStorage // Pass usage storage to record descriptor call
            );
            logger.debug(
              `[vision-fallthrough] After process: ${JSON.stringify(currentRequest.messages.map((m) => ({ role: m.role, contentCount: Array.isArray(m.content) ? m.content.length : 'string' })))}`
            );

            // Verify if images are actually gone in the modified request
            const stillHasImages = VisionDescriptorService.hasImages(currentRequest.messages);
            if (stillHasImages) {
              logger.error(
                `[vision-fallthrough] CRITICAL: VisionDescriptorService.process returned a request that STILL contains images!`
              );
            }

            // Tag the request as having undergone fallthrough
            (currentRequest as any)._hasVisionFallthrough = true;
            (currentRequest as any)._visionFallthroughModel = vfConfig.descriptor_model;
            logger.info(
              `[vision-fallthrough] Successfully preprocessed images for ${route.provider}/${route.model}`
            );
          } catch (vfError) {
            logger.error(`[vision-fallthrough] Error in descriptor service:`, vfError);
          }
        } else {
          logger.warn(
            `[vision-fallthrough] Feature enabled for alias '${request.model}' but 'vision_fallthrough.descriptor_model' not configured globally.`
          );
        }
      }

      // Re-check cooldown status before attempting this target
      const isHealthy = await CooldownManager.getInstance().isProviderHealthy(
        route.provider,
        route.model
      );
      if (!isHealthy) {
        logger.warn(`Skipping ${route.provider}/${route.model} - provider is on cooldown`);
        lastError = new Error(`Provider ${route.provider}/${route.model} is on cooldown`);
        this.appendSkippedAttempt(
          retryHistory,
          route,
          `Provider ${route.provider}/${route.model} is on cooldown`
        );
        continue;
      }

      attemptedProviders.push(`${route.provider}/${route.model}`);

      try {
        // Determine Target API Type
        const { targetApiType, selectionReason } = this.selectTargetApiType(
          route,
          currentRequest.incomingApiType
        );

        logger.info(
          `Dispatcher: Selected API type '${targetApiType}' for model '${route.model}'. Reason: ${selectionReason}`
        );

        // 2. Get Transformer
        const transformerType = this.isPiAiRoute(route, targetApiType) ? 'oauth' : targetApiType;
        const transformer = TransformerFactory.getTransformer(transformerType);

        // 3. Transform Request
        const requestWithTargetModel = { ...currentRequest, model: route.model };

        const { payload: providerPayload, bypassTransformation } =
          await this.transformRequestPayload(
            requestWithTargetModel,
            route,
            transformer,
            targetApiType
          );

        // Capture transformed request
        if (currentRequest.requestId) {
          DebugManager.getInstance().addTransformedRequest(
            currentRequest.requestId,
            providerPayload
          );
        }

        if (this.isPiAiRoute(route, targetApiType)) {
          try {
            const oauthResponse = await this.dispatchOAuthRequest(
              providerPayload,
              currentRequest,
              route,
              targetApiType,
              transformer
            );
            await this.recordAttemptMetric(route, currentRequest.requestId, true, {
              isVisionFallthrough: (currentRequest as any)._hasVisionFallthrough,
              isDescriptorRequest: (currentRequest as any)._isVisionDescriptorRequest,
              visionFallthroughModel: (currentRequest as any)._visionFallthroughModel,
            });
            this.appendSuccessAttempt(retryHistory, route, targetApiType);
            this.attachAttemptMetadata(
              oauthResponse,
              attemptedProviders,
              retryHistory,
              route,
              targetApiType
            );
            return oauthResponse;
          } catch (oauthError: any) {
            lastError = oauthError;
            const canRetry =
              failoverEnabled && i < targets.length - 1 && this.isRetryableOAuthError(oauthError);

            this.appendFailureAttempt(retryHistory, route, oauthError, targetApiType, canRetry);

            if (canRetry) {
              await this.recordAttemptMetric(route, currentRequest.requestId, false, {
                isVisionFallthrough: (currentRequest as any)._hasVisionFallthrough,
                isDescriptorRequest: (currentRequest as any)._isVisionDescriptorRequest,
                visionFallthroughModel: (currentRequest as any)._visionFallthroughModel,
              });
              await this.markOAuthProviderFailure(route, oauthError);
              logger.warn(
                `Failover: retrying after OAuth error from ${route.provider}/${route.model}: ${oauthError.message}`
              );
              continue;
            }

            await this.markOAuthProviderFailure(route, oauthError);
            throw oauthError;
          }
        }

        // 4. Execute Request
        const url = this.buildRequestUrl(route, transformer, requestWithTargetModel, targetApiType);
        const headers = this.setupHeaders(route, targetApiType, requestWithTargetModel);

        const incomingApi = currentRequest.incomingApiType || 'unknown';

        logger.info(
          `Dispatching ${currentRequest.model} to ${route.provider}:${route.model} ${incomingApi} <-> ${transformer.name}`
        );

        logger.silly('Upstream Request Payload', providerPayload);

        const response = await this.executeProviderRequest(url, headers, providerPayload);

        if (!response.ok) {
          const errorText = await response.text();
          const canRetry =
            failoverEnabled &&
            i < targets.length - 1 &&
            this.isRetryableStatus(response.status, failover?.retryableStatusCodes || []);

          try {
            await this.handleProviderError(
              response,
              route,
              errorText,
              url,
              headers,
              targetApiType,
              currentRequest.requestId
            );
          } catch (e: any) {
            lastError = e;
            this.appendFailureAttempt(retryHistory, route, e, targetApiType, canRetry);

            if (canRetry) {
              await this.recordAttemptMetric(route, currentRequest.requestId, false, {
                isVisionFallthrough: (currentRequest as any)._hasVisionFallthrough,
                isDescriptorRequest: (currentRequest as any)._isVisionDescriptorRequest,
                visionFallthroughModel: (currentRequest as any)._visionFallthroughModel,
              });
              // Only mark as failed if the error actually triggered a cooldown (i.e., it's not a caller error like validation)
              // Caller errors (400 validation errors, 413, 422) should not cause cooldown
              if (e?.routingContext?.cooldownTriggered) {
                CooldownManager.getInstance().markProviderFailure(
                  route.provider,
                  route.model,
                  undefined,
                  this.formatFailureReason(e, true)
                );
              }
              logger.warn(
                `Failover: retrying after HTTP ${response.status} from ${route.provider}/${route.model}`
              );
              continue;
            }

            throw e;
          }
        }

        // 5. Handle Response
        if (currentRequest.stream) {
          const streamProbe = await this.probeStreamingStart(response);

          if (!streamProbe.ok) {
            const error = streamProbe.error;
            lastError = error;

            const canRetry =
              failoverEnabled &&
              i < targets.length - 1 &&
              !streamProbe.streamStarted &&
              this.isRetryableNetworkError(error, failover?.retryableErrors || []);

            if (canRetry) {
              await this.recordAttemptMetric(route, currentRequest.requestId, false, {
                isVisionFallthrough: (currentRequest as any)._hasVisionFallthrough,
                isDescriptorRequest: (currentRequest as any)._isVisionDescriptorRequest,
                visionFallthroughModel: (currentRequest as any)._visionFallthroughModel,
              });
              this.appendFailureAttempt(retryHistory, route, error, targetApiType, true);
              // Always mark as failed when retrying — provider couldn't serve this request
              CooldownManager.getInstance().markProviderFailure(
                route.provider,
                route.model,
                undefined,
                this.formatFailureReason(error)
              );
              logger.warn(
                `Failover: retrying stream before first byte after ${route.provider}/${route.model} failure: ${error.message}`
              );
              continue;
            }

            throw error;
          }

          const streamResponse = this.handleStreamingResponse(
            streamProbe.response,
            currentRequest,
            route,
            targetApiType,
            bypassTransformation
          );
          await this.recordAttemptMetric(route, currentRequest.requestId, true, {
            isVisionFallthrough: (currentRequest as any)._hasVisionFallthrough,
            isDescriptorRequest: (currentRequest as any)._isVisionDescriptorRequest,
            visionFallthroughModel: (currentRequest as any)._visionFallthroughModel,
          });
          CooldownManager.getInstance().markProviderSuccess(route.provider, route.model);
          this.appendSuccessAttempt(retryHistory, route, targetApiType);
          this.attachAttemptMetadata(
            streamResponse,
            attemptedProviders,
            retryHistory,
            route,
            targetApiType
          );
          return streamResponse;
        }

        const nonStreamingResponse = await this.handleNonStreamingResponse(
          response,
          currentRequest,
          route,
          targetApiType,
          transformer,
          bypassTransformation
        );
        await this.recordAttemptMetric(route, currentRequest.requestId, true, {
          isVisionFallthrough: (currentRequest as any)._hasVisionFallthrough,
          isDescriptorRequest: (currentRequest as any)._isVisionDescriptorRequest,
          visionFallthroughModel: (currentRequest as any)._visionFallthroughModel,
        });

        if ((currentRequest as any)._isVisionDescriptorRequest && this.usageStorage) {
          // ... (this part is fine)
        }

        CooldownManager.getInstance().markProviderSuccess(route.provider, route.model);
        this.appendSuccessAttempt(retryHistory, route, targetApiType);
        this.attachAttemptMetadata(
          nonStreamingResponse,
          attemptedProviders,
          retryHistory,
          route,
          targetApiType
        );
        return nonStreamingResponse;
      } catch (error: any) {
        lastError = error;

        // If the error came from handleProviderError, it already called markProviderFailure.
        // Only call it here for network/transport errors that have no HTTP status code.
        const isHttpError = error?.routingContext?.statusCode !== undefined;

        if (!isHttpError) {
          // Pure network/transport error — mark the provider as failed
          CooldownManager.getInstance().markProviderFailure(
            route.provider,
            route.model,
            undefined,
            this.formatFailureReason(error)
          );
        }
        await this.recordAttemptMetric(route, currentRequest.requestId, false, {
          isVisionFallthrough: (currentRequest as any)._hasVisionFallthrough,
          isDescriptorRequest: (currentRequest as any)._isVisionDescriptorRequest,
          visionFallthroughModel: (currentRequest as any)._visionFallthroughModel,
        });

        const canRetryNetwork =
          failoverEnabled &&
          i < targets.length - 1 &&
          this.isRetryableNetworkError(error, failover?.retryableErrors || []);

        this.appendFailureAttempt(retryHistory, route, error, undefined, canRetryNetwork);

        if (canRetryNetwork) {
          logger.warn(
            `Failover: retrying after network/transport error from ${route.provider}/${route.model}: ${error.message}`
          );
          continue;
        }

        throw this.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
      }
    }

    throw this.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
  }

  private isRetryableStatus(statusCode: number, retryableStatusCodes: number[]): boolean {
    return retryableStatusCodes.includes(statusCode);
  }

  /**
   * Determines if an OAuth error is retryable.
   * Retryable errors include network issues, rate limiting, and transient failures.
   */
  private isRetryableOAuthError(error: any): boolean {
    if (!error) return false;

    const errorMessage = error.message?.toLowerCase() || '';
    const statusCode = error.status || error.statusCode;

    // Retry on network errors (no status code means network failure)
    if (!statusCode) {
      return true;
    }

    // Retry on 5xx server errors
    if (statusCode >= 500 && statusCode < 600) {
      return true;
    }

    // Retry on 429 rate limiting
    if (statusCode === 429) {
      return true;
    }

    // Retry on specific transient error messages
    const retryablePatterns = [
      'timeout',
      'econnrefused',
      'ECONNREFUSED',
      'etimedout',
      'ETIMEDOUT',
      'network',
      'socket',
      'temporary',
      'unavailable',
      'service unavailable',
    ];

    for (const pattern of retryablePatterns) {
      if (errorMessage.includes(pattern)) {
        return true;
      }
    }

    return false;
  }

  private isRetryableNetworkError(error: any, retryableErrors: string[]): boolean {
    if (!error) return false;
    const code = String(error.code || '').toUpperCase();
    const message = String(error.message || '').toUpperCase();
    return retryableErrors.some((token) => {
      const normalized = token.toUpperCase();
      return code.includes(normalized) || message.includes(normalized);
    });
  }

  private async probeStreamingStart(
    response: Response
  ): Promise<
    { ok: true; response: Response } | { ok: false; error: Error; streamStarted: boolean }
  > {
    if (!response.body) {
      return { ok: true, response };
    }

    const reader = response.body.getReader();

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<{ timeout: true }>((resolve) => {
      timeoutId = setTimeout(() => resolve({ timeout: true }), 100);
    });

    try {
      const readPromise = reader.read();
      const readResult = await Promise.race([readPromise, timeoutPromise]);

      if ((readResult as any).timeout) {
        const passthrough = new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              const first = await readPromise;
              if (!first.done && first.value) {
                controller.enqueue(first.value);
              } else if (first.done) {
                controller.close();
              }
            } catch (error) {
              controller.error(error);
            }
          },
          async pull(controller) {
            try {
              const next = await reader.read();
              if (next.done) {
                controller.close();
              } else {
                controller.enqueue(next.value);
              }
            } catch (error) {
              controller.error(error);
            }
          },
          cancel(reason) {
            return reader.cancel(reason);
          },
        });

        return {
          ok: true,
          response: new Response(passthrough, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          }),
        };
      }

      const first = readResult as ReadableStreamReadResult<Uint8Array>;
      const replay = new ReadableStream<Uint8Array>({
        start(controller) {
          if (!first.done && first.value) {
            controller.enqueue(first.value);
          }
        },
        async pull(controller) {
          try {
            const next = await reader.read();
            if (next.done) {
              controller.close();
            } else {
              controller.enqueue(next.value);
            }
          } catch (error) {
            controller.error(error);
          }
        },
        cancel(reason) {
          return reader.cancel(reason);
        },
      });

      return {
        ok: true,
        response: new Response(replay, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        }),
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error instanceof Error ? error : new Error(String(error)),
        streamStarted: false,
      };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  private attachAttemptMetadata(
    response: any,
    attemptedProviders: string[],
    retryHistory: RetryAttemptRecord[],
    finalRoute: RouteResult,
    apiType: string
  ): void {
    const responseApiType = (response?.plexus as any)?.apiType;

    response.plexus = {
      ...(response.plexus || {}),
      attemptCount: attemptedProviders.length,
      finalAttemptProvider: finalRoute.provider,
      finalAttemptModel: finalRoute.model,
      allAttemptedProviders: JSON.stringify(attemptedProviders),
      retryHistory: JSON.stringify(retryHistory),
      canonicalModel: finalRoute.canonicalModel,
      provider: finalRoute.provider,
      model: finalRoute.model,
      // Preserve the response-declared API type (e.g. oauth) so downstream
      // stream transformation uses the correct transformer.
      apiType: responseApiType || apiType,
      pricing: finalRoute.modelConfig?.pricing,
      providerDiscount: (finalRoute.config as any).discount,
      config: {
        estimateTokens: finalRoute.config.estimateTokens,
      },
    } as any;
  }

  private appendSkippedAttempt(
    retryHistory: RetryAttemptRecord[],
    route: RouteResult,
    reason: string,
    apiType?: string
  ): void {
    retryHistory.push({
      index: retryHistory.length + 1,
      provider: route.provider,
      model: route.model,
      apiType,
      status: 'skipped',
      reason,
      retryable: false,
    });
  }

  private appendSuccessAttempt(
    retryHistory: RetryAttemptRecord[],
    route: RouteResult,
    apiType?: string
  ): void {
    retryHistory.push({
      index: retryHistory.length + 1,
      provider: route.provider,
      model: route.model,
      apiType,
      status: 'success',
      reason: 'Request completed successfully',
      retryable: false,
    });
  }

  private appendFailureAttempt(
    retryHistory: RetryAttemptRecord[],
    route: RouteResult,
    error: any,
    apiType?: string,
    retryable?: boolean
  ): void {
    const statusCode = error?.routingContext?.statusCode ?? error?.status ?? error?.statusCode;
    const reason = this.formatFailureReason(error);

    retryHistory.push({
      index: retryHistory.length + 1,
      provider: route.provider,
      model: route.model,
      apiType,
      status: 'failed',
      reason,
      statusCode: typeof statusCode === 'number' ? statusCode : undefined,
      retryable,
    });
  }

  private buildAllTargetsFailedError(
    lastError: any,
    attemptedProviders: string[],
    retryHistory: RetryAttemptRecord[] = []
  ): Error {
    const summary = attemptedProviders.length > 0 ? attemptedProviders.join(', ') : 'none';
    const baseMessage = lastError?.message || 'Unknown provider error';
    const enriched = new Error(`All targets failed: ${summary}. Last error: ${baseMessage}`) as any;

    enriched.cause = lastError;
    enriched.routingContext = {
      ...(lastError?.routingContext || {}),
      allAttemptedProviders: attemptedProviders,
      attemptCount: attemptedProviders.length,
      retryHistory: JSON.stringify(retryHistory),
      statusCode: lastError?.routingContext?.statusCode || 500,
    };

    return enriched;
  }

  private async parseJsonResponseBody(
    response: Response,
    requestId?: string,
    route?: RouteResult,
    targetApiType?: string
  ): Promise<any> {
    const responseText = await response.text();

    try {
      return JSON.parse(responseText);
    } catch (cause) {
      if (requestId) {
        DebugManager.getInstance().addRawResponse(requestId, responseText);
        DebugManager.getInstance().addReconstructedRawResponse(requestId, {
          parseError: true,
          rawResponseText: responseText,
          contentType: response.headers.get('content-type'),
          provider: route?.provider,
          targetModel: route?.model,
          targetApiType,
        });
      }

      const error = new Error(
        responseText || 'JSON Parse error: Unable to parse JSON string'
      ) as any;
      error.cause = cause;
      error.routingContext = {
        provider: route?.provider,
        targetModel: route?.model,
        targetApiType,
        statusCode: response.status || 500,
        rawResponseText: responseText,
        providerResponse: responseText,
        contentType: response.headers.get('content-type'),
      } satisfies ParseFailureContext & Record<string, unknown>;

      throw error;
    }
  }

  setupHeaders(
    route: RouteResult,
    apiType: string,
    request: UnifiedChatRequest
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Set Accept header based on streaming
    if (request.stream) {
      headers['Accept'] = 'text/event-stream';
    } else {
      headers['Accept'] = 'application/json';
    }

    // Use static API key
    if (route.config.api_key) {
      const type = apiType.toLowerCase();
      if (type === 'messages') {
        headers['x-api-key'] = route.config.api_key;
        headers['anthropic-version'] = '2023-06-01';
      } else if (type === 'gemini') {
        headers['x-goog-api-key'] = route.config.api_key;
      } else {
        // Default to Bearer for Chat (OpenAI) and others
        headers['Authorization'] = `Bearer ${route.config.api_key}`;
      }
    } else {
      throw new Error(`No API key configured for provider '${route.provider}'`);
    }

    if (route.config.headers) {
      Object.assign(headers, route.config.headers);
    }
    return headers;
  }

  private getApiMetadata(metadata: Record<string, any>): Record<string, any> {
    const { plexus_metadata: _stripped, ...apiMetadata } = metadata || {};
    return apiMetadata;
  }

  /**
   * Extracts provider types using the helper function that infers from api_base_url
   */
  private extractProviderTypes(route: RouteResult): string[] {
    return getProviderTypes(route.config);
  }

  /**
   * Determines which API type to use based on configuration and incoming request type
   * @returns Selected API type and human-readable reason for selection
   */
  private selectTargetApiType(
    route: RouteResult,
    incomingApiType?: string
  ): { targetApiType: string; selectionReason: string } {
    const providerTypes = this.extractProviderTypes(route);

    // Check if model specific access_via is defined
    const modelSpecificTypes = route.modelConfig?.access_via;

    // The available types for this specific routing
    // If model specific types are defined and not empty, use them. Otherwise fallback to provider types.
    const availableTypes =
      modelSpecificTypes && modelSpecificTypes.length > 0 ? modelSpecificTypes : providerTypes;

    let targetApiType = availableTypes[0]; // Default to first one

    if (!targetApiType) {
      throw new Error(
        `No available API type found for provider '${route.provider}' and model '${route.model}'. Check configuration.`
      );
    }
    let selectionReason = 'default (first available)';

    // Try to match incoming
    if (incomingApiType) {
      const incoming = incomingApiType.toLowerCase();
      // Case-insensitive match
      const match = availableTypes.find((t: string) => t.toLowerCase() === incoming);
      if (match) {
        targetApiType = match;
        selectionReason = `matched incoming request type '${incoming}'`;
      } else {
        selectionReason = `incoming type '${incoming}' not supported, defaulted to '${targetApiType}'`;
      }
    }

    return { targetApiType, selectionReason };
  }

  /**
   * Resolves the provider base URL from configuration, handling both string and record formats
   * @returns Normalized base URL without trailing slash
   */
  private resolveBaseUrl(route: RouteResult, targetApiType: string): string {
    let rawBaseUrl: string;

    if (typeof route.config.api_base_url === 'string') {
      rawBaseUrl = route.config.api_base_url;
    } else {
      // It's a record/map
      const typeKey = targetApiType.toLowerCase();
      // Check exact match first, then fallback to just looking for keys that might match?
      // Actually the config keys should probably match the api types (chat, messages, etc)
      const specificUrl = route.config.api_base_url[typeKey];
      const defaultUrl = route.config.api_base_url['default'];

      if (specificUrl) {
        rawBaseUrl = specificUrl;
        logger.debug(`Dispatcher: Using specific base URL for '${targetApiType}'.`);
      } else if (defaultUrl) {
        rawBaseUrl = defaultUrl;
        logger.debug(`Dispatcher: Using default base URL.`);
      } else {
        // If we can't find a specific URL for this type, and no default, fall back to the first one?
        // Or throw error.
        const firstKey = Object.keys(route.config.api_base_url)[0];

        if (firstKey) {
          const firstUrl = route.config.api_base_url[firstKey];
          if (firstUrl) {
            rawBaseUrl = firstUrl;
            logger.warn(
              `No specific base URL found for api type '${targetApiType}'. using '${firstKey}' as fallback.`
            );
          } else {
            throw new Error(
              `No base URL configured for api type '${targetApiType}' and no default found.`
            );
          }
        } else {
          throw new Error(
            `No base URL configured for api type '${targetApiType}' and no default found.`
          );
        }
      }
    }

    // Ensure api_base_url doesn't end with slash
    return rawBaseUrl.replace(/\/$/, '');
  }

  private isOAuthRoute(route: RouteResult, targetApiType: string): boolean {
    if (targetApiType.toLowerCase() === 'oauth') return true;
    if (typeof route.config.api_base_url === 'string') {
      return route.config.api_base_url.startsWith('oauth://');
    }
    const urlMap = route.config.api_base_url as Record<string, string>;
    return Object.values(urlMap).some((value) => value.startsWith('oauth://'));
  }

  private isClaudeMaskingApiKeyRoute(route: RouteResult, targetApiType: string): boolean {
    if (this.isOAuthRoute(route, targetApiType)) {
      return false;
    }

    if (targetApiType.toLowerCase() !== 'messages') {
      return false;
    }

    return route.config.useClaudeMasking === true;
  }

  private isPiAiRoute(route: RouteResult, targetApiType: string): boolean {
    return (
      this.isOAuthRoute(route, targetApiType) ||
      this.isClaudeMaskingApiKeyRoute(route, targetApiType)
    );
  }

  private isAsyncIterable<T>(input: any): input is AsyncIterable<T> {
    return input && typeof input[Symbol.asyncIterator] === 'function';
  }

  private isReadableStream<T>(input: any): input is ReadableStream<T> {
    return !!input && typeof input.getReader === 'function';
  }

  private normalizeOAuthStream(result: any): ReadableStream<any> {
    if (this.isReadableStream(result)) {
      return result;
    }

    if (this.isAsyncIterable(result)) {
      return this.streamFromAsyncIterable(result);
    }

    throw new Error('OAuth provider returned an unsupported stream type');
  }

  private buildOAuthStreamEventError(event: any): Error {
    const message =
      event?.error?.errorMessage ||
      event?.errorMessage ||
      event?.error?.message ||
      event?.message ||
      'OAuth provider error';

    const error = new Error(message) as Error & { piAiResponse?: unknown };
    error.piAiResponse = event;
    return error;
  }

  private async probeOAuthStreamStart(
    stream: ReadableStream<any>
  ): Promise<
    { ok: true; stream: ReadableStream<any> } | { ok: false; error: Error; streamStarted: boolean }
  > {
    // Pi-ai streams begin with bookkeeping events (type 'start', 'text_start',
    // 'thinking_start', etc.) that carry no content and precede any error events.
    // If we declare ok:true on the first such event, a 429 error arriving as the
    // SECOND event will be seen after the HTTP response is already committed —
    // too late to retry.  Instead, buffer bookkeeping events and keep reading
    // until we see either:
    //   - An error event  → ok:false → dispatcher retries
    //   - Empty stream    → ok:false → dispatcher retries (quota exhausted)
    //   - A content event → ok:true  → replay all buffered events + rest of stream
    const BOOKKEEPING_TYPES = new Set([
      'start',
      'text_start',
      'text_end',
      'thinking_start',
      'thinking_end',
      'toolcall_start',
      'toolcall_end',
    ]);

    const reader = stream.getReader();
    const buffered: any[] = [];

    try {
      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          // Stream closed — quota exhausted (no events) or provider gave up.
          reader.releaseLock();
          return {
            ok: false,
            error: new Error('OAuth provider returned empty stream (quota exhausted)'),
            streamStarted: false,
          };
        }

        if (value?.type === 'error' || value?.reason === 'error') {
          reader.releaseLock();
          return {
            ok: false,
            error: this.buildOAuthStreamEventError(value),
            streamStarted: false,
          };
        }

        buffered.push(value);

        // If this event is not pure bookkeeping, the stream is healthy.
        // Replay all buffered events then continue from the reader.
        if (!BOOKKEEPING_TYPES.has(value?.type)) {
          break;
        }
      }

      // Stream is healthy — replay buffered events then stream the rest.
      // The replay stream takes ownership of the reader; do NOT releaseLock here.
      const snapshot = buffered.slice();
      const replay = new ReadableStream<any>({
        start(controller) {
          for (const ev of snapshot) {
            controller.enqueue(ev);
          }
        },
        async pull(controller) {
          try {
            const next = await reader.read();
            if (next.done) {
              controller.close();
            } else {
              controller.enqueue(next.value);
            }
          } catch (error) {
            controller.error(error);
          }
        },
        cancel(reason) {
          return reader.cancel(reason);
        },
      });

      return { ok: true, stream: replay };
    } catch (error: any) {
      try {
        reader.releaseLock();
      } catch {}
      return {
        ok: false,
        error: error instanceof Error ? error : new Error(String(error)),
        streamStarted: false,
      };
    }
  }

  private describeStreamResult(result: any): Record<string, any> {
    return {
      isPromise: !!result && typeof result.then === 'function',
      isAsyncIterable: this.isAsyncIterable(result),
      isReadableStream: this.isReadableStream(result),
      hasIterator: !!result && typeof result[Symbol.asyncIterator] === 'function',
      hasGetReader: !!result && typeof result.getReader === 'function',
      constructorName: result?.constructor?.name || typeof result,
    };
  }

  private streamFromAsyncIterable<T>(iterable: AsyncIterable<T>): ReadableStream<T> {
    const iterator = iterable[Symbol.asyncIterator]();
    let closed = false;
    let reading = false;

    return new ReadableStream<T>({
      async pull(controller) {
        if (closed || reading) return;
        reading = true;
        try {
          const { value, done } = await iterator.next();
          if (done) {
            closed = true;
            controller.close();
          } else if (!closed) {
            controller.enqueue(value);
          }
        } catch (error) {
          if (!closed) {
            logger.error('OAuth: Stream pull failed', error as Error);
            closed = true;
            controller.error(error);
          }
        } finally {
          reading = false;
        }
      },
      async cancel(reason) {
        closed = true;
        await iterator.return?.(reason);
      },
    });
  }

  /**
   * Wraps an OAuth pi-ai ReadableStream with a transparent monitor that detects
   * error events and triggers a provider cooldown asynchronously.
   *
   * This is needed because pi-ai retries HTTP 429s internally with exponential
   * backoff (delays of 1 s, 2 s, 4 s …), so the final error event may arrive
   * many seconds after the 100 ms probe timeout has already declared the stream
   * healthy.  Without this wrapper the cooldown is never triggered and the
   * exhausted provider keeps receiving traffic.
   */
  private monitorOAuthStreamForErrors(
    stream: ReadableStream<any>,
    route: RouteResult
  ): ReadableStream<any> {
    const dispatcher = this;
    let readerRef: ReadableStreamDefaultReader<any> | null = null;

    return new ReadableStream<any>({
      async start(controller) {
        readerRef = stream.getReader();
        let eventsEmitted = 0;

        try {
          while (true) {
            const { value, done } = await readerRef.read();
            if (done) {
              // If the stream closed without emitting any events, the upstream
              // provider silently exhausted quota (pi-ai retries 429s internally
              // with exponential backoff and then just closes the stream — no
              // error event is emitted).  Treat this as a provider failure so
              // that a cooldown is triggered and the account is not hammered.
              if (eventsEmitted === 0) {
                logger.warn(
                  `OAuth: Stream closed with 0 events for ${route.provider}/${route.model} — ` +
                    `treating as quota exhaustion and triggering cooldown`
                );

                const syntheticError = new Error(
                  'OAuth provider returned empty stream (quota exhausted)'
                ) as Error & {
                  piAiResponse?: unknown;
                };
                syntheticError.piAiResponse = {
                  stopReason: 'error',
                  errorMessage: 'quota exhausted',
                };

                const wrappedError = dispatcher.wrapOAuthError(
                  syntheticError,
                  route,
                  'oauth'
                ) as any;

                dispatcher.markOAuthProviderFailure(route, wrappedError).catch((e) => {
                  logger.error('OAuth: Failed to mark provider failure from empty stream', e);
                });
              }

              controller.close();
              break;
            }

            // Detect pi-ai error events and trigger cooldown asynchronously.
            // The event shape is: { type: "error", reason: "error"|"aborted", error: AssistantMessage }
            if (value?.type === 'error') {
              const errorMessage =
                value?.error?.errorMessage ||
                value?.errorMessage ||
                value?.error?.message ||
                value?.message ||
                'OAuth provider error';

              logger.warn(
                `OAuth: Stream error event detected for ${route.provider}/${route.model}: ${errorMessage}`
              );

              // Build a synthetic error so wrapOAuthError can determine if this
              // is a quota exhaustion, compute cooldown duration, etc.
              const syntheticError = new Error(errorMessage) as Error & {
                piAiResponse?: unknown;
              };
              syntheticError.piAiResponse = value;

              const wrappedError = dispatcher.wrapOAuthError(syntheticError, route, 'oauth') as any;

              // Trigger cooldown without awaiting so the stream is not blocked.
              dispatcher.markOAuthProviderFailure(route, wrappedError).catch((e) => {
                logger.error('OAuth: Failed to mark provider failure from stream error', e);
              });

              // Do NOT forward the raw provider error event to the client.
              // Close the stream cleanly so the client gets a proper termination
              // rather than raw provider JSON leaking through as completion content.
              // We cannot use controller.error() here because the HTTP response is
              // already committed (message_start was already sent), and erroring an
              // in-flight ReadableStream causes unhandled promise rejections downstream.
              controller.close();
              return;
            }

            eventsEmitted++;
            controller.enqueue(value);
          }
        } catch (error) {
          controller.error(error);
        } finally {
          readerRef.releaseLock();
          readerRef = null;
        }
      },
      cancel(reason) {
        if (readerRef) {
          readerRef.cancel(reason).catch(() => {});
        }
      },
    });
  }

  private async dispatchOAuthRequest(
    context: any,
    request: UnifiedChatRequest,
    route: RouteResult,
    targetApiType: string,
    transformer: any
  ): Promise<UnifiedChatResponse> {
    if (!transformer.executeRequest) {
      throw new Error('OAuth transformer missing executeRequest()');
    }

    try {
      const oauthProvider = this.isClaudeMaskingApiKeyRoute(route, targetApiType)
        ? 'anthropic'
        : route.config.oauth_provider || route.provider;
      const oauthAccount = route.config.oauth_account?.trim();
      const authConfig = this.isClaudeMaskingApiKeyRoute(route, targetApiType)
        ? {
            authMode: 'apiKey' as const,
            apiKey: route.config.api_key?.trim() || '',
          }
        : {
            authMode: 'oauth' as const,
            accountId: oauthAccount || '',
          };

      if (authConfig.authMode === 'oauth' && !authConfig.accountId) {
        throw new Error(
          `OAuth account is not configured for provider '${route.provider}'. ` +
            `Set providers.${route.provider}.oauth_account in plexus config.`
        );
      }

      if (authConfig.authMode === 'apiKey' && !authConfig.apiKey) {
        throw new Error(
          `API key is not configured for Claude masking provider '${route.provider}'. ` +
            `Set providers.${route.provider}.api_key in plexus config.`
        );
      }

      if (authConfig.authMode === 'oauth') {
        this.assertOAuthModelSupported(oauthProvider, route.model);
      }
      const oauthContext = context?.context ? context.context : context;
      const oauthOptions = context?.options;

      logger.debug('OAuth: Dispatching request', {
        routeProvider: route.provider,
        oauthProvider,
        oauthAccount: authConfig.authMode === 'oauth' ? authConfig.accountId : undefined,
        authMode: authConfig.authMode,
        model: route.model,
        targetApiType,
        streaming: !!request.stream,
        hasOptions: !!oauthOptions,
      });

      if (!oauthContext.systemPrompt) {
        oauthContext.systemPrompt =
          this.resolveOAuthInstructions(request, oauthProvider) || oauthContext.systemPrompt;
      }
      const result = await transformer.executeRequest(
        oauthContext,
        oauthProvider,
        route.model,
        !!request.stream,
        oauthOptions,
        authConfig
      );

      if (request.stream) {
        const rawStream = this.normalizeOAuthStream(result);
        const streamProbe = await this.probeOAuthStreamStart(rawStream);

        if (!streamProbe.ok) {
          throw streamProbe.error;
        }

        logger.debug('OAuth: Normalized stream result', this.describeStreamResult(result));

        // Wrap the probed stream with an error monitor so that quota/error events
        // arriving AFTER the 100ms probe timeout still trigger a cooldown.  This
        // is necessary because pi-ai retries HTTP 429s with exponential backoff
        // (1 s, 2 s, 4 s) before emitting the final error event, which takes far
        // longer than the probe's 100 ms window.
        const monitoredStream = this.monitorOAuthStreamForErrors(streamProbe.stream, route);

        const streamResponse: UnifiedChatResponse = {
          id: 'stream-' + Date.now(),
          model: request.model,
          content: null,
          stream: monitoredStream,
          bypassTransformation: false,
        };

        this.enrichResponseWithMetadata(streamResponse, route, 'oauth');
        return streamResponse;
      }

      const unified = await transformer.transformResponse(result);
      this.enrichResponseWithMetadata(unified, route, 'oauth');
      return unified;
    } catch (error: any) {
      throw this.wrapOAuthError(error, route, targetApiType);
    }
  }

  private assertOAuthModelSupported(oauthProvider: string, modelId: string) {
    const supportedModels = getModels(oauthProvider as any);
    if (!supportedModels || supportedModels.length === 0) {
      throw new Error(`OAuth provider '${oauthProvider}' has no known models.`);
    }

    const isSupported = supportedModels.some((model) => model.id === modelId);
    if (!isSupported) {
      const modelList = supportedModels
        .map((model) => model.id)
        .sort()
        .join(', ');
      throw new Error(
        `OAuth model '${modelId}' is not supported for provider '${oauthProvider}'. ` +
          `Supported models: ${modelList}`
      );
    }
  }

  private wrapOAuthError(error: Error, route: RouteResult, targetApiType: string): Error {
    const rawProviderResponse = this.stringifyOAuthProviderResponse((error as any)?.piAiResponse);
    const message = error?.message || 'OAuth provider error';
    const providerResponse =
      this.extractFailureReason((error as any)?.piAiResponse) || rawProviderResponse;
    const errorText = providerResponse || message;
    const isQuotaError = this.isQuotaExhaustedError(errorText);
    let statusCode = (error as any)?.status || (error as any)?.statusCode;

    if (!statusCode) {
      statusCode = 500;

      if (isQuotaError) {
        statusCode = 429;
      }

      if (
        message.includes('Not authenticated') ||
        message.includes('re-authenticate') ||
        message.includes('expired')
      ) {
        statusCode = 401;
      } else if (message.toLowerCase().includes('model') && message.toLowerCase().includes('not')) {
        statusCode = 400;
      }
    }

    const cooldownTriggered =
      statusCode !== 413 && statusCode !== 422 && !(statusCode === 400 && !isQuotaError);
    const cooldownDuration =
      (statusCode === 429 || isQuotaError) && errorText
        ? this.parseCooldownDurationForProvider(
            this.resolveCooldownProviderType(route),
            errorText,
            'OAuth'
          )
        : undefined;

    const enriched = new Error(message) as any;
    enriched.status = statusCode;
    enriched.statusCode = statusCode;
    enriched.routingContext = {
      provider: route.provider,
      oauthProvider: route.config.oauth_provider || route.provider,
      oauthAccount: route.config.oauth_account,
      targetModel: route.model,
      targetApiType,
      statusCode,
      providerResponse,
      rawProviderResponse,
      cooldownTriggered,
      cooldownDuration,
    };

    return enriched;
  }

  private resolveCooldownProviderType(route: RouteResult): string | undefined {
    if (typeof route.config.oauth_provider === 'string' && route.config.oauth_provider.trim()) {
      return route.config.oauth_provider.trim();
    }

    const providerTypes = this.extractProviderTypes(route);
    return providerTypes[0];
  }

  private parseCooldownDurationForProvider(
    providerType: string | undefined,
    errorText: string,
    source: 'HTTP' | 'OAuth'
  ): number | undefined {
    if (!providerType) {
      return undefined;
    }

    const parsedDuration = CooldownParserRegistry.parseCooldown(providerType, errorText);

    if (parsedDuration !== null) {
      logger.info(
        `${source}: Parsed cooldown duration for ${providerType}: ${parsedDuration}ms (${parsedDuration / 1000}s)`
      );
      return parsedDuration;
    }

    logger.debug(`${source}: No cooldown duration parsed for ${providerType}, using default`);
    return undefined;
  }

  private stringifyOAuthProviderResponse(response: unknown): string | undefined {
    if (response === undefined || response === null) {
      return undefined;
    }

    if (typeof response === 'string') {
      return response;
    }

    try {
      return JSON.stringify(response);
    } catch {
      return String(response);
    }
  }

  private async markOAuthProviderFailure(route: RouteResult, oauthError: any): Promise<void> {
    if (!oauthError?.routingContext?.cooldownTriggered) {
      return;
    }

    const failureReason = this.formatFailureReason(oauthError, true);

    await CooldownManager.getInstance().markProviderFailure(
      route.provider,
      route.model,
      oauthError?.routingContext?.cooldownDuration,
      failureReason
    );
  }

  private resolveOAuthInstructions(
    request: UnifiedChatRequest,
    oauthProvider: string
  ): string | undefined {
    const requestInstructions = request.originalBody?.instructions;
    if (typeof requestInstructions === 'string' && requestInstructions.trim()) {
      return requestInstructions;
    }

    const systemMessage = request.messages.find((msg) => msg.role === 'system');
    const developerMessage = (request.messages as any[]).find((msg) => msg.role === 'developer');
    const instructionSource = systemMessage || developerMessage;
    const instructionContent = instructionSource?.content;
    if (typeof instructionContent === 'string' && instructionContent.trim()) {
      return instructionContent;
    }

    if (oauthProvider === 'openai-codex') {
      logger.info('OAuth: Inserted default instructions for openai-codex');
      return 'You are a helpful coding assistant.';
    }

    return undefined;
  }

  /**
   * Determines if pass-through optimization should be used
   */
  private shouldUsePassThrough(
    request: UnifiedChatRequest,
    targetApiType: string,
    route: RouteResult
  ): boolean {
    // If vision fallthrough was applied, we must use the translated pathway
    // to ensure the modified messages (text instead of images) are sent.
    if ((request as any)._hasVisionFallthrough) {
      return false;
    }

    if (this.isClaudeMaskingApiKeyRoute(route, targetApiType)) {
      return false;
    }

    const isCompatible =
      !!request.incomingApiType?.toLowerCase() &&
      request.incomingApiType?.toLowerCase() === targetApiType.toLowerCase();

    return isCompatible && !!request.originalBody;
  }

  /**
   * Transforms the request payload or uses pass-through optimization
   * @returns Transformed payload and bypass flag
   */
  private async transformRequestPayload(
    request: UnifiedChatRequest,
    route: RouteResult,
    transformer: any,
    targetApiType: string
  ): Promise<{ payload: any; bypassTransformation: boolean }> {
    let providerPayload: any;
    let bypassTransformation = false;

    if (this.shouldUsePassThrough(request, targetApiType, route)) {
      logger.debug(
        `Pass-through optimization active: ${request.incomingApiType} -> ${targetApiType}`
      );
      providerPayload = JSON.parse(JSON.stringify(request.originalBody));
      providerPayload.model = route.model;

      // Add metadata from request
      if (request.metadata) {
        const apiMetadata = this.getApiMetadata(request.metadata);
        if (Object.keys(apiMetadata).length > 0) {
          providerPayload.metadata = apiMetadata;
        }
      }

      bypassTransformation = true;
    } else {
      // Inject OAuth provider into metadata so transformers can set provider/model
      // on assistant messages for thought-signature replay (required by Gemini 3).
      const oauthProvider = this.isClaudeMaskingApiKeyRoute(route, targetApiType)
        ? 'anthropic'
        : route.config.oauth_provider || route.provider;
      if (oauthProvider) {
        request = {
          ...request,
          metadata: {
            ...(request.metadata || {}),
            plexus_metadata: {
              ...((request.metadata as any)?.plexus_metadata || {}),
              oauthProvider,
            },
          },
        };
      }
      providerPayload = await transformer.transformRequest(request);
    }

    // Merge provider-level extraBody first
    if (route.config.extraBody) {
      providerPayload = { ...providerPayload, ...route.config.extraBody };
    }

    // Then merge model-level extraBody (overrides provider-level)
    if (route.modelConfig?.extraBody) {
      providerPayload = { ...providerPayload, ...route.modelConfig.extraBody };
    }

    // Apply alias-level advanced behaviors (e.g. strip_adaptive_thinking)
    if (route.canonicalModel) {
      const aliasConfig = getConfig().models?.[route.canonicalModel];
      if (aliasConfig?.advanced) {
        providerPayload = applyModelBehaviors(providerPayload, aliasConfig.advanced, {
          incomingApiType: request.incomingApiType ?? '',
          canonicalModel: route.canonicalModel,
        });
      }
    }

    return { payload: providerPayload, bypassTransformation };
  }

  /**
   * Constructs the full provider request URL
   */
  private buildRequestUrl(
    route: RouteResult,
    transformer: any,
    request: UnifiedChatRequest,
    targetApiType: string
  ): string {
    const baseUrl = this.resolveBaseUrl(route, targetApiType);
    const endpoint = transformer.getEndpoint
      ? transformer.getEndpoint(request)
      : transformer.defaultEndpoint;
    return `${baseUrl}${endpoint}`;
  }

  /**
   * Executes the HTTP POST request to the provider
   */
  private async executeProviderRequest(
    url: string,
    headers: Record<string, string>,
    payload: any
  ): Promise<Response> {
    return await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  }

  /**
   * Handles failed provider responses with cooldown logic
   */
  /**
   * Detects whether an error response body indicates a quota/funds exhaustion error.
   * These patterns should trigger a cooldown even on 400/403 responses.
   */
  private isQuotaExhaustedError(errorText: string): boolean {
    const lower = errorText.toLowerCase();
    return (
      lower.includes('insufficient fund') ||
      lower.includes('insufficient_quota') ||
      lower.includes('insufficient balance') ||
      lower.includes('insufficient_balance') ||
      lower.includes('quota exceeded') ||
      lower.includes('out of credits') ||
      lower.includes('credit balance is too low') ||
      lower.includes('credit_balance_too_low') ||
      lower.includes('account is out of credits') ||
      lower.includes('used up your points') ||
      lower.includes('usage limit') ||
      lower.includes('free plan') ||
      lower.includes('your credit balance') ||
      lower.includes('remaining quota') ||
      lower.includes('payment required') ||
      lower.includes('billing') ||
      lower.includes('no credits') ||
      lower.includes('topup') ||
      lower.includes('top up') ||
      lower.includes('top_up') ||
      lower.includes('rate limit') ||
      lower.includes('rate_limit')
    );
  }

  private async handleProviderError(
    response: Response,
    route: RouteResult,
    errorText: string,
    url?: string,
    headers?: Record<string, string>,
    targetApiType?: string,
    requestId?: string
  ): Promise<never> {
    logger.error(`Provider error: ${response.status} ${errorText}`);

    const cooldownManager = CooldownManager.getInstance();

    // 400s are ambiguous: they can be caller errors (bad prompt, invalid params) OR provider-side
    // quota/balance exhaustion. Only trigger cooldown for the latter.
    const isQuota400 =
      response.status === 400 &&
      QUOTA_ERROR_PATTERNS.some((p) => errorText.toLowerCase().includes(p.toLowerCase()));

    if (isQuota400) {
      logger.warn(
        `Detected quota/balance error in 400 response from ${route.provider}/${route.model}`
      );
    }

    // Trigger cooldown for all provider errors except:
    // - 413 (payload too large) and 422 (unprocessable entity): caller errors, not provider failures
    // - 400 without a quota pattern: likely a request validation error, not a provider failure
    const isCallerError =
      response.status === 413 ||
      response.status === 422 ||
      (response.status === 400 && !isQuota400);

    if (!isCallerError) {
      let cooldownDuration: number | undefined;

      // For 429 errors, try to parse provider-specific cooldown duration
      if (response.status === 429) {
        // Get provider type for parser lookup
        cooldownDuration = this.parseCooldownDurationForProvider(
          this.resolveCooldownProviderType(route),
          errorText,
          'HTTP'
        );
      }

      // Mark provider+model as failed with optional duration
      // For non-429 errors, cooldownDuration will be undefined and default (10 minutes) will be used
      cooldownManager.markProviderFailure(
        route.provider,
        route.model,
        cooldownDuration,
        `HTTP ${response.status}: ${errorText.slice(0, 500)}`
      );
    }

    // Create enriched error with routing context
    const error = new Error(`Provider failed: ${response.status} ${errorText}`) as any;
    error.routingContext = {
      provider: route.provider,
      targetModel: route.model,
      targetApiType: targetApiType,
      url: url,
      headers: this.sanitizeHeaders(headers || {}),
      statusCode: response.status,
      providerResponse: errorText,
      cooldownTriggered: !isCallerError,
    };

    // Capture the raw error response for debug logs
    if (requestId) {
      DebugManager.getInstance().addRawResponse(requestId, errorText);
    }

    throw error;
  }

  /**
   * Sanitize headers to remove sensitive information before logging
   */
  private sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    const sanitized = { ...headers };

    // Mask sensitive headers
    if (sanitized['x-api-key']) {
      sanitized['x-api-key'] = this.maskSecret(sanitized['x-api-key']);
    }
    if (sanitized['Authorization']) {
      sanitized['Authorization'] = this.maskSecret(sanitized['Authorization']);
    }
    if (sanitized['x-goog-api-key']) {
      sanitized['x-goog-api-key'] = this.maskSecret(sanitized['x-goog-api-key']);
    }

    return sanitized;
  }

  /**
   * Mask secret values, showing only first and last few characters
   */
  private maskSecret(value: string): string {
    if (value.length <= 8) return '***';

    // For Bearer tokens, preserve the "Bearer " prefix
    if (value.startsWith('Bearer ')) {
      const token = value.substring(7);
      if (token.length <= 8) return 'Bearer ***';
      return `Bearer ${token.substring(0, 4)}...${token.substring(token.length - 4)}`;
    }

    return `${value.substring(0, 4)}...${value.substring(value.length - 4)}`;
  }

  /**
   * Enriches response with Plexus metadata
   */
  private enrichResponseWithMetadata(
    response: UnifiedChatResponse,
    route: RouteResult,
    targetApiType: string
  ): void {
    response.plexus = {
      provider: route.provider,
      model: route.model,
      apiType: targetApiType,
      pricing: route.modelConfig?.pricing,
      providerDiscount: route.config.discount,
      canonicalModel: route.canonicalModel,
      config: route.config,
    };
  }

  /**
   * Handles streaming responses
   */
  private handleStreamingResponse(
    response: Response,
    request: UnifiedChatRequest,
    route: RouteResult,
    targetApiType: string,
    bypassTransformation: boolean
  ): UnifiedChatResponse {
    logger.debug('Streaming response detected');

    const rawStream = response.body!;

    const streamResponse: UnifiedChatResponse = {
      id: 'stream-' + Date.now(),
      model: request.model,
      content: null,
      stream: rawStream,
      bypassTransformation: bypassTransformation,
    };

    this.enrichResponseWithMetadata(streamResponse, route, targetApiType);

    return streamResponse;
  }

  /**
   * Handles non-streaming responses
   */
  private async handleNonStreamingResponse(
    response: Response,
    request: UnifiedChatRequest,
    route: RouteResult,
    targetApiType: string,
    transformer: any,
    bypassTransformation: boolean
  ): Promise<UnifiedChatResponse> {
    const responseBody = await this.parseJsonResponseBody(
      response,
      request.requestId,
      route,
      targetApiType
    );
    logger.silly('Upstream Response Payload', responseBody);

    if (request.requestId) {
      DebugManager.getInstance().addRawResponse(request.requestId, responseBody);
    }

    let unifiedResponse: UnifiedChatResponse;

    if (bypassTransformation) {
      // We still need unified response for usage stats, so we transform purely for that
      // But we set the bypass flag and attach raw response
      const syntheticResponse = await transformer.transformResponse(responseBody);
      unifiedResponse = {
        ...syntheticResponse,
        bypassTransformation: true,
        rawResponse: responseBody,
      };
    } else {
      unifiedResponse = await transformer.transformResponse(responseBody);
    }

    this.enrichResponseWithMetadata(unifiedResponse, route, targetApiType);

    return unifiedResponse;
  }

  /**
   * Dispatch embeddings request to provider
   * Simplified version of dispatch() since embeddings:
   * - Don't support streaming
   * - Use universal API format (no transformation needed)
   * - Always use /embeddings endpoint
   */
  async dispatchEmbeddings(request: any): Promise<any> {
    const config = getConfig();
    const failover = config.failover;
    const failoverEnabled = failover?.enabled !== false;

    let candidates = await Router.resolveCandidates(request.model, 'embeddings');
    if (candidates.length === 0) {
      const singleRoute = await Router.resolve(request.model, 'embeddings');
      candidates = [singleRoute];
    }

    const targets = failoverEnabled ? candidates : [candidates[0]!];
    const attemptedProviders: string[] = [];
    const retryHistory: RetryAttemptRecord[] = [];
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
        this.appendSkippedAttempt(
          retryHistory,
          route,
          `Provider ${route.provider}/${route.model} is on cooldown`,
          'embeddings'
        );
        continue;
      }

      attemptedProviders.push(`${route.provider}/${route.model}`);

      try {
        const baseUrl = this.resolveBaseUrl(route, 'embeddings');
        const url = `${baseUrl}/embeddings`;

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

        const payload = {
          ...request.originalBody,
          model: route.model,
        };

        if (route.config.extraBody) {
          Object.assign(payload, route.config.extraBody);
        }

        logger.info(`Dispatching embeddings ${request.model} to ${route.provider}:${route.model}`);
        logger.silly('Embeddings Request Payload', payload);

        if (request.requestId) {
          DebugManager.getInstance().addTransformedRequest(request.requestId, payload);
        }

        const response = await this.executeProviderRequest(url, headers, payload);

        if (!response.ok) {
          const errorText = await response.text();
          logger.error(`Embeddings request failed: ${url}`, {
            status: response.status,
            error: errorText,
          });
          const canRetry =
            failoverEnabled &&
            i < targets.length - 1 &&
            this.isRetryableStatus(response.status, failover?.retryableStatusCodes || []);

          try {
            await this.handleProviderError(
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
            this.appendFailureAttempt(retryHistory, route, e, 'embeddings', canRetry);
            if (canRetry) {
              await this.recordAttemptMetric(route, request.requestId, false);
              // Only mark as failed if cooldown was actually triggered (not a caller error)
              if (e?.routingContext?.cooldownTriggered) {
                CooldownManager.getInstance().markProviderFailure(
                  route.provider,
                  route.model,
                  undefined,
                  this.formatFailureReason(e, true)
                );
              }
              logger.warn(
                `Failover: retrying embeddings after HTTP ${response.status} from ${route.provider}/${route.model}`
              );
              continue;
            }
            throw e;
          }
        }

        const responseBody = await response.json();
        logger.silly('Embeddings Response Payload', responseBody);

        if (request.requestId) {
          DebugManager.getInstance().addRawResponse(request.requestId, responseBody);
        }

        const enrichedResponse: any = {
          ...responseBody,
          plexus: {
            provider: route.provider,
            model: route.model,
            apiType: 'embeddings',
            pricing: route.modelConfig?.pricing,
            providerDiscount: route.config.discount,
            canonicalModel: route.canonicalModel,
            config: route.config,
          },
        };

        await this.recordAttemptMetric(route, request.requestId, true);
        this.appendSuccessAttempt(retryHistory, route, 'embeddings');
        this.attachAttemptMetadata(
          enrichedResponse,
          attemptedProviders,
          retryHistory,
          route,
          'embeddings'
        );
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
            this.formatFailureReason(error)
          );
        }
        await this.recordAttemptMetric(route, request.requestId, false);

        const canRetryNetwork =
          failoverEnabled &&
          i < targets.length - 1 &&
          this.isRetryableNetworkError(error, failover?.retryableErrors || []);

        this.appendFailureAttempt(retryHistory, route, error, 'embeddings', canRetryNetwork);

        if (canRetryNetwork) {
          logger.warn(
            `Failover: retrying embeddings after network/transport error from ${route.provider}/${route.model}: ${error.message}`
          );
          continue;
        }

        throw this.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
      }
    }

    throw this.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
  }

  /**
   * Dispatches audio transcription requests
   * Handles multipart/form-data file uploads to OpenAI-compatible transcription endpoints
   */
  async dispatchTranscription(
    request: UnifiedTranscriptionRequest
  ): Promise<UnifiedTranscriptionResponse> {
    const { TranscriptionsTransformer } = await import('../transformers/transcriptions');
    const transformer = new TranscriptionsTransformer();

    const config = getConfig();
    const failover = config.failover;
    const failoverEnabled = failover?.enabled !== false;

    let candidates = await Router.resolveCandidates(request.model, 'transcriptions');
    if (candidates.length === 0) {
      const singleRoute = await Router.resolve(request.model, 'transcriptions');
      candidates = [singleRoute];
    }

    const targets = failoverEnabled ? candidates : [candidates[0]!];
    const attemptedProviders: string[] = [];
    const retryHistory: RetryAttemptRecord[] = [];
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
        this.appendSkippedAttempt(
          retryHistory,
          route,
          `Provider ${route.provider}/${route.model} is on cooldown`,
          'transcriptions'
        );
        continue;
      }

      attemptedProviders.push(`${route.provider}/${route.model}`);

      try {
        const baseUrl = this.resolveBaseUrl(route, 'transcriptions');
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

        if (!response.ok) {
          const errorText = await response.text();
          const canRetry =
            failoverEnabled &&
            i < targets.length - 1 &&
            this.isRetryableStatus(response.status, failover?.retryableStatusCodes || []);

          try {
            await this.handleProviderError(
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
            this.appendFailureAttempt(retryHistory, route, e, 'transcriptions', canRetry);
            if (canRetry) {
              await this.recordAttemptMetric(route, request.requestId, false);
              // Only mark as failed if cooldown was actually triggered (not a caller error)
              if (e?.routingContext?.cooldownTriggered) {
                CooldownManager.getInstance().markProviderFailure(
                  route.provider,
                  route.model,
                  undefined,
                  this.formatFailureReason(e, true)
                );
              }
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

        await this.recordAttemptMetric(route, request.requestId, true);
        this.appendSuccessAttempt(retryHistory, route, 'transcriptions');
        this.attachAttemptMetadata(
          unifiedResponse,
          attemptedProviders,
          retryHistory,
          route,
          'transcriptions'
        );
        return unifiedResponse;
      } catch (error: any) {
        lastError = error;
        // handleProviderError already called markProviderFailure for HTTP errors.
        // Only call it here for pure network/transport errors (no statusCode).
        if (error?.routingContext?.statusCode === undefined) {
          CooldownManager.getInstance().markProviderFailure(
            route.provider,
            route.model,
            undefined,
            this.formatFailureReason(error)
          );
        }
        await this.recordAttemptMetric(route, request.requestId, false);

        const canRetryNetwork =
          failoverEnabled &&
          i < targets.length - 1 &&
          this.isRetryableNetworkError(error, failover?.retryableErrors || []);

        this.appendFailureAttempt(retryHistory, route, error, 'transcriptions', canRetryNetwork);

        if (canRetryNetwork) {
          logger.warn(
            `Failover: retrying transcription after network/transport error from ${route.provider}/${route.model}: ${error.message}`
          );
          continue;
        }

        throw this.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
      }
    }

    throw this.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
  }

  /**
   * Dispatches text-to-speech requests
   * Handles JSON body requests to OpenAI-compatible speech endpoints
   * Supports both binary audio responses and SSE streaming
   */
  async dispatchSpeech(request: UnifiedSpeechRequest): Promise<UnifiedSpeechResponse> {
    const { SpeechTransformer } = await import('../transformers/speech');
    const transformer = new SpeechTransformer();

    const config = getConfig();
    const failover = config.failover;
    const failoverEnabled = failover?.enabled !== false;

    let candidates = await Router.resolveCandidates(request.model, 'speech');
    if (candidates.length === 0) {
      const singleRoute = await Router.resolve(request.model, 'speech');
      candidates = [singleRoute];
    }

    const targets = failoverEnabled ? candidates : [candidates[0]!];
    const attemptedProviders: string[] = [];
    const retryHistory: RetryAttemptRecord[] = [];
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
        this.appendSkippedAttempt(
          retryHistory,
          route,
          `Provider ${route.provider}/${route.model} is on cooldown`,
          'speech'
        );
        continue;
      }

      attemptedProviders.push(`${route.provider}/${route.model}`);

      try {
        const baseUrl = this.resolveBaseUrl(route, 'speech');
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

        if (!response.ok) {
          const errorText = await response.text();
          const canRetry =
            failoverEnabled &&
            i < targets.length - 1 &&
            this.isRetryableStatus(response.status, failover?.retryableStatusCodes || []);

          try {
            await this.handleProviderError(
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
            this.appendFailureAttempt(retryHistory, route, e, 'speech', canRetry);
            if (canRetry) {
              await this.recordAttemptMetric(route, request.requestId, false);
              // Only mark as failed if cooldown was actually triggered (not a caller error)
              if (e?.routingContext?.cooldownTriggered) {
                CooldownManager.getInstance().markProviderFailure(
                  route.provider,
                  route.model,
                  undefined,
                  this.formatFailureReason(e, true)
                );
              }
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
          const streamProbe = await this.probeStreamingStart(response);

          if (!streamProbe.ok) {
            const error = streamProbe.error;
            lastError = error;

            const canRetry =
              failoverEnabled &&
              i < targets.length - 1 &&
              !streamProbe.streamStarted &&
              this.isRetryableNetworkError(error, failover?.retryableErrors || []);

            if (canRetry) {
              await this.recordAttemptMetric(route, request.requestId, false);
              this.appendFailureAttempt(retryHistory, route, error, 'speech', true);
              // Always mark as failed when retrying — provider couldn't serve this request
              CooldownManager.getInstance().markProviderFailure(
                route.provider,
                route.model,
                undefined,
                error.message
              );
              logger.warn(
                `Failover: retrying speech stream before first byte after ${route.provider}/${route.model} failure: ${error.message}`
              );
              continue;
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

        await this.recordAttemptMetric(route, request.requestId, true);
        this.appendSuccessAttempt(retryHistory, route, 'speech');
        this.attachAttemptMetadata(
          unifiedResponse,
          attemptedProviders,
          retryHistory,
          route,
          'speech'
        );
        return unifiedResponse;
      } catch (error: any) {
        lastError = error;
        // handleProviderError already called markProviderFailure for HTTP errors.
        // Only call it here for pure network/transport errors (no statusCode).
        if (error?.routingContext?.statusCode === undefined) {
          CooldownManager.getInstance().markProviderFailure(
            route.provider,
            route.model,
            undefined,
            this.formatFailureReason(error)
          );
        }
        await this.recordAttemptMetric(route, request.requestId, false);

        const canRetryNetwork =
          failoverEnabled &&
          i < targets.length - 1 &&
          this.isRetryableNetworkError(error, failover?.retryableErrors || []);

        this.appendFailureAttempt(retryHistory, route, error, 'speech', canRetryNetwork);

        if (canRetryNetwork) {
          logger.warn(
            `Failover: retrying speech after network/transport error from ${route.provider}/${route.model}: ${error.message}`
          );
          continue;
        }

        throw this.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
      }
    }

    throw this.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
  }

  /**
   * Dispatches image generation requests
   * Handles JSON body requests to OpenAI-compatible image generation endpoints
   */
  async dispatchImageGenerations(
    request: UnifiedImageGenerationRequest
  ): Promise<UnifiedImageGenerationResponse> {
    const { ImageTransformer } = await import('../transformers/image');
    const transformer = new ImageTransformer();

    const config = getConfig();
    const failover = config.failover;
    const failoverEnabled = failover?.enabled !== false;

    let candidates = await Router.resolveCandidates(request.model, 'images');
    if (candidates.length === 0) {
      const singleRoute = await Router.resolve(request.model, 'images');
      candidates = [singleRoute];
    }

    const targets = failoverEnabled ? candidates : [candidates[0]!];
    const attemptedProviders: string[] = [];
    const retryHistory: RetryAttemptRecord[] = [];
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
        this.appendSkippedAttempt(
          retryHistory,
          route,
          `Provider ${route.provider}/${route.model} is on cooldown`,
          'images'
        );
        continue;
      }

      attemptedProviders.push(`${route.provider}/${route.model}`);

      try {
        const baseUrl = this.resolveBaseUrl(route, 'images');
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

        if (!response.ok) {
          const errorText = await response.text();
          const canRetry =
            failoverEnabled &&
            i < targets.length - 1 &&
            this.isRetryableStatus(response.status, failover?.retryableStatusCodes || []);

          try {
            await this.handleProviderError(
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
            this.appendFailureAttempt(retryHistory, route, e, 'images', canRetry);
            if (canRetry) {
              await this.recordAttemptMetric(route, request.requestId, false);
              // Only mark as failed if cooldown was actually triggered (not a caller error)
              if (e?.routingContext?.cooldownTriggered) {
                CooldownManager.getInstance().markProviderFailure(
                  route.provider,
                  route.model,
                  undefined,
                  this.formatFailureReason(e, true)
                );
              }
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

        await this.recordAttemptMetric(route, request.requestId, true);
        this.appendSuccessAttempt(retryHistory, route, 'images');
        this.attachAttemptMetadata(
          unifiedResponse,
          attemptedProviders,
          retryHistory,
          route,
          'images'
        );
        return unifiedResponse;
      } catch (error: any) {
        lastError = error;
        // handleProviderError already called markProviderFailure for HTTP errors.
        // Only call it here for pure network/transport errors (no statusCode).
        if (error?.routingContext?.statusCode === undefined) {
          CooldownManager.getInstance().markProviderFailure(
            route.provider,
            route.model,
            undefined,
            this.formatFailureReason(error)
          );
        }
        await this.recordAttemptMetric(route, request.requestId, false);

        const canRetryNetwork =
          failoverEnabled &&
          i < targets.length - 1 &&
          this.isRetryableNetworkError(error, failover?.retryableErrors || []);

        this.appendFailureAttempt(retryHistory, route, error, 'images', canRetryNetwork);

        if (canRetryNetwork) {
          logger.warn(
            `Failover: retrying image generation after network/transport error from ${route.provider}/${route.model}: ${error.message}`
          );
          continue;
        }

        throw this.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
      }
    }

    throw this.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
  }

  /**
   * Dispatches image editing requests
   * Handles multipart/form-data requests to OpenAI-compatible image editing endpoints
   * Supports single image upload with optional mask
   */
  async dispatchImageEdits(request: UnifiedImageEditRequest): Promise<UnifiedImageEditResponse> {
    const { ImageTransformer } = await import('../transformers/image');
    const transformer = new ImageTransformer();

    const config = getConfig();
    const failover = config.failover;
    const failoverEnabled = failover?.enabled !== false;

    let candidates = await Router.resolveCandidates(request.model, 'images');
    if (candidates.length === 0) {
      const singleRoute = await Router.resolve(request.model, 'images');
      candidates = [singleRoute];
    }

    const targets = failoverEnabled ? candidates : [candidates[0]!];
    const attemptedProviders: string[] = [];
    const retryHistory: RetryAttemptRecord[] = [];
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
        this.appendSkippedAttempt(
          retryHistory,
          route,
          `Provider ${route.provider}/${route.model} is on cooldown`,
          'images'
        );
        continue;
      }

      attemptedProviders.push(`${route.provider}/${route.model}`);

      try {
        const baseUrl = this.resolveBaseUrl(route, 'images');
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

        if (!response.ok) {
          const errorText = await response.text();
          const canRetry =
            failoverEnabled &&
            i < targets.length - 1 &&
            this.isRetryableStatus(response.status, failover?.retryableStatusCodes || []);

          try {
            await this.handleProviderError(
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
            this.appendFailureAttempt(retryHistory, route, e, 'images', canRetry);
            if (canRetry) {
              await this.recordAttemptMetric(route, request.requestId, false);
              // Only mark as failed if cooldown was actually triggered (not a caller error)
              if (e?.routingContext?.cooldownTriggered) {
                CooldownManager.getInstance().markProviderFailure(
                  route.provider,
                  route.model,
                  undefined,
                  this.formatFailureReason(e, true)
                );
              }
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

        await this.recordAttemptMetric(route, request.requestId, true);
        this.appendSuccessAttempt(retryHistory, route, 'images');
        this.attachAttemptMetadata(
          unifiedResponse,
          attemptedProviders,
          retryHistory,
          route,
          'images'
        );
        return unifiedResponse;
      } catch (error: any) {
        lastError = error;
        // handleProviderError already called markProviderFailure for HTTP errors.
        // Only call it here for pure network/transport errors (no statusCode).
        if (error?.routingContext?.statusCode === undefined) {
          CooldownManager.getInstance().markProviderFailure(
            route.provider,
            route.model,
            undefined,
            this.formatFailureReason(error)
          );
        }
        await this.recordAttemptMetric(route, request.requestId, false);

        const canRetryNetwork =
          failoverEnabled &&
          i < targets.length - 1 &&
          this.isRetryableNetworkError(error, failover?.retryableErrors || []);

        this.appendFailureAttempt(retryHistory, route, error, 'images', canRetryNetwork);

        if (canRetryNetwork) {
          logger.warn(
            `Failover: retrying image edit after network/transport error from ${route.provider}/${route.model}: ${error.message}`
          );
          continue;
        }

        throw this.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
      }
    }

    throw this.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
  }
}
