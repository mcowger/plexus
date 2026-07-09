/**
 * xAI SuperGrok / X Premium+ OAuth (device-code flow).
 *
 * Ported from NousResearch/hermes-agent (hermes_cli/auth.py) constants and
 * device-code exchange. Registered into pi-ai via registerOAuthProvider so
 * Plexus can reuse OAuthAuthManager + Admin UI login sessions.
 *
 * SuperGrok OAuth inference uses the xAI Responses API (`openai-responses`
 * at https://api.x.ai/v1), matching Hermes' codex_responses transport. The
 * built-in pi-ai xAI provider only ships completions, so we re-register it
 * with both API implementations and rewrite model.api on the OAuth path.
 */
import { createProvider, type Model as PiAiModel } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import {
  pollOAuthDeviceCodeFlow,
  registerOAuthProvider,
  type OAuthCredentials,
  type OAuthLoginCallbacks,
  type OAuthProviderInterface,
} from '@earendil-works/pi-ai/oauth';
import { piAiModels } from '../pi-ai/registry';
import { logger } from '../../utils/logger';

const XAI_OAUTH_ISSUER = 'https://auth.x.ai';
const XAI_OAUTH_DISCOVERY_URL = `${XAI_OAUTH_ISSUER}/.well-known/openid-configuration`;
const XAI_OAUTH_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
const XAI_OAUTH_SCOPE = 'openid profile email offline_access grok-cli:access api:access';
const XAI_OAUTH_DEVICE_CODE_URL = `${XAI_OAUTH_ISSUER}/oauth2/device/code`;
/** Public xAI OpenAI-compatible base (Responses + Completions). */
export const XAI_INFERENCE_BASE_URL = 'https://api.x.ai/v1';
/** Wire protocol used for SuperGrok / X Premium+ OAuth inference. */
export const XAI_OAUTH_MODEL_API = 'openai-responses' as const;
const DEFAULT_ACCESS_TTL_MS = 6 * 60 * 60 * 1000;

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function requireString(record: JsonRecord, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`xAI OAuth response missing string field '${key}'`);
  }
  return value.trim();
}

/** Only allow auth endpoints under auth.x.ai / *.x.ai over HTTPS. */
export function assertXaiOAuthEndpoint(url: string, field: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`xAI OAuth ${field} is not a valid URL`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`xAI OAuth ${field} must use HTTPS`);
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== 'auth.x.ai' && host !== 'x.ai' && !host.endsWith('.x.ai')) {
    throw new Error(`xAI OAuth ${field} host is not an x.ai domain: ${host}`);
  }
  return parsed.href;
}

export function expiresAtFromAccessToken(accessToken: string, expiresInSeconds?: number): number {
  const parts = accessToken.split('.');
  if (parts.length >= 2 && parts[1]) {
    try {
      const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const json = Buffer.from(padded, 'base64').toString('utf8');
      const payload = JSON.parse(json) as { exp?: number };
      if (typeof payload.exp === 'number' && Number.isFinite(payload.exp)) {
        return payload.exp * 1000;
      }
    } catch {
      // fall through
    }
  }
  if (typeof expiresInSeconds === 'number' && expiresInSeconds > 0) {
    return Date.now() + expiresInSeconds * 1000;
  }
  return Date.now() + DEFAULT_ACCESS_TTL_MS;
}

export function credentialsFromTokenPayload(
  payload: JsonRecord,
  previousRefresh?: string
): OAuthCredentials {
  const access = requireString(payload, 'access_token');
  const refreshRaw = payload.refresh_token;
  const refresh =
    typeof refreshRaw === 'string' && refreshRaw.trim()
      ? refreshRaw.trim()
      : (previousRefresh?.trim() ?? '');
  if (!refresh) {
    throw new Error('xAI OAuth response missing refresh_token');
  }
  const expiresIn =
    typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in)
      ? payload.expires_in
      : undefined;
  return {
    access,
    refresh,
    expires: expiresAtFromAccessToken(access, expiresIn),
  };
}

async function fetchJson(url: string, init: RequestInit, errorPrefix: string): Promise<JsonRecord> {
  const response = await fetch(url, init);
  const text = await response.text().catch(() => '');
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    const detail = text.trim() ? ` ${text.trim().slice(0, 400)}` : '';
    throw new Error(`${errorPrefix} (HTTP ${response.status}).${detail}`);
  }
  const record = asRecord(body);
  if (!record) {
    throw new Error(`${errorPrefix}: expected JSON object`);
  }
  return record;
}

async function discoverTokenEndpoint(signal?: AbortSignal): Promise<string> {
  const payload = await fetchJson(
    XAI_OAUTH_DISCOVERY_URL,
    { method: 'GET', headers: { Accept: 'application/json' }, signal },
    'xAI OIDC discovery failed'
  );
  return assertXaiOAuthEndpoint(requireString(payload, 'token_endpoint'), 'token_endpoint');
}

type DeviceCodeStart = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  intervalSeconds: number;
  expiresInSeconds: number;
};

async function requestDeviceCode(signal?: AbortSignal): Promise<DeviceCodeStart> {
  const payload = await fetchJson(
    XAI_OAUTH_DEVICE_CODE_URL,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: XAI_OAUTH_CLIENT_ID,
        scope: XAI_OAUTH_SCOPE,
      }),
      signal,
    },
    'xAI device-code request failed'
  );

  const verificationUri = assertXaiOAuthEndpoint(
    String(payload.verification_uri_complete || payload.verification_uri || ''),
    'verification_uri'
  );
  const interval =
    typeof payload.interval === 'number' && payload.interval > 0 ? payload.interval : 5;
  const expiresIn =
    typeof payload.expires_in === 'number' && payload.expires_in > 0 ? payload.expires_in : 900;

  return {
    deviceCode: requireString(payload, 'device_code'),
    userCode: requireString(payload, 'user_code'),
    verificationUri,
    intervalSeconds: interval,
    expiresInSeconds: expiresIn,
  };
}

export async function loginXaiOAuth(
  callbacks: Pick<OAuthLoginCallbacks, 'onDeviceCode' | 'onProgress' | 'signal'>
): Promise<OAuthCredentials> {
  const signal = callbacks.signal;
  callbacks.onProgress?.('Discovering xAI OAuth endpoints…');
  const tokenEndpoint = await discoverTokenEndpoint(signal);

  callbacks.onProgress?.('Requesting device code…');
  const device = await requestDeviceCode(signal);

  callbacks.onDeviceCode({
    userCode: device.userCode,
    verificationUri: device.verificationUri,
    intervalSeconds: device.intervalSeconds,
    expiresInSeconds: device.expiresInSeconds,
  });
  callbacks.onProgress?.(
    `Open ${device.verificationUri} and enter code ${device.userCode} if prompted`
  );

  const tokenPayload = await pollOAuthDeviceCodeFlow<JsonRecord>({
    intervalSeconds: device.intervalSeconds,
    expiresInSeconds: device.expiresInSeconds,
    signal,
    poll: async () => {
      const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          client_id: XAI_OAUTH_CLIENT_ID,
          device_code: device.deviceCode,
        }),
        signal,
      });

      if (response.ok) {
        const payload = asRecord(await response.json());
        if (!payload) {
          return { status: 'failed', message: 'xAI token response was not JSON' };
        }
        return { status: 'complete', value: payload };
      }

      const rawText = await response.text().catch(() => '');
      let errorCode = '';
      let description = '';
      try {
        const errBody = asRecord(rawText ? JSON.parse(rawText) : {});
        errorCode = String(errBody?.error || '');
        description = String(errBody?.error_description || errBody?.error || '');
      } catch {
        description = rawText;
      }

      if (errorCode === 'authorization_pending') {
        return { status: 'pending' };
      }
      if (errorCode === 'slow_down') {
        return { status: 'slow_down' };
      }
      if (errorCode === 'expired_token' || errorCode === 'access_denied') {
        return {
          status: 'failed',
          message: description || `xAI device authorization failed: ${errorCode}`,
        };
      }
      return {
        status: 'failed',
        message: `xAI device-code token polling failed (HTTP ${response.status})${
          description ? `: ${description.slice(0, 300)}` : ''
        }`,
      };
    },
  });

  callbacks.onProgress?.('xAI OAuth login complete');
  return credentialsFromTokenPayload(tokenPayload);
}

export async function refreshXaiOAuthToken(
  refreshToken: string,
  signal?: AbortSignal
): Promise<OAuthCredentials> {
  if (!refreshToken.trim()) {
    throw new Error('xAI OAuth is missing refresh_token. Re-authenticate.');
  }
  const tokenEndpoint = await discoverTokenEndpoint(signal);
  const payload = await fetchJson(
    tokenEndpoint,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: XAI_OAUTH_CLIENT_ID,
        refresh_token: refreshToken,
      }),
      signal,
    },
    'xAI token refresh failed'
  );
  return credentialsFromTokenPayload(payload, refreshToken);
}

export const xaiOAuthProvider: OAuthProviderInterface = {
  id: 'xai',
  name: 'xAI Grok (SuperGrok / X Premium+)',
  usesCallbackServer: false,

  async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
    return loginXaiOAuth(callbacks);
  },

  async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
    return refreshXaiOAuthToken(credentials.refresh);
  },

  getApiKey(credentials: OAuthCredentials): string {
    return credentials.access;
  },
};

/**
 * Models available via SuperGrok OAuth that are not yet in pi-ai's generated
 * xAI catalog (pi-ai 0.80.x). Catalog entries still declare openai-completions;
 * the OAuth path rewrites to openai-responses via applyXaiOAuthModelTransport.
 *
 * Metadata sources:
 * - Grok 4.5: xAI docs ($2/$6 per 1M, 500K ctx, reasoning low|medium|high)
 * - Composer / multi-agent: Hermes + pi-xai-oauth curated SuperGrok lists
 */
export const XAI_OAUTH_EXTRA_MODELS: PiAiModel<'openai-completions'>[] = [
  {
    id: 'grok-4.5',
    name: 'Grok 4.5',
    api: 'openai-completions',
    provider: 'xai',
    baseUrl: XAI_INFERENCE_BASE_URL,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
    },
    reasoning: true,
    input: ['text', 'image'],
    cost: {
      input: 2,
      output: 6,
      cacheRead: 0.5,
      cacheWrite: 0,
    },
    contextWindow: 500_000,
    maxTokens: 30_000,
  },
  {
    // Cursor Composer 2.5 via SuperGrok / Grok Build OAuth surface.
    id: 'grok-composer-2.5-fast',
    name: 'Grok Composer 2.5 Fast',
    api: 'openai-completions',
    provider: 'xai',
    baseUrl: XAI_INFERENCE_BASE_URL,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    },
    // No configurable reasoning_effort on this model (Hermes/pi-xai-oauth).
    reasoning: false,
    input: ['text', 'image'],
    cost: {
      input: 1,
      output: 2,
      cacheRead: 0.2,
      cacheWrite: 0,
    },
    contextWindow: 200_000,
    maxTokens: 30_000,
  },
  {
    id: 'grok-4.20-multi-agent-0309',
    name: 'Grok 4.20 Multi-Agent',
    api: 'openai-completions',
    provider: 'xai',
    baseUrl: XAI_INFERENCE_BASE_URL,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
    },
    reasoning: true,
    input: ['text', 'image'],
    cost: {
      input: 1.25,
      output: 2.5,
      cacheRead: 0.2,
      cacheWrite: 0,
    },
    contextWindow: 2_000_000,
    maxTokens: 30_000,
  },
];

/** Extra model ids not present in getBuiltinModels('xai'). */
export function getXaiOAuthExtraModelIds(): string[] {
  return XAI_OAUTH_EXTRA_MODELS.map((m) => m.id);
}

/** Resolve an OAuth-only extra model definition (e.g. grok-4.5). */
export function getXaiOAuthExtraModel(modelId: string): PiAiModel<any> | undefined {
  return XAI_OAUTH_EXTRA_MODELS.find((m) => m.id === modelId);
}

/**
 * SuperGrok OAuth must hit xAI's Responses API. Built-in catalog models still
 * declare openai-completions; rewrite on the OAuth request path only.
 */
export function applyXaiOAuthModelTransport<T extends PiAiModel<any>>(model: T): T {
  if (model.provider !== 'xai') return model;
  return {
    ...model,
    api: XAI_OAUTH_MODEL_API,
    baseUrl: model.baseUrl?.trim() || XAI_INFERENCE_BASE_URL,
  };
}

function mergeXaiCatalogModels(builtin: readonly PiAiModel<any>[]): PiAiModel<any>[] {
  const merged = [...builtin];
  const ids = new Set(merged.map((m) => m.id));
  for (const extra of XAI_OAUTH_EXTRA_MODELS) {
    if (!ids.has(extra.id)) {
      merged.push(extra);
      ids.add(extra.id);
    }
  }
  return merged;
}

/**
 * Built-in xAI provider only implements openai-completions. Re-register with
 * both completions (API-key / catalog default) and responses (OAuth path),
 * and inject SuperGrok-only models missing from the pi-ai catalog.
 *
 * Returns false when the runtime registry is a test stub / missing xAI (so
 * unit tests under the global pi-ai mock still exercise OAuth login helpers).
 */
export function ensureXaiProviderSupportsResponses(): boolean {
  const models = piAiModels as {
    getProvider?: (id: string) =>
      | {
          id: string;
          name: string;
          baseUrl?: string;
          headers?: Record<string, string>;
          auth: unknown;
          getModels?: () => readonly PiAiModel<any>[];
        }
      | undefined;
    setProvider?: (provider: unknown) => void;
  };

  if (typeof models.getProvider !== 'function' || typeof models.setProvider !== 'function') {
    logger.debug('xAI OAuth: piAiModels registry is not mutable; skipping Responses rebind');
    return false;
  }

  const existing = models.getProvider('xai');
  if (!existing || typeof existing.getModels !== 'function') {
    logger.debug('xAI OAuth: built-in xAI provider missing; skipping Responses rebind');
    return false;
  }

  // createProvider is not present on the global vitest pi-ai mock.
  if (typeof createProvider !== 'function') {
    logger.debug('xAI OAuth: createProvider unavailable; skipping Responses rebind');
    return false;
  }

  models.setProvider(
    createProvider({
      id: existing.id,
      name: existing.name,
      baseUrl: existing.baseUrl ?? XAI_INFERENCE_BASE_URL,
      headers: existing.headers,
      auth: existing.auth as any,
      models: mergeXaiCatalogModels(existing.getModels()),
      api: {
        'openai-completions': openAICompletionsApi(),
        'openai-responses': openAIResponsesApi(),
      },
    })
  );
  return true;
}

let registered = false;

/** Idempotent: OAuth login provider + dual-API xAI inference registration. */
export function registerXaiOAuthProvider(): void {
  if (registered) return;
  registerOAuthProvider(xaiOAuthProvider);
  ensureXaiProviderSupportsResponses();
  registered = true;
}
