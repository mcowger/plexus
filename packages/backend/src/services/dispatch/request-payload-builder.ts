import type { UnifiedChatRequest } from '../../types/unified';
import { getConfig } from '../../config';
import { getApiBaseType } from '../../utils/api-format';
import { logger } from '../../utils/logger';
import { applyModelBehaviors } from '../models/model-behaviors';
import type { RouteResult } from '../routing/router';
import type { ResolvedAdapter } from '../../types/provider-adapter';
import { applyGeminiThinkingConfig, getApiMetadata } from '../providers/provider-api-selection';
import { isClaudeMaskingApiKeyRoute, isPiAiRoute } from '../oauth/oauth-dispatcher';
import {
  isCodexCliShapedBody,
  isNativeOAuthProvider,
  prepareNativeOAuthDispatch,
  type PreparedOAuthRequest,
} from '../oauth/oauth-native-request';
import { applyRegistryAutoCompat, hasCodexResponsesExtensions } from './dispatcher-auto-compat';

/** Symbol stash for the native OAuth prep, read by the standard dispatch seams. */
export const NATIVE_OAUTH_STASH = Symbol('nativeOAuthPrep');

/**
 * Is this a Claude/Anthropic route served by the native (non-pi-ai) path?
 * Covers BOTH Anthropic paths so NO Claude traffic touches the pi-ai executor:
 *   - Anthropic OAuth (`oauth://`, provider anthropic)
 *   - Claude-masking API-key route (`useClaudeMasking`, provider-name-agnostic)
 */
export function isNativeOAuthRoute(route: RouteResult, targetApiType: string): boolean {
  if (isClaudeMaskingApiKeyRoute(route, targetApiType)) return true;
  if (!isOAuthRouteForNative(route, targetApiType)) return false;
  const provider = route.config.oauth_provider || route.provider;
  return isNativeOAuthProvider(provider);
}

function isOAuthRouteForNative(route: RouteResult, targetApiType: string): boolean {
  if (targetApiType.toLowerCase() === 'oauth') return true;
  if (typeof route.config.api_base_url === 'string') {
    return route.config.api_base_url.startsWith('oauth://');
  }
  const urlMap = route.config.api_base_url as Record<string, string>;
  return Object.values(urlMap).some((value) => value.startsWith('oauth://'));
}

export interface RequestPayload {
  payload: any;
  bypassTransformation: boolean;
}

function shouldUsePassThrough(
  request: UnifiedChatRequest,
  targetApiType: string,
  route: RouteResult
): boolean {
  // Native OAuth (Anthropic) runs through the standard path and IS eligible for
  // same-format pass-through — only the pi-ai executor routes (Codex/Copilot)
  // need the IR and must skip pass-through.
  const nativeOAuth = isNativeOAuthRoute(route, targetApiType);
  if (
    (request as any)._hasVisionFallthrough ||
    (isPiAiRoute(route, targetApiType) && !nativeOAuth)
  ) {
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
  const nativeOAuth = isNativeOAuthRoute(route, targetApiType);

  // Codex two-path decision. A genuine Codex CLI body
  // is sent to the ChatGPT backend VERBATIM (pass-through), including its native
  // custom/namespace tool extensions — so we override the
  // `hasCodexResponsesExtensions` flattening that `shouldUsePassThrough` applies
  // (that flattening is for routing to NON-Codex providers). Any other Responses
  // request is forced through the transformer + adorned for the backend, even
  // though incoming == target == responses.
  const oauthProviderForNative = isClaudeMaskingApiKeyRoute(route, targetApiType)
    ? 'anthropic'
    : route.config.oauth_provider || route.provider;
  const codexNative = nativeOAuth && oauthProviderForNative === 'openai-codex';
  const copilotNative = nativeOAuth && oauthProviderForNative === 'github-copilot';
  const codexCliPassthrough = codexNative && isCodexCliShapedBody(request.originalBody);

  let bypassTransformation: boolean;
  if (codexNative) {
    bypassTransformation = codexCliPassthrough;
  } else {
    // Anthropic and Copilot: standard same-format pass-through detection. For
    // Copilot this is authoritative (multi-API: a client may send a format the
    // target model's wire API doesn't match, requiring response translation);
    // Anthropic clients are always same-format in practice.
    bypassTransformation = shouldUsePassThrough(request, targetApiType, route);
  }
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

  // Native OAuth (currently Anthropic): the payload above is already the correct
  // provider-native wire body (pass-through of the client's Messages body, or a
  // cross-format transform to it). Layer the CC masking/fingerprint + OAuth
  // token resolution on top, and stash the resolved URL/headers/reverse-frame
  // for the standard dispatch seams. No pi-ai Context IR, no piAiModels.stream.
  // This is the ONLY OAuth-specific step — one path, masking
  // applied when the selected target is an OAuth target.
  if (nativeOAuth) {
    const maskingApiKeyRoute = isClaudeMaskingApiKeyRoute(route, targetApiType);
    const provider = (
      maskingApiKeyRoute ? 'anthropic' : route.config.oauth_provider || route.provider
    ) as string;
    const prepared: PreparedOAuthRequest = await prepareNativeOAuthDispatch({
      provider: provider as any,
      modelId: route.model,
      nativeBody: payload,
      streaming: !!request.stream,
      oauthAccountId: route.config.oauth_account?.trim(),
      maskingApiKey: maskingApiKeyRoute ? (route.config.api_key ?? '') : null,
      codexPassthrough: codexCliPassthrough,
      // `targetApiType` here is the resolved wire type (effectiveApiType) that
      // request-manager passes for native OAuth routes — Copilot needs it to
      // pick the right endpoint (chat/messages/responses).
      apiType: targetApiType,
    });
    (route as any)[NATIVE_OAUTH_STASH] = prepared;
    logger.debug(
      `Native OAuth payload prepared for ${provider}/${route.model} (url=${prepared.url})`
    );
    // Codex CLI and Responses clients receive the native Responses stream.
    // Cross-format Codex requests must translate the response back to the
    // incoming client format. Anthropic remains raw pass-through, while
    // Copilot honors its computed same-format decision.
    const incomingIsResponses =
      getApiBaseType(request.incomingApiType?.toLowerCase() ?? '') === 'responses';
    const nativeBypass = codexNative
      ? codexCliPassthrough || incomingIsResponses
      : copilotNative
        ? bypassTransformation
        : true;
    return { payload: prepared.body, bypassTransformation: nativeBypass };
  }

  return { payload, bypassTransformation };
}
