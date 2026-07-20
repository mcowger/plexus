/**
 * Native OAuth request preparation — the piece that lets the OAuth path run
 * through the *normal* dispatch execution (real fetch + raw-bytes pass-through)
 * instead of pi-ai's `Context` IR + `piAiModels.stream` executor.
 *
 * The design principle (per the project owner): reuse the
 * pieces that already exist and are tested —
 *
 *   - Outbound wire body: the native `AnthropicTransformer` /
 *     `ResponsesTransformer` already build the correct provider body (proven by
 *     the golden traces). We take that body as input.
 *   - Fingerprint/masking: `applyClaudeOAuthTransform` + `applyClaudeCodeMasking`
 *     (the exact two-step sequence `oauth-transformer.executeRequest` runs today
 *     in its `onPayload` hook) — these are input-agnostic and mask the native
 *     body just as well as they masked pi-ai's `buildParams()` output.
 *   - Inbound tool-name reversal: `reverseToolRenames` (v2 pairs) +
 *     `reverseRemapOAuthToolNamesFromStreamLine` (v1) operate on raw SSE frame
 *     text — no IR needed.
 *   - Token: pi-ai OAuth (`OAuthAuthManager.getApiKey`) — kept.
 *   - Registry: pi-ai builtin models give the real upstream baseUrl — kept.
 *
 * This module owns ONLY the wiring: native body + token → {url, headers, body,
 * reverseResponseFrame}. No pi-ai `Context`, no `piAiModels.stream`, no event
 * translation.
 */

import { getCatalogModel } from '../pi-ai/catalog';
import type { OAuthProvider } from './oauth-providers';
import { logger } from '../../utils/logger';
import { OAuthAuthManager } from './oauth-auth-manager';
import {
  applyClaudeOAuthTransform,
  canonicalizeOAuthToolName,
} from '../../transformers/oauth/oauth-claude';
import {
  applyClaudeCodeMasking,
  getStainlessHeaders,
  REQUIRED_BETAS,
  reverseToolRenames,
} from '../../transformers/oauth/masking';
import type { RenamePair } from '../../transformers/oauth/masking/types';
import { CodexVersionService } from './codex-version-service';
import { stripUnsupportedGpt5Options } from '../../transformers/adapters/suppress-unsupported-gpt5-options.adapter';

/**
 * Auth for a native Anthropic request. Two modes, mirroring the old executor:
 *   - `oauth`  → genuine Claude OAuth token, sent as `Authorization: Bearer`.
 *   - `apiKey` → the `useClaudeMasking` route: a real Anthropic API key sent as
 *     `x-api-key`, with the CC masking still applied (the old path forced this
 *     via a `sk-ant-oat-mask-` shim token so the masking's OAuth codepath ran).
 */
export type NativeAnthropicAuth =
  | { mode: 'oauth'; token: string }
  | { mode: 'apiKey'; apiKey: string };

export interface PreparedOAuthRequest {
  /** Fully-resolved upstream URL (real provider endpoint, not `oauth://`). */
  url: string;
  /** Final wire headers, including the resolved auth (Bearer or x-api-key). */
  headers: Record<string, string>;
  /** Masked/fingerprinted wire body, ready to POST. */
  body: any;
  /**
   * Reverses request-side tool-name renames on a single raw SSE frame (or a
   * full JSON body string). Identity when no renames were applied (e.g. an
   * already-Claude-Code client). Applied to raw upstream bytes on the way back
   * to the client — no IR.
   */
  reverseResponseFrame: (frame: string) => string;
}

/** Provider-level fallback base URLs for models not present in the registry. */
const OAUTH_PROVIDER_BASE_URLS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com',
  'openai-codex': 'https://chatgpt.com/backend-api',
};

/**
 * Resolve the real upstream base URL for an OAuth provider/model. Prefers the
 * pi-ai builtin registry (the same source `oauth-transformer` used via the
 * model's `baseUrl`), then falls back to the provider-level default so custom
 * or not-yet-registered model ids still resolve. Trailing slash stripped.
 */
function resolveOAuthBaseUrl(provider: OAuthProvider, modelId: string): string {
  const model = getCatalogModel(provider, modelId);
  const baseUrl = (model as any)?.baseUrl || OAUTH_PROVIDER_BASE_URLS[provider];
  if (!baseUrl) {
    throw new Error(
      `OAuth: no baseUrl for provider '${provider}' model '${modelId}'. ` +
        `Cannot resolve upstream endpoint.`
    );
  }
  return String(baseUrl).replace(/\/$/, '');
}

/**
 * Prepare an Anthropic OAuth request from a native Anthropic `/v1/messages`
 * body. Applies the exact masking sequence `executeRequest` runs today, then
 * returns everything the standard fetch path needs.
 */
function prepareAnthropicOAuthRequest(
  modelId: string,
  auth: NativeAnthropicAuth,
  nativeBody: any,
  streaming: boolean
): PreparedOAuthRequest {
  // The token used to GATE masking (not necessarily the auth credential). For
  // the API-key masking route we force the masking's OAuth codepath with the
  // same `sk-ant-oat-mask-` shim the old executor used; the real key still goes
  // out as `x-api-key`.
  const maskingToken = auth.mode === 'oauth' ? auth.token : `sk-ant-oat-mask-${auth.apiKey}`;

  // Build the outbound Claude Code wire body. Two proven, shipped transforms
  // produce the exact fingerprinted body Anthropic expects:
  //   1. name canonicalization + system relocation (applyClaudeOAuthTransform)
  //   2. the full CC masking pipeline: shape-renames, synthetic tools, identity
  //      rebuild, metadata, CCH signing (applyClaudeCodeMasking)
  // We keep these verbatim for the body (verified byte-for-byte against a
  // canon-only variant, which drops the system relocation). We do NOT reuse
  // their internal rename bookkeeping for the response — see reversal below.
  const { payload: transformed } = applyClaudeOAuthTransform(nativeBody, maskingToken, {
    version: '2.1.63',
    entrypoint: 'cli',
    workload: '',
    oauthMode: true,
  });
  const payloadStr = typeof transformed === 'string' ? transformed : JSON.stringify(transformed);
  const { payload: maskedBody, toolRenamePairs } = applyClaudeCodeMasking(payloadStr);

  // The complete forward rename map for the CALLER's tools: original wire name
  // (what the client sent) -> final name on the outbound body (after both the
  // TitleCase canonicalization and the masking shape-renames). Built by
  // replaying the same name rules onto each caller tool name, so it captures
  // EVERY rename in one place regardless of which internal step produced it.
  // The response reversal is simply this map inverted — no per-mechanism
  // bookkeeping, no dependency on masking-internal flags.
  const callerToolNames: string[] = (Array.isArray(nativeBody?.tools) ? nativeBody.tools : [])
    .map((t: any) => t?.name)
    .filter((n: any): n is string => typeof n === 'string');

  const baseUrl = resolveOAuthBaseUrl('anthropic', modelId);
  const url = `${baseUrl}/v1/messages`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: streaming ? 'text/event-stream' : 'application/json',
    'anthropic-version': '2023-06-01',
    'anthropic-beta': REQUIRED_BETAS.join(','),
    ...getStainlessHeaders(),
    // Auth: OAuth → Bearer; masking-API-key → x-api-key (real Anthropic key).
    ...(auth.mode === 'oauth'
      ? { Authorization: `Bearer ${auth.token}` }
      : { 'x-api-key': auth.apiKey }),
  };

  return {
    url,
    headers,
    body: maskedBody,
    reverseResponseFrame: buildFrameReverser(callerToolNames, toolRenamePairs),
  };
}

/**
 * Build the response tool-name reversal from the caller's original tool names
 * and the masking rename pairs.
 *
 * Principle: whatever renames were applied to a caller tool on the way OUT, undo
 * exactly those on the way IN. We compute each caller tool's full forward chain
 * (original -> TitleCase-canonicalized -> masking-shape-renamed = the name that
 * actually went on the wire) and emit one reverse pair `[original, wireName]`.
 * `reverseToolRenames` then rewrites `"name":"<wireName>"` -> `"name":"<original>"`
 * in each raw SSE frame.
 *
 * This is a single map inverted — it never touches names the caller didn't send
 * (e.g. injected synthetic Claude Code tools), and it restores the caller's
 * EXACT original name (not a blind lowercase guess). Identity when no caller
 * tool was renamed.
 */
function buildFrameReverser(
  callerToolNames: readonly string[],
  maskingPairs: readonly RenamePair[]
): (frame: string) => string {
  // masking pairs map `preMaskName -> wireName`; index by the pre-mask name.
  const maskRename = new Map<string, string>(maskingPairs.map(([from, to]) => [from, to]));

  const reversePairs: RenamePair[] = [];
  for (const original of callerToolNames) {
    const canonical = canonicalizeOAuthToolName(original); // TitleCase step
    const wireName = maskRename.get(canonical) ?? canonical; // shape-rename step
    if (wireName !== original) {
      reversePairs.push([original, wireName]);
    }
  }

  if (reversePairs.length === 0) {
    return (frame) => frame;
  }
  return (frame) => reverseToolRenames(frame, reversePairs);
}

// ─── Codex (OpenAI Responses via the ChatGPT backend) ───────────────────────
//
// Codex is NOT Anthropic: no masking / identity spoof. The ChatGPT backend wants
// a specific Responses body (store:false, encrypted-content include, instructions,
// etc.) and Codex fingerprint headers. Two paths:
//   - CLI-shaped body  → send verbatim (auth only). Codex CLI produced it and the
//     backend always accepts the Codex request shape.
//   - Not CLI-shaped   → adorn a normalized Responses body with the required
//     backend fields (reproducing pi-ai's buildRequestBody forcings).

/**
 * Detect a genuine Codex CLI Responses request by body shape. The strongest
 * signal is the CLI turn metadata (`client_metadata`); Codex-native tool
 * extensions (`custom`/`namespace` tools, `additional_tools`/`custom_tool_call`
 * input items) are also CLI-only. Used to choose pass-through vs. adorn AND to
 * override the `hasCodexResponsesExtensions` flattening (which is for routing to
 * NON-Codex providers — the Codex backend understands these natively).
 */
export function isCodexCliShapedBody(body: any): boolean {
  if (!body || typeof body !== 'object') return false;

  const cm = body.client_metadata;
  if (cm && typeof cm === 'object') {
    if (
      cm['x-codex-turn-metadata'] != null ||
      cm['x-codex-installation-id'] != null ||
      cm['x-codex-window-id'] != null ||
      cm.turn_id != null ||
      cm.thread_id != null
    ) {
      return true;
    }
  }

  if (
    Array.isArray(body.tools) &&
    body.tools.some((t: any) => t?.type === 'custom' || t?.type === 'namespace')
  ) {
    return true;
  }

  if (
    Array.isArray(body.input) &&
    body.input.some(
      (it: any) =>
        it &&
        typeof it === 'object' &&
        (it.type === 'additional_tools' ||
          it.type === 'custom_tool_call' ||
          it.type === 'custom_tool_call_output')
    )
  ) {
    return true;
  }

  return false;
}

/** Extract the ChatGPT account id from the Codex OAuth token's JWT claim. */
function extractChatgptAccountId(token: string): string | undefined {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return undefined;
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
    const accountId = payload?.['https://api.openai.com/auth']?.chatgpt_account_id;
    return typeof accountId === 'string' && accountId.length > 0 ? accountId : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Adorn a normalized (non-CLI) Responses body with the fields the ChatGPT Codex
 * backend requires, reproducing pi-ai's `buildRequestBody` forcings: `store:false`,
 * `stream:true`, encrypted-content `include`, an `instructions` fallback, a
 * `text.verbosity` fallback, and `tool_choice`/`parallel_tool_calls` defaults.
 * Client-provided values are preserved where present; the always-unsupported
 * unsupported options are removed separately by `stripUnsupportedGpt5Options`.
 */
function adornCodexResponsesBody(body: any): any {
  const next: any = { ...(body ?? {}) };
  next.store = false;
  next.stream = true; // the Codex backend is stream-only
  if (typeof next.instructions !== 'string' || next.instructions.length === 0) {
    next.instructions = 'You are a helpful assistant.';
  }
  const include = Array.isArray(next.include) ? next.include : [];
  next.include = Array.from(new Set([...include, 'reasoning.encrypted_content']));
  next.text = { ...(next.text ?? {}), verbosity: next.text?.verbosity ?? 'low' };
  if (next.tool_choice == null) next.tool_choice = 'auto';
  if (next.parallel_tool_calls == null) next.parallel_tool_calls = true;
  // Token-cap fields are removed by stripUnsupportedGpt5Options (the backend
  // accepts none).
  return next;
}

/**
 * Prepare a native Codex OAuth request. `passthrough` sends the body verbatim
 * (CLI-shaped); otherwise the body is adorned for the backend.
 */
function prepareCodexOAuthRequest(
  modelId: string,
  token: string,
  nativeBody: any,
  streaming: boolean,
  passthrough: boolean
): PreparedOAuthRequest {
  // Preserve final-path suppression for native CLI pass-through, whose body may
  // be mutated after adapter resolution. All GPT-5 routes receive the same
  // suppression through the implicit model adapter.
  const body = stripUnsupportedGpt5Options(
    passthrough ? nativeBody : adornCodexResponsesBody(nativeBody)
  );

  const baseUrl = resolveOAuthBaseUrl('openai-codex' as OAuthProvider, modelId);
  const url = `${baseUrl}/codex/responses`;

  const accountId = extractChatgptAccountId(token);
  const codex = CodexVersionService.getInstance();
  const sessionId =
    typeof body?.prompt_cache_key === 'string' && body.prompt_cache_key.length > 0
      ? body.prompt_cache_key
      : undefined;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    accept: streaming ? 'text/event-stream' : 'application/json',
    Authorization: `Bearer ${token}`,
    ...(accountId ? { 'chatgpt-account-id': accountId } : {}),
    // Authentic Codex fingerprint (the native path can finally send the real UA
    // + originator; pi-ai clobbered the UA to "pi (...)").
    originator: 'codex_cli_rs',
    'OpenAI-Beta': 'responses=experimental',
    Version: codex.getVersion(),
    'User-Agent': codex.getUserAgent(),
    ...(sessionId ? { 'session-id': sessionId, 'x-client-request-id': sessionId } : {}),
  };

  return {
    url,
    headers,
    body,
    // Codex applies no request-side tool renames, so nothing to reverse.
    reverseResponseFrame: (frame) => frame,
  };
}

// ─── GitHub Copilot (multi-API: chat / responses / messages) ───────────────
//
// Copilot needs NO masking and NO tool-name renames (simpler than Anthropic /
// Codex). Per request it needs: the OAuth token as `Bearer`, the static Copilot
// editor headers, the dynamic headers pi-ai sends (`X-Initiator`, `Openai-Intent`,
// and `Copilot-Vision-Request` for image input), and a baseURL derived from the
// token's `proxy-ep` claim. The wire API type is model-specific (see
// copilotWireApiType) and the endpoint follows from it. Responses are returned
// raw — the standard dispatch pipeline handles any cross-format translation
// (bypassTransformation is set false for cross-format Copilot requests).

/** Static Copilot editor fingerprint headers (mirrors the pi-ai model headers). */
const COPILOT_STATIC_HEADERS: Record<string, string> = {
  'User-Agent': 'GitHubCopilotChat/0.35.0',
  'Editor-Version': 'vscode/1.107.0',
  'Editor-Plugin-Version': 'copilot-chat/0.35.0',
  'Copilot-Integration-Id': 'vscode-chat',
};

/** Endpoint path for a Copilot wire API type. */
function copilotEndpoint(apiType: string): string {
  switch (apiType) {
    case 'messages':
      return '/v1/messages';
    case 'responses':
      return '/responses';
    default:
      return '/chat/completions';
  }
}

/**
 * Resolve the Copilot API base URL from the OAuth token's `proxy-ep` claim
 * (mirrors pi-ai's getGitHubCopilotBaseUrl). Business accounts route through
 * `proxy.business.githubcopilot.com`, which only serves NES/autocomplete — chat
 * must use the standard `api.githubcopilot.com` endpoint (the same fix the old
 * pi-ai executor path applied). Falls back to the individual endpoint.
 */
function resolveCopilotBaseUrl(token: string): string {
  const match = token.match(/proxy-ep=([^;]+)/);
  if (match) {
    const proxyHost = match[1]!;
    if (proxyHost === 'proxy.business.githubcopilot.com') {
      return 'https://api.githubcopilot.com';
    }
    return `https://${proxyHost.replace(/^proxy\./, 'api.')}`;
  }
  return 'https://api.individual.githubcopilot.com';
}

/**
 * Copilot `X-Initiator`: 'agent' when the last turn wasn't user-authored
 * (follow-up after assistant/tool output), else 'user'. Tolerant of both the
 * `messages` array (chat/anthropic) and the `input` array (responses); responses
 * tool-output items carry no `role` and are treated as agent turns.
 */
function inferCopilotInitiator(body: any): 'user' | 'agent' {
  const items = Array.isArray(body?.messages)
    ? body.messages
    : Array.isArray(body?.input)
      ? body.input
      : [];
  const last = items[items.length - 1];
  if (!last || typeof last !== 'object') return 'user';
  if (typeof last.role !== 'string') return 'agent';
  return last.role === 'user' ? 'user' : 'agent';
}

/** Copilot requires `Copilot-Vision-Request` when any input carries an image. */
function hasCopilotVisionInput(body: any): boolean {
  const hasImagePart = (content: any): boolean =>
    Array.isArray(content) &&
    content.some(
      (part: any) =>
        part &&
        typeof part === 'object' &&
        (part.type === 'image' || part.type === 'image_url' || part.type === 'input_image')
    );
  const items = Array.isArray(body?.messages)
    ? body.messages
    : Array.isArray(body?.input)
      ? body.input
      : [];
  return items.some((it: any) => it && typeof it === 'object' && hasImagePart(it.content));
}

function buildCopilotDynamicHeaders(body: any): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Initiator': inferCopilotInitiator(body),
    'Openai-Intent': 'conversation-edits',
  };
  if (hasCopilotVisionInput(body)) headers['Copilot-Vision-Request'] = 'true';
  return headers;
}

/**
 * Ensure usage is emitted for streaming Copilot chat/completions responses.
 * pi-ai's buildParams sets `stream_options.include_usage`; without it the
 * OpenAI-completions stream omits the final usage chunk and token accounting
 * breaks. Applied only to the chat wire type when streaming, and never clobbers
 * a client-provided value. Responses/messages carry usage natively.
 */
function adornCopilotBody(body: any, apiType: string, streaming: boolean): any {
  if (apiType !== 'chat' || !streaming) return body;
  const next: any = { ...(body ?? {}) };
  const existing =
    next.stream_options && typeof next.stream_options === 'object' ? next.stream_options : {};
  next.stream_options = { ...existing, include_usage: existing.include_usage ?? true };
  return next;
}

/**
 * Prepare a native GitHub Copilot OAuth request. Adds the Copilot fingerprint +
 * dynamic headers, resolves the per-account baseURL from the token, and targets
 * the endpoint for the model's wire API type. No masking, no tool renames.
 */
function prepareCopilotOAuthRequest(
  token: string,
  nativeBody: any,
  streaming: boolean,
  apiType: string
): PreparedOAuthRequest {
  const body = adornCopilotBody(nativeBody, apiType, streaming);
  const baseUrl = resolveCopilotBaseUrl(token).replace(/\/$/, '');
  const url = `${baseUrl}${copilotEndpoint(apiType)}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: streaming ? 'text/event-stream' : 'application/json',
    Authorization: `Bearer ${token}`,
    ...COPILOT_STATIC_HEADERS,
    ...buildCopilotDynamicHeaders(body),
  };
  // The anthropic-messages wire type needs the Anthropic version header.
  if (apiType === 'messages') {
    headers['anthropic-version'] = '2023-06-01';
  }

  return {
    url,
    headers,
    body,
    // Copilot applies no request-side tool renames, so nothing to reverse.
    reverseResponseFrame: (frame) => frame,
  };
}

/**
 * Prepare a native OAuth request for the standard dispatch path.
 *
 * @param provider  OAuth provider id (`anthropic`, `openai-codex`, or `github-copilot`).
 * @param modelId   Upstream model id.
 * @param auth      Resolved OAuth access token / masking API key.
 * @param nativeBody The provider-native wire body from the entry transformer.
 * @param streaming Whether the client asked for a stream.
 * @param options.codexPassthrough  Codex only: send the body verbatim (CLI-shaped).
 * @param options.apiType  Copilot only: the resolved wire API type (chat/messages/responses).
 */
export function prepareOAuthNativeRequest(
  provider: OAuthProvider,
  modelId: string,
  auth: NativeAnthropicAuth,
  nativeBody: any,
  streaming: boolean,
  options?: { codexPassthrough?: boolean; apiType?: string }
): PreparedOAuthRequest {
  if (provider === 'anthropic') {
    return prepareAnthropicOAuthRequest(modelId, auth, nativeBody, streaming);
  }
  if (provider === 'openai-codex') {
    if (auth.mode !== 'oauth') {
      throw new Error('Codex native OAuth requires an OAuth token (apiKey mode unsupported).');
    }
    return prepareCodexOAuthRequest(
      modelId,
      auth.token,
      nativeBody,
      streaming,
      options?.codexPassthrough === true
    );
  }
  if (provider === 'github-copilot') {
    if (auth.mode !== 'oauth') {
      throw new Error('Copilot native OAuth requires an OAuth token (apiKey mode unsupported).');
    }
    return prepareCopilotOAuthRequest(
      auth.token,
      nativeBody,
      streaming,
      options?.apiType ?? 'chat'
    );
  }
  // The caller gates on isNativeOAuthProvider; reaching here is a programming error.
  logger.error(`OAuth native path not implemented for provider '${provider}'`);
  throw new Error(`OAuth native request preparation not implemented for provider '${provider}'`);
}

/**
 * Whether an OAuth provider is served by the native (non-pi-ai-executor) path.
 * All ported providers: Anthropic (M1), Codex (M2), and GitHub Copilot (M3).
 */
export function isNativeOAuthProvider(provider: string | undefined): boolean {
  return provider === 'anthropic' || provider === 'openai-codex' || provider === 'github-copilot';
}

/**
 * The provider-native wire API type for a native OAuth provider. An `oauth://`
 * URL makes `getProviderTypes()` report the synthetic `oauth` type, which would
 * (a) select pi-ai's `oauth` IR transformer and (b) defeat same-format
 * pass-through. Native OAuth instead flows through the STANDARD path using the
 * real upstream API type: Anthropic OAuth speaks the Messages API; Codex the
 * Responses API. GitHub Copilot is MULTI-API — each model picks its own wire
 * API (chat/messages/responses) — so its type is resolved per-model from the
 * pi-ai registry (see copilotWireApiType). Returns undefined for providers not
 * served by the native path (they keep `oauth`).
 */
const NATIVE_OAUTH_API_TYPES: Record<string, string> = {
  anthropic: 'messages',
  'openai-codex': 'responses',
};

/** Map a pi-ai model `api` field to the plexus transformer/api-type name. */
const PIAI_API_TO_PLEXUS: Record<string, string> = {
  'anthropic-messages': 'messages',
  'openai-completions': 'chat',
  'openai-responses': 'responses',
};

export function nativeOAuthApiType(
  provider: string | undefined,
  modelId?: string
): string | undefined {
  if (!provider) return undefined;
  if (provider === 'github-copilot') return copilotWireApiType(modelId);
  return NATIVE_OAUTH_API_TYPES[provider];
}

/**
 * Resolve a Copilot model's plexus wire API type via the pi-ai registry.
 * Unknown/custom model ids default to OpenAI chat completions (the most common
 * Copilot surface); cross-format response translation still applies downstream.
 */
export function copilotWireApiType(modelId: string | undefined): string {
  if (modelId) {
    const model = getCatalogModel('github-copilot', modelId);
    const api = (model as any)?.api as string | undefined;
    if (api && PIAI_API_TO_PLEXUS[api]) return PIAI_API_TO_PLEXUS[api];
  }
  return 'chat';
}

/**
 * Full async preparation for the native Anthropic dispatch. For OAuth routes,
 * resolves the token (with auto-refresh + DB write-back via OAuthAuthManager);
 * for the masking-API-key route, uses the configured key directly. Masks the
 * native body and builds the wire request for the standard dispatch seams.
 */
export async function prepareNativeOAuthDispatch(params: {
  provider: OAuthProvider;
  modelId: string;
  nativeBody: any;
  streaming: boolean;
  oauthAccountId?: string | null;
  /** When set, use the Claude-masking API-key mode instead of OAuth. */
  maskingApiKey?: string | null;
  /** Codex only: send the body verbatim (CLI-shaped request). */
  codexPassthrough?: boolean;
  /** Copilot only: the resolved wire API type (chat/messages/responses). */
  apiType?: string;
}): Promise<PreparedOAuthRequest> {
  const { provider, modelId, nativeBody, streaming, oauthAccountId, maskingApiKey } = params;

  let auth: NativeAnthropicAuth;
  if (maskingApiKey != null) {
    const key = maskingApiKey.trim();
    if (!key) {
      throw new Error(
        `OAuth: API key is not configured for Claude masking provider. ` +
          `Set the provider's api_key.`
      );
    }
    auth = { mode: 'apiKey', apiKey: key };
  } else {
    const token = await OAuthAuthManager.getInstance().getApiKey(provider, oauthAccountId);
    auth = { mode: 'oauth', token };
  }

  return prepareOAuthNativeRequest(provider, modelId, auth, nativeBody, streaming, {
    codexPassthrough: params.codexPassthrough === true,
    apiType: params.apiType,
  });
}
