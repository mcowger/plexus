import { getCatalogModels } from '../pi-ai/catalog';
import { getProviderTypes, type ProviderConfig } from '../../config';
import { logger } from '../../utils/logger';
import { OAuthAuthManager } from '../oauth/oauth-auth-manager';
import { buildCodexModelsUrl, buildCodexOAuthHeaders } from '../oauth/oauth-native-request';

export interface DiscoveredModel {
  id: string;
  name?: string;
  context_length?: number;
  created?: number;
  object?: string;
  owned_by?: string;
  description?: string;
  pricing?: { prompt?: string; completion?: string };
  /** Modality hint for the target form — image models cannot serve chat. */
  type?: 'text' | 'image';
  /** Target protocols this model can be reached through (e.g. `codex-images`). */
  access_via?: string[];
  /**
   * The upstream's own listing hint: `hide` models work but are not advertised
   * in the Codex CLI picker. Entries the upstream marks `none` are dropped.
   */
  visibility?: 'list' | 'hide';
}

const ANTHROPIC_API_HOST = 'api.anthropic.com';

function isAnthropicApiUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === ANTHROPIC_API_HOST;
  } catch {
    return false;
  }
}

export function validateUrlSafety(url: string): { valid: boolean; error?: string } {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { valid: false, error: 'Only http and https URLs are allowed' };
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname === '0.0.0.0'
  ) {
    return { valid: false, error: 'Cannot fetch from localhost' };
  }

  if (
    hostname === '169.254.169.254' ||
    hostname === 'metadata.google.internal' ||
    hostname === 'metadata.azure.internal'
  ) {
    return { valid: false, error: 'Cannot fetch from cloud metadata endpoints' };
  }

  logger.debug(`Fetch request to: ${hostname}`);
  return { valid: true };
}

export function normalizeModelsResponse(data: any): { data: DiscoveredModel[] } {
  if (data && Array.isArray(data.data)) {
    return { data: data.data };
  }

  if (data && Array.isArray(data.models)) {
    const convertedModels = data.models.map((model: any) => {
      if (typeof model === 'string') {
        return { id: model, object: 'model', created: Date.now(), owned_by: 'ollama' };
      }
      return {
        id: model.name || model.id || model.model,
        object: 'model',
        created: model.modified_at
          ? new Date(model.modified_at).getTime() / 1000
          : Date.now() / 1000,
        owned_by: 'ollama',
        ...model,
      };
    });
    return { data: convertedModels };
  }

  if (data && !data.data && !data.models) {
    logger.warn('Unknown models response format, wrapping in data array');
    return { data: [data] };
  }

  return { data: [] };
}

export async function fetchModelsFromUrl(
  url: string,
  apiKey?: string
): Promise<{ data: DiscoveredModel[] }> {
  const urlValidation = validateUrlSafety(url);
  if (!urlValidation.valid) {
    throw new Error(urlValidation.error || 'Invalid URL');
  }

  const requestHeaders: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) {
    if (isAnthropicApiUrl(url)) {
      requestHeaders['x-api-key'] = apiKey;
      requestHeaders['anthropic-version'] = '2023-06-01';
    } else {
      requestHeaders.Authorization = `Bearer ${apiKey}`;
    }
  }

  logger.debug(`Fetching models from ${url}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: requestHeaders,
      signal: controller.signal,
      redirect: 'manual',
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      const error = new Error(`Provider returned ${response.status}: ${response.statusText}`);
      (error as any).statusCode = response.status;
      (error as any).details = errorText.substring(0, 500);
      throw error;
    }

    return normalizeModelsResponse(await response.json());
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Muse OAuth: live model discovery ─────────────────────────────────────

/**
 * Static fallback when the Muse model list is unreachable. The muse-spark
 * family from CLIProxyAPI's native `meta` provider catalog.
 */
export const MUSE_STATIC_MODELS: readonly DiscoveredModel[] = [
  'muse-spark-1.1',
  'muse-spark-1.2',
  'muse-spark-1.2-contributor',
  'muse-spark-1.3',
  'muse-spark-1.3-contributor',
].map((id) => ({ id, name: id }));

const MUSE_MODELS_URL = 'https://api.meta.ai/v1/models';
const MUSE_MODELS_TIMEOUT_MS = 15_000;

/**
 * List the muse-spark models the signed-in Meta account may use.
 *
 * Meta exposes a standard OpenAI-style `GET /v1/models`, but it requires
 * the subscription-minted key (resolved through the stored login, like
 * inference) plus the `x-api-version` header — which the generic
 * `fetchModelsFromUrl` cannot send, hence this dedicated path (the same
 * reason Codex has `listCodexOAuthModels`).
 *
 * Best-effort: every failure degrades to the static catalog with a warning
 * the UI can show, so a Fetch Models click never comes back empty because
 * the account is logged out.
 */
export async function listMuseOAuthModels(oauthAccountId?: string | null): Promise<{
  models: DiscoveredModel[];
  source: 'muse-backend' | 'catalog';
  warning?: string;
}> {
  try {
    const apiKey = await OAuthAuthManager.getInstance().getApiKey(
      'muse-code',
      oauthAccountId
    );

    const response = await fetch(MUSE_MODELS_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'x-api-version': '1.0.0',
      },
      signal: AbortSignal.timeout(MUSE_MODELS_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Muse model list returned ${response.status} ${response.statusText}`);
    }

    const { data } = normalizeModelsResponse(await response.json());
    const ids = data
      .map((model) => model.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (ids.length === 0) {
      throw new Error('Muse model list response had no model ids');
    }
    return {
      models: [...ids].sort((a, b) => a.localeCompare(b)).map((id) => ({ id, name: id })),
      source: 'muse-backend',
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn(`Muse model discovery failed (${reason}); falling back to the static catalog.`);
    return {
      models: [...MUSE_STATIC_MODELS],
      source: 'catalog',
      warning:
        `Could not reach the Muse model list (${reason}); showing the static catalog. ` +
        "Log in with OAuth to see your account's models.",
    };
  }
}

export function getOAuthProviderModels(providerId: string): DiscoveredModel[] {
  return getCatalogModels(providerId).map((model) => ({
    id: model.id,
    name: model.name,
    context_length: model.contextWindow,
    pricing: model.cost
      ? {
          prompt: model.cost.input.toString(),
          completion: model.cost.output.toString(),
        }
      : undefined,
  }));
}

// ─── Codex OAuth: live model discovery ──────────────────────────────────────

/** Codex image models: real, usable, and never present in the backend list. */
export const CODEX_IMAGE_MODELS: readonly DiscoveredModel[] = [
  'gpt-image-2',
  'gpt-image-2.5-flare',
  'gpt-image-2.5-sunburst',
].map((id) => ({
  id,
  name: id,
  description: 'Codex Images (ChatGPT OAuth)',
  type: 'image' as const,
  access_via: ['codex-images'],
}));

const CODEX_MODELS_TIMEOUT_MS = 15_000;

/** One record of `GET /codex/models` (only the fields we consume). */
interface CodexModelRecord {
  slug?: unknown;
  display_name?: unknown;
  description?: unknown;
  visibility?: unknown;
  priority?: unknown;
  context_window?: unknown;
}

function mapCodexModelRecords(records: CodexModelRecord[]): DiscoveredModel[] {
  return records
    .filter(
      (record): record is CodexModelRecord & { slug: string } =>
        typeof record?.slug === 'string' && record.slug.length > 0 && record.visibility !== 'none'
    )
    .sort((a, b) => {
      const priority = (record: CodexModelRecord) =>
        typeof record.priority === 'number' ? record.priority : 0;
      return priority(b) - priority(a) || a.slug.localeCompare(b.slug);
    })
    .map((record) => ({
      id: record.slug,
      ...(typeof record.display_name === 'string' ? { name: record.display_name } : {}),
      ...(typeof record.description === 'string' ? { description: record.description } : {}),
      ...(typeof record.context_window === 'number'
        ? { context_length: record.context_window }
        : {}),
      ...(record.visibility === 'list' || record.visibility === 'hide'
        ? { visibility: record.visibility }
        : {}),
    }));
}

/** Append the curated image models, never shadowing an id the list already has. */
function withCodexImageModels(models: DiscoveredModel[]): DiscoveredModel[] {
  const seen = new Set(models.map((model) => model.id));
  return [...models, ...CODEX_IMAGE_MODELS.filter((model) => !seen.has(model.id))];
}

/**
 * List the Codex models the signed-in ChatGPT account may actually use.
 *
 * The pi-ai catalog is a static, account-blind snapshot; the ChatGPT backend
 * knows the real entitlement (plan tier, staged rollouts, `client_version`
 * gating), so ask it with the same OAuth identity `/codex/responses` uses. The
 * backend never lists the image models, so the curated `CODEX_IMAGE_MODELS`
 * are appended.
 *
 * Discovery is best-effort: every failure (missing credentials, non-2xx,
 * network/timeout, malformed body) degrades to the static catalog plus the
 * image models, reporting `source: 'catalog'` and a warning the UI can show —
 * a Fetch Models click should never come back empty because the account is
 * logged out.
 */
export async function listCodexOAuthModels(oauthAccountId?: string | null): Promise<{
  models: DiscoveredModel[];
  source: 'codex-backend' | 'catalog';
  warning?: string;
}> {
  try {
    const token = await OAuthAuthManager.getInstance().getApiKey('openai-codex', oauthAccountId);
    const url = buildCodexModelsUrl();

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...buildCodexOAuthHeaders(token),
      },
      signal: AbortSignal.timeout(CODEX_MODELS_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Codex model list returned ${response.status} ${response.statusText}`);
    }

    const body = (await response.json()) as { models?: unknown };
    if (!Array.isArray(body?.models)) {
      throw new Error('Codex model list response had no models array');
    }

    return {
      models: withCodexImageModels(mapCodexModelRecords(body.models as CodexModelRecord[])),
      source: 'codex-backend',
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn(`Codex model discovery failed (${reason}); falling back to the static catalog.`);
    return {
      models: withCodexImageModels(getOAuthProviderModels('openai-codex')),
      source: 'catalog',
      warning:
        `Could not reach the Codex model list (${reason}); showing the static catalog. ` +
        "Log in with OAuth to see your account's models.",
    };
  }
}

export function deriveModelsUrl(provider: ProviderConfig): string | null {
  if (typeof provider.api_base_url === 'string') {
    const types = getProviderTypes(provider);
    if (types.length === 1 && (types[0] === 'chat' || types[0] === 'messages')) {
      return `${provider.api_base_url.replace(/\/(?:chat\/completions|messages)\/?$/, '')}/models`;
    }
    return null;
  }

  const apiBaseUrl = provider.api_base_url as Record<string, string>;
  if (apiBaseUrl.ollama) return 'https://ollama.com/api/tags';
  if (apiBaseUrl.chat) {
    return `${apiBaseUrl.chat.replace(/\/(?:chat\/completions|messages)\/?$/, '')}/models`;
  }
  if (apiBaseUrl.messages) {
    return `${apiBaseUrl.messages.replace(/\/(?:chat\/completions|messages)\/?$/, '')}/models`;
  }
  return null;
}

export async function discoverProviderModels(provider: ProviderConfig): Promise<DiscoveredModel[]> {
  if (provider.oauth_provider) {
    if (provider.oauth_provider === 'openai-codex') {
      return (await listCodexOAuthModels(provider.oauth_account)).models;
    }
    if (provider.oauth_provider === 'muse-code') {
      return (await listMuseOAuthModels(provider.oauth_account)).models;
    }
    return getOAuthProviderModels(provider.oauth_provider);
  }

  const modelsUrl = deriveModelsUrl(provider);
  if (!modelsUrl) return [];

  const apiKey = modelsUrl === 'https://ollama.com/api/tags' ? undefined : provider.api_key;
  const result = await fetchModelsFromUrl(modelsUrl, apiKey);
  return result.data;
}

/**
 * Bare model ids for model autosync.
 *
 * Autosync inserts what it is given as plain text targets (no `modelType`, empty
 * `accessVia`), so image models must never reach it: a bare `gpt-image-2` row
 * would be dispatched to `/codex/responses` as a chat model, earn a cooldown on
 * the upstream rejection, and claim the id an admin needs for the correctly
 * typed image target. Only text-capable models survive the filter.
 */
export async function discoverProviderModelIds(provider: ProviderConfig): Promise<string[]> {
  const models = await discoverProviderModels(provider);
  return Array.from(
    new Set(
      models
        .filter((model) => model.type !== 'image')
        .map((model) => model.id)
        .filter((id): id is string => typeof id === 'string')
    )
  ).sort((a, b) => a.localeCompare(b));
}
