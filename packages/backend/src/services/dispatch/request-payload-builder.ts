import type { UnifiedChatRequest } from '../../types/unified';
import { getConfig } from '../../config';
import { getApiBaseType, getApiSubtype } from '../../utils/api-format';
import { logger } from '../../utils/logger';
import { applyModelBehaviors } from '../models/model-behaviors';
import type { RouteResult } from '../routing/router';
import type { ResolvedAdapter } from '../../types/provider-adapter';
import { applyGeminiThinkingConfig, getApiMetadata } from '../providers/provider-api-selection';
import { isClaudeMaskingApiKeyRoute, isPiAiRoute } from '../oauth/oauth-dispatcher';
import {
  isCodexCliShapedBody,
  isNativeOAuthProvider,
  prepareGenericOAuthDispatch,
  prepareNativeOAuthDispatch,
  type PreparedOAuthRequest,
} from '../oauth/oauth-native-request';
import {
  applyRegistryAutoCompat,
  hasCodexResponsesExtensions,
  stripLiteUnsupportedTools,
} from './dispatcher-auto-compat';
import { appendUserAfterTextOnlyModelTail } from '../../transformers/gemini/utils/model-tail';

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

  // Only force the transform pipeline when the target fell back to the bare
  // `responses` type (no explicit Lite support advertised) — NOT any
  // `responses:<subtype>` match. A target that matches the `responses:lite`
  // subtype EXACTLY has been deliberately configured as Codex-native —
  // verified live against both providers currently marked `responses:lite`
  // (see dispatcher-api-subtype.test.ts): both correctly parse raw
  // `additional_tools`/`custom`/`namespace` wire extensions and invoke tools
  // without flattening. That's the whole point of the subtype: avoid the
  // transform pipeline where the target has opted in. Providers that only
  // match on the base type haven't made that claim, so they still get the
  // defensive flatten. Checked via getApiBaseType/getApiSubtype (not a naive
  // `=== 'responses'` string compare) so this expresses the actual intent —
  // "base type only, no subtype" — rather than "not literally 'responses'",
  // which would silently stop flattening for any FUTURE `responses:<other>`
  // subtype too, not just `lite`.
  if (
    getApiBaseType(targetApiType) === 'responses' &&
    getApiSubtype(targetApiType) !== 'lite' &&
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
  // Any other OAuth-style route (an `oauth://` provider that isn't one of the
  // native ones, and never the Claude-masking API-key route — that always
  // resolves to native Anthropic). Config validation already restricts
  // `oauth_provider` to providers pi-ai actually supports, so this is any
  // pi-ai OAuth provider Plexus doesn't hand-port — see oauth-native-request.ts.
  const genericOAuth =
    !nativeOAuth &&
    !isClaudeMaskingApiKeyRoute(route, targetApiType) &&
    isPiAiRoute(route, targetApiType);

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

    // Native Gemini pass-through forwards `contents` verbatim, so a client
    // history ending on a text-only model turn would 400 upstream
    // ("Requests ending with a model turn are not supported", LiteLLM
    // #38537 / PR #38652). Normalize the tail the same way the transform
    // path does. Tool-call / media tails are left untouched.
    if (getApiBaseType(targetApiType) === 'gemini' && Array.isArray((payload as any)?.contents)) {
      const before = (payload as any).contents.length;
      (payload as any).contents = appendUserAfterTextOnlyModelTail((payload as any).contents);
      if ((payload as any).contents.length !== before) {
        logger.debug('Auto-compat: appended synthetic user turn after text-only model tail');
      }
    }

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

  // Defense in depth: non-Gemini-transformer paths (cross-format routing to
  // a Gemini target, adapters that rewrite contents) can still produce a
  // trailing text-only model turn. Normalize unconditionally for Gemini
  // targets — the helper is a no-op unless the tail matches.
  if (getApiBaseType(targetApiType) === 'gemini' && Array.isArray((payload as any)?.contents)) {
    (payload as any).contents = appendUserAfterTextOnlyModelTail((payload as any).contents);
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

  // The provider-side `X-OpenAI-Internal-Codex-Responses-Lite` header (set in
  // setupHeaders/setupProviderHeaders whenever targetApiType is exactly
  // `responses:lite`) comes with a wire contract both providers currently
  // configured for the subtype (openlimits, openai-s) enforce with a 400:
  // `reasoning.context` must be `all_turns`, `parallel_tool_calls` must be
  // `false`, and declared tools are restricted to function/custom/tool_search
  // (see LITE_ALLOWED_TOOL_TYPES) — real Codex CLI traffic declares
  // `web_search` by default. Real Codex CLI requests don't reliably satisfy
  // any of these (see staging trace b672ebbd), so normalize proactively here
  // rather than paying a strip-and-retry round trip on every such request —
  // dispatcher-auto-compat.ts's reactive strip-and-retry stays in place as a
  // fallback for anything this proactive pass doesn't anticipate. This is
  // NOT a property of `responses:lite` in general: it's specific to this
  // generic `/v1/responses` + header contract used by non-native providers.
  // The native Codex/ChatGPT backend (see oauth-native-request.ts's
  // `prepareCodexOAuthRequest`) hits its own dedicated `/codex/responses`
  // endpoint, never sends this header, and accepts the client's tools
  // (including web_search) verbatim — so native OAuth routes are excluded.
  if (!nativeOAuth && targetApiType.toLowerCase() === 'responses:lite') {
    payload = {
      ...payload,
      // Only default `context` when the payload already has a `reasoning`
      // object — injecting one from nothing would send `reasoning` to a
      // non-reasoning model routed through a lite target, and /v1/responses
      // rejects that as an unsupported parameter. A genuinely reasoning
      // model (the only kind Codex CLI's lite mode targets in practice)
      // always sends `reasoning` itself, so this never needed to default
      // the object's presence, only the missing `context` field within it.
      ...(payload.reasoning
        ? { reasoning: { ...payload.reasoning, context: payload.reasoning.context ?? 'all_turns' } }
        : {}),
      parallel_tool_calls: false,
    };
    const toolStripResult = stripLiteUnsupportedTools(payload);
    if (toolStripResult.strippedCount > 0) {
      logger.debug(
        `Auto-compat: proactively stripped ${toolStripResult.strippedCount} tool(s) unsupported ` +
          `by responses:lite for ${route.provider}/${route.model}`
      );
    }
    payload = toolStripResult.payload;
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
      // The caller's own `anthropic-beta` flags. Merged with REQUIRED_BETAS
      // rather than discarded, so beta-gated client features (e.g. the advisor
      // tool) survive the gateway instead of being rejected upstream.
      callerBetas: request.anthropicBeta,
    });
    (route as any)[NATIVE_OAUTH_STASH] = prepared;
    logger.debug(
      `Native OAuth payload prepared for ${provider}/${route.model} (url=${prepared.url})`
    );
    // Codex CLI and Responses clients receive the native Responses stream.
    // Cross-format Codex requests must translate the response back to the
    // incoming client format. Anthropic bypasses only for same-format
    // (Messages) clients — chat/responses clients get the response
    // translated by the standard pipeline (mirrors the identical Codex fix,
    // commit 4f74c1c6). Copilot honors its computed same-format decision.
    const incomingBaseType = getApiBaseType(request.incomingApiType?.toLowerCase() ?? '');
    const incomingIsResponses = incomingBaseType === 'responses';
    const incomingIsMessages = incomingBaseType === 'messages';
    const nativeBypass = codexNative
      ? codexCliPassthrough || incomingIsResponses
      : copilotNative
        ? bypassTransformation
        : incomingIsMessages;
    return { payload: prepared.body, bypassTransformation: nativeBypass };
  }

  // Generic OAuth: `payload` above is already the correct standard-path wire
  // body (shouldUsePassThrough forces bypassTransformation=false for these
  // routes, so it always went through transformer.transformRequest()).
  // `targetApiType` here is the resolved wire type (effectiveApiType) that
  // request-manager passes for generic OAuth routes. Only auth + URL differ
  // from an ordinary API-key provider on the same wire API.
  if (genericOAuth) {
    const provider = route.config.oauth_provider || route.provider;
    const prepared = await prepareGenericOAuthDispatch({
      provider,
      modelId: route.model,
      body: payload,
      streaming: !!request.stream,
      apiType: targetApiType,
      oauthAccountId: route.config.oauth_account?.trim(),
      extraHeaders: route.config.headers,
    });
    (route as any)[NATIVE_OAUTH_STASH] = prepared;
    logger.debug(
      `Generic OAuth payload prepared for ${provider}/${route.model} (url=${prepared.url})`
    );
    return { payload: prepared.body, bypassTransformation };
  }

  return { payload, bypassTransformation };
}
