/**
 * Muse Code subscription OAuth (Meta `muse-spark` models).
 *
 * The subscription has no API key of its own: a flat-rate plan is only
 * reachable through the OAuth device flow, which mints a subscription-backed
 * Model API key from `POST https://api.meta.ai/muse-code/key`. A plain
 * `META_API_KEY` (pay-as-you-go) is a different billing path and is handled
 * as an ordinary API-key provider, not here.
 *
 * Flow (reverse-engineered; corroborated by CLIProxyAPI's native `meta`
 * provider, oh-my-pi's `muse-code` compat rules, and herdr-agent-quota's
 * `muse.rs` collector):
 *
 *  1. Device authorization `POST https://auth.meta.com/oidc/device/authorization/`
 *     (form-encoded `client_id`, `Accept: application/json`) → `device_code`,
 *     `user_code`, `verification_uri(_complete)`, `interval`, `expires_in`.
 *  2. Device token poll `POST https://auth.meta.com/oidc/device/token/`
 *     (form-encoded `grant_type=urn:ietf:params:oauth:grant-type:device_code`,
 *     `client_id`, `device_code`). `authorization_pending` / `slow_down` are
 *     retried; `access_denied` / `expired_token` are terminal.
 *  3. Subscription key mint `POST https://api.meta.ai/muse-code/key` with
 *     `Authorization: Bearer <device access token>` → `api_key` plus
 *     identity (`user_id`/`user_email`), `is_subs_active`, tier fields, and
 *     `subs_usage` (`window` + `weekly`). Fails closed when the subscription
 *     is inactive or payment is required.
 *
 * The stored credential is JSON `{ oauthAccessToken, apiKey }` in the
 * credential's `access` field (oh-my-pi convention): inference and model
 * discovery use the minted `apiKey`, while quota re-POSTs the key endpoint
 * with the `oauthAccessToken`. The key endpoint is aggressively rate-limited,
 * so an already-minted key is never re-minted on refresh — and Meta rejects
 * `refresh_token` grants, so `refresh` is a pass-through.
 *
 * Mocks-only note: the exact mint body is corroborated two ways —
 * CLIProxyAPI sends `{"dca_token": ...}`, oh-my-pi sends `{"onboard": true}`
 * on login. This module sends both fields on initial login (`dca_token`
 * always), since unknown extra fields are routinely ignored and omitting a
 * required one fails the mint. Revisit against a live capture if the mint
 * ever rejects the combined body.
 */

import type {
  OAuthAuth,
  OAuthCredential,
  OAuthCredentials,
  ProviderAuthInteraction,
} from '@earendil-works/pi-ai';
import { logger } from '../../utils/logger';

/** OAuth provider id for Muse Code subscription auth. */
export const MUSE_CODE_PROVIDER_ID = 'muse-code';

export const MUSE_CODE_DISPLAY_NAME = 'Muse Code (Subscription)';

/** The Muse CLI's official OAuth client id (public, shipped in the CLI). */
const MUSE_CLIENT_ID = '1031625952748946';

const MUSE_DEVICE_AUTH_URL = 'https://auth.meta.com/oidc/device/authorization/';
const MUSE_DEVICE_TOKEN_URL = 'https://auth.meta.com/oidc/device/token/';
const MUSE_KEY_URL = 'https://api.meta.ai/muse-code/key';
const MUSE_API_VERSION = '1.0.0';
/** Sent on all three calls for fingerprint parity with the real CLI. */
const MUSE_USER_AGENT = 'muse-code/1.0.2';

const DEVICE_CODE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const MAX_POLL_DURATION_MS = 15 * 60_000;
const REQUEST_TIMEOUT_MS = 30_000;
/** Skew subtracted from a reported token lifetime so a token never dies mid-request. */
const EXPIRY_SKEW_MS = 5 * 60_000;
/** Fallback lifetime when Meta omits `expires_in` (it historically does). */
const DEFAULT_TOKEN_LIFETIME_MS = 10 * 365 * 24 * 60_60_1000;

export interface MuseCodeCredential {
  oauthAccessToken: string;
  apiKey: string;
}

interface MuseCodeDeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  intervalMs: number;
  expiresInMs?: number;
}

interface MuseCodeTokenSuccess {
  accessToken: string;
  expiresInSeconds?: number;
}

export interface MuseCodeSubscriptionWindow {
  used_percent?: number;
  resets_at?: string | number;
  window_duration_mins?: number;
}

export interface MuseCodeKeyResponse {
  api_key?: string;
  base_url?: string;
  user_email?: string;
  user_full_name?: string;
  user_id?: string;
  is_subs_active?: boolean;
  subs_tier_id?: string | null;
  subs_tier_name?: string | null;
  subs_usage?: {
    window?: MuseCodeSubscriptionWindow | null;
    weekly?: MuseCodeSubscriptionWindow | null;
  } | null;
  require_payment?: boolean;
  require_payment_action_url?: string;
  action_url?: string | null;
}

export interface MuseCodeRequestOptions {
  fetchImpl?: MuseFetchImpl;
  signal?: AbortSignal;
  /** Set on interactive login so Meta onboards the account if needed. */
  onboard?: boolean;
  /** Override the key endpoint (tests). */
  keyUrl?: string;
  deviceAuthUrl?: string;
  deviceTokenUrl?: string;
}

/** Minimal fetch surface the Muse endpoints need (injectable in tests). */
export type MuseFetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

export function parseMuseCodeCredential(value: string): MuseCodeCredential {
  let payload: unknown;
  try {
    payload = JSON.parse(value);
  } catch (cause) {
    throw new Error('Muse Code credential is invalid; sign in again', { cause });
  }
  const record = payload as Record<string, unknown>;
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof record.oauthAccessToken !== 'string' ||
    !record.oauthAccessToken.trim() ||
    typeof record.apiKey !== 'string' ||
    !record.apiKey.trim()
  ) {
    throw new Error('Muse Code credential is invalid; sign in again');
  }
  return payload as MuseCodeCredential;
}

export function encodeMuseCodeCredential(oauthAccessToken: string, apiKey: string): string {
  return JSON.stringify({ oauthAccessToken, apiKey });
}

function withTimeout(signal?: AbortSignal): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const cancel = () => clearTimeout(timeout);
  if (signal) {
    if (signal.aborted) {
      cancel();
      return { signal: signal, cancel };
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return { signal: controller.signal, cancel };
}

async function readJsonBody(response: Response): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await response.json();
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function requiredString(body: Record<string, unknown>, field: string, what: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Muse Code ${what} response is missing required field '${field}'`);
  }
  return value;
}

/** The URI is opened in the user's browser; force https so a malicious payload can't make `open` launch something else. */
function validateVerificationUri(raw: string, what: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Untrusted verification URI in Muse Code ${what} response`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`Untrusted verification URI in Muse Code ${what} response`);
  }
  return url.href;
}

function positiveNumberOrUndefined(
  body: Record<string, unknown>,
  field: string
): number | undefined {
  const value = body[field];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

export async function requestMuseDeviceCode(
  options: MuseCodeRequestOptions = {}
): Promise<MuseCodeDeviceCode> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = options.deviceAuthUrl ?? MUSE_DEVICE_AUTH_URL;
  const { signal, cancel } = withTimeout(options.signal);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-api-version': MUSE_API_VERSION,
        'User-Agent': MUSE_USER_AGENT,
      },
      body: new URLSearchParams({ client_id: MUSE_CLIENT_ID }),
      signal,
    });
    const body = await readJsonBody(response);
    if (!response.ok) {
      throw new Error(
        `Muse Code device authorization failed (HTTP ${response.status})` +
          (typeof body.error === 'string' ? `: ${body.error}` : '')
      );
    }
    const intervalSeconds = positiveNumberOrUndefined(body, 'interval');
    const expiresInSeconds = positiveNumberOrUndefined(body, 'expires_in');
    const verificationUriComplete =
      typeof body.verification_uri_complete === 'string' &&
      body.verification_uri_complete.length > 0
        ? validateVerificationUri(body.verification_uri_complete, 'device authorization')
        : undefined;
    return {
      deviceCode: requiredString(body, 'device_code', 'device authorization'),
      userCode: requiredString(body, 'user_code', 'device authorization'),
      verificationUri: validateVerificationUri(
        requiredString(body, 'verification_uri', 'device authorization'),
        'device authorization'
      ),
      verificationUriComplete,
      intervalMs: intervalSeconds !== undefined ? intervalSeconds * 1000 : DEFAULT_POLL_INTERVAL_MS,
      expiresInMs: expiresInSeconds !== undefined ? expiresInSeconds * 1000 : undefined,
    };
  } finally {
    cancel();
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new Error('Login cancelled');
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Login cancelled'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function pollMuseDeviceToken(
  deviceCode: string,
  options: MuseCodeRequestOptions & { intervalMs?: number; expiresInMs?: number } = {}
): Promise<MuseCodeTokenSuccess> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = options.deviceTokenUrl ?? MUSE_DEVICE_TOKEN_URL;
  const signal = options.signal ?? new AbortController().signal;
  let intervalMs =
    options.intervalMs && options.intervalMs > 0 ? options.intervalMs : DEFAULT_POLL_INTERVAL_MS;
  const deadline =
    Date.now() +
    (options.expiresInMs && options.expiresInMs > 0
      ? Math.min(options.expiresInMs, MAX_POLL_DURATION_MS)
      : MAX_POLL_DURATION_MS);

  for (;;) {
    if (signal.aborted) throw new Error('Login cancelled');
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Muse Code device authorization timed out');
    await sleep(Math.min(intervalMs, remaining), signal);

    const { signal: attemptSignal, cancel } = withTimeout(signal);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-api-version': MUSE_API_VERSION,
          'User-Agent': MUSE_USER_AGENT,
        },
        body: new URLSearchParams({
          grant_type: DEVICE_CODE_GRANT_TYPE,
          device_code: deviceCode,
          client_id: MUSE_CLIENT_ID,
        }),
        signal: attemptSignal,
      });
    } catch (error) {
      cancel();
      if (signal.aborted) throw new Error('Login cancelled');
      logger.warn(`Muse Code device poll request failed; retrying (${String(error)})`);
      continue;
    }
    const body = await readJsonBody(response);
    cancel();

    if (response.ok) {
      const accessToken =
        typeof body.access_token === 'string' && body.access_token.length > 0
          ? body.access_token
          : '';
      if (!accessToken) throw new Error('Muse Code token response is missing access_token');
      return {
        accessToken,
        expiresInSeconds: positiveNumberOrUndefined(body, 'expires_in'),
      };
    }

    switch (body.error) {
      case 'authorization_pending':
        continue;
      case 'slow_down':
        intervalMs += 5_000;
        continue;
      case 'access_denied':
        throw new Error('Muse Code authorization was denied');
      case 'expired_token':
        throw new Error('Muse Code device code has expired; sign in again');
      default:
        if (typeof body.error === 'string' && body.error.length > 0) {
          const description =
            typeof body.error_description === 'string' ? `: ${body.error_description}` : '';
          throw new Error(`Muse Code authorization failed: ${body.error}${description}`);
        }
        logger.warn(`Muse Code device poll returned HTTP ${response.status}; retrying`);
        continue;
    }
  }
}

export async function requestMuseCodeKey(
  oauthAccessToken: string,
  options: MuseCodeRequestOptions = {}
): Promise<MuseCodeKeyResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = options.keyUrl ?? MUSE_KEY_URL;
  const trimmed = oauthAccessToken.trim();
  if (!trimmed) throw new Error('Muse Code OAuth access token is missing; sign in again');
  const { signal, cancel } = withTimeout(options.signal);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${trimmed}`,
        'Content-Type': 'application/json',
        'x-api-version': MUSE_API_VERSION,
        'User-Agent': MUSE_USER_AGENT,
      },
      // `dca_token` is the CLIProxyAPI-corroborated field; `onboard: true`
      // is the oh-my-pi-corroborated login flag. Sent together (see module doc).
      body: JSON.stringify(
        options.onboard ? { onboard: true, dca_token: trimmed } : { dca_token: trimmed }
      ),
      signal,
    });
    const body = await readJsonBody(response);
    if (!response.ok) {
      throw new Error(
        `Muse Code key exchange failed (HTTP ${response.status})` +
          (typeof body.error === 'string' ? `: ${body.error}` : '')
      );
    }
    return body as MuseCodeKeyResponse;
  } finally {
    cancel();
  }
}

/**
 * Mint the subscription API key, failing closed when the account has no
 * active subscription. Reuses an already-minted key: the key endpoint is
 * aggressively rate-limited and returns the same `api_key` per account.
 */
export async function attachMuseCodeApiKey(
  oauthAccessToken: string,
  options: MuseCodeRequestOptions & { existingAccess?: string } = {}
): Promise<{ credentialAccess: string; accountId: string; email?: string }> {
  if (options.existingAccess) {
    try {
      const existing = parseMuseCodeCredential(options.existingAccess);
      if (existing.apiKey.trim()) {
        return {
          credentialAccess: options.existingAccess,
          accountId: '',
        };
      }
    } catch {
      // No usable minted key yet — fall through to mint one.
    }
  }

  const payload = await requestMuseCodeKey(oauthAccessToken, options);
  if (payload.is_subs_active === false) {
    throw new Error('Muse Code subscription is inactive for this account');
  }
  const apiKey = payload.api_key?.trim() || '';
  if (!apiKey) {
    const actionUrl =
      (typeof payload.action_url === 'string' && payload.action_url.trim()) ||
      (typeof payload.require_payment_action_url === 'string' &&
        payload.require_payment_action_url.trim()) ||
      '';
    if (payload.require_payment === true || actionUrl) {
      throw new Error(
        actionUrl
          ? `Muse Code subscription is required: ${actionUrl}`
          : 'Muse Code subscription is required for this account'
      );
    }
    throw new Error('Muse Code key response is missing api_key');
  }
  const email = payload.user_email?.trim().toLowerCase() || undefined;
  const accountId = payload.user_id?.trim() || email || '';
  if (!accountId) {
    throw new Error('Muse Code key response is missing a stable account identity');
  }
  return {
    credentialAccess: encodeMuseCodeCredential(oauthAccessToken, apiKey),
    accountId,
    email,
  };
}

function credentialExpiryMs(expiresInSeconds?: number): number {
  if (expiresInSeconds !== undefined && Number.isFinite(expiresInSeconds) && expiresInSeconds > 0) {
    return Date.now() + expiresInSeconds * 1000 - EXPIRY_SKEW_MS;
  }
  // Meta historically omits token expiry: the minted key does not rot on a
  // timer, and Meta rejects refresh_token grants, so treat it as long-lived
  // rather than churning logins.
  return Date.now() + DEFAULT_TOKEN_LIFETIME_MS;
}

/**
 * Plexus-owned OAuth implementation for Muse Code subscriptions. Registered
 * in `oauth-providers.ts` (pi-ai 0.85.1 ships no Muse provider, so the
 * facade's pi-ai lookup alone would never resolve it).
 */
export const museCodeOAuth: OAuthAuth = {
  name: MUSE_CODE_DISPLAY_NAME,
  isSubscription: true,
  loginLabel: 'Sign in with Meta (Muse Code subscription)',

  async login(interaction: ProviderAuthInteraction): Promise<OAuthCredential> {
    const device = await requestMuseDeviceCode({ signal: interaction.signal });
    interaction.notify({
      type: 'device_code',
      userCode: device.userCode,
      verificationUri: device.verificationUriComplete ?? device.verificationUri,
      intervalSeconds: Math.max(1, Math.round(device.intervalMs / 1000)),
      ...(device.expiresInMs !== undefined
        ? { expiresInSeconds: Math.round(device.expiresInMs / 1000) }
        : {}),
    });
    const token = await pollMuseDeviceToken(device.deviceCode, {
      signal: interaction.signal,
      intervalMs: device.intervalMs,
      expiresInMs: device.expiresInMs,
    });
    const minted = await attachMuseCodeApiKey(token.accessToken, {
      signal: interaction.signal,
      onboard: true,
    });
    return {
      type: 'oauth',
      access: minted.credentialAccess,
      refresh: '',
      expires: credentialExpiryMs(token.expiresInSeconds),
      ...(minted.email ? { email: minted.email } : {}),
      ...(minted.accountId ? { accountId: minted.accountId } : {}),
    } as OAuthCredential;
  },

  async refresh(credential: OAuthCredential): Promise<OAuthCredential> {
    // Meta rejects refresh_token grants and the minted key is stable per
    // account, so there is nothing to rotate. Returning the credential
    // unchanged keeps OAuthAuthManager's refresh bookkeeping (lastRefreshAt,
    // backoff clearing, DB write-back) working without burning the
    // rate-limited key endpoint. Fresh subscription state is the quota
    // checker's job, not the token refresh's.
    return { ...credential, type: 'oauth' } as OAuthCredential;
  },

  async toAuth(credential: OAuthCredential): Promise<{ apiKey: string }> {
    return { apiKey: parseMuseCodeCredential(credential.access).apiKey };
  },
};

/** Test seam: expiry computation for a reported token lifetime. */
export function museCodeCredentialExpiryForTest(expiresInSeconds?: number): number {
  return credentialExpiryMs(expiresInSeconds);
}
