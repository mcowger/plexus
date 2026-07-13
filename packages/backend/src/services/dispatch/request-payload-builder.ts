import type { UnifiedChatRequest } from '../../types/unified';
import { getConfig } from '../../config';
import { getApiBaseType } from '../../utils/api-format';
import { logger } from '../../utils/logger';
import { applyModelBehaviors } from '../models/model-behaviors';
import type { RouteResult } from '../routing/router';
import type { ResolvedAdapter } from '../../types/provider-adapter';
import { applyGeminiThinkingConfig, getApiMetadata } from '../providers/provider-api-selection';
import { isClaudeMaskingApiKeyRoute, isPiAiRoute } from '../oauth/oauth-dispatcher';
import { applyRegistryAutoCompat, hasCodexResponsesExtensions } from './dispatcher-auto-compat';

export interface RequestPayload {
  payload: any;
  bypassTransformation: boolean;
}

function shouldUsePassThrough(
  request: UnifiedChatRequest,
  targetApiType: string,
  route: RouteResult
): boolean {
  if ((request as any)._hasVisionFallthrough || isPiAiRoute(route, targetApiType)) {
    return false;
  }

  if (
    getApiBaseType(targetApiType) === 'responses' &&
    hasCodexResponsesExtensions(request.originalBody)
  ) {
    return false;
  }

  return (
    !!request.incomingApiType?.toLowerCase() &&
    request.incomingApiType.toLowerCase() === targetApiType.toLowerCase() &&
    !!request.originalBody
  );
}

/** Builds the provider payload after transformation, configuration, and adapters. */
export async function buildRequestPayload(
  request: UnifiedChatRequest,
  route: RouteResult,
  transformer: any,
  targetApiType: string,
  adapters: ResolvedAdapter[] = []
): Promise<RequestPayload> {
  const bypassTransformation = shouldUsePassThrough(request, targetApiType, route);
  let payload: any;

  if (bypassTransformation) {
    logger.debug(
      `Pass-through optimization active: ${request.incomingApiType} -> ${targetApiType}` +
        (adapters.length > 0 ? ` (with ${adapters.length} adapter(s))` : '')
    );
    payload = JSON.parse(JSON.stringify(request.originalBody));
    payload.model = route.model;

    if (request.metadata) {
      const apiMetadata = getApiMetadata(request.metadata);
      if (Object.keys(apiMetadata).length > 0) payload.metadata = apiMetadata;
    }
  } else {
    const oauthProvider = isClaudeMaskingApiKeyRoute(route, targetApiType)
      ? 'anthropic'
      : route.config.oauth_provider || route.provider;
    const requestWithOAuthProvider = oauthProvider
      ? {
          ...request,
          metadata: {
            ...(request.metadata || {}),
            plexus_metadata: {
              ...((request.metadata as any)?.plexus_metadata || {}),
              oauthProvider,
            },
          },
        }
      : request;
    payload = await transformer.transformRequest(requestWithOAuthProvider);
  }

  payload = applyGeminiThinkingConfig(route, targetApiType, payload);
  payload = applyRegistryAutoCompat(payload, request, route, targetApiType);

  if (route.config.extraBody) payload = { ...payload, ...route.config.extraBody };
  if (route.modelConfig?.extraBody) payload = { ...payload, ...route.modelConfig.extraBody };

  if (route.canonicalModel) {
    const aliasConfig = getConfig().models?.[route.canonicalModel];
    if (aliasConfig?.extraBody) payload = { ...payload, ...aliasConfig.extraBody };
    if (aliasConfig?.advanced) {
      payload = applyModelBehaviors(payload, aliasConfig.advanced, {
        incomingApiType: request.incomingApiType ?? '',
        canonicalModel: route.canonicalModel,
      });
    }
  }

  for (const { adapter, options } of adapters) {
    payload = adapter.preDispatch(payload, options);
  }

  if (adapters.length > 0) {
    logger.debug(
      `Adapters applied (preDispatch): [${adapters.map((entry) => entry.adapter.name).join(', ')}] ` +
        `for ${route.provider}/${route.model}`
    );
  }

  return { payload, bypassTransformation };
}
