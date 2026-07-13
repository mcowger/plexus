import { DEFAULT_GPU_PARAMS, resolveModelParams } from '@plexus/shared';
import type { RouteResult } from '../routing/router';
import type { RetryAttemptRecord } from './dispatcher-types';

export type FailureReasonFormatter = (error: any, includeStatusCode?: boolean) => string;
export type ErrorSummaryFormatter = (value: unknown) => string;

export function appendSkippedAttempt(
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

export function appendSuccessAttempt(
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

export function appendFailureAttempt(
  retryHistory: RetryAttemptRecord[],
  route: RouteResult,
  error: any,
  formatFailureReason: FailureReasonFormatter,
  apiType?: string,
  retryable?: boolean
): void {
  const statusCode = error?.routingContext?.statusCode ?? error?.status ?? error?.statusCode;
  retryHistory.push({
    index: retryHistory.length + 1,
    provider: route.provider,
    model: route.model,
    apiType,
    status: 'failed',
    reason: formatFailureReason(error),
    statusCode: typeof statusCode === 'number' ? statusCode : undefined,
    retryable,
    providerResponseHeaders: error?.routingContext?.providerResponseHeaders,
  });
}

export function attachAttemptMetadata(
  response: any,
  attemptedProviders: string[],
  retryHistory: RetryAttemptRecord[],
  finalRoute: RouteResult,
  apiType: string
): void {
  const responseApiType = response?.plexus?.apiType;
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
    apiType: responseApiType || apiType,
    pricing: finalRoute.modelConfig?.pricing,
    providerDiscount: finalRoute.config.discount,
    config: { estimateTokens: finalRoute.config.estimateTokens },
    gpuParams: {
      ram_gb: finalRoute.config.gpu_ram_gb ?? DEFAULT_GPU_PARAMS.ram_gb,
      bandwidth_tb_s: finalRoute.config.gpu_bandwidth_tb_s ?? DEFAULT_GPU_PARAMS.bandwidth_tb_s,
      flops_tflop: finalRoute.config.gpu_flops_tflop ?? DEFAULT_GPU_PARAMS.flops_tflop,
      power_draw_watts:
        finalRoute.config.gpu_power_draw_watts ?? DEFAULT_GPU_PARAMS.power_draw_watts,
    },
    modelParams: resolveModelParams(finalRoute.modelArchitecture),
  } as any;
}

export function buildAllTargetsFailedError(
  lastError: any,
  attemptedProviders: string[],
  retryHistory: RetryAttemptRecord[],
  formatFailureReason: FailureReasonFormatter,
  compactErrorSummary: ErrorSummaryFormatter
): Error {
  const summary = attemptedProviders.length > 0 ? attemptedProviders.join(', ') : 'none';
  const baseMessage = compactErrorSummary(
    formatFailureReason(lastError) || lastError?.message || 'Unknown provider error'
  );
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
