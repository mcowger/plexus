import { API_BASE, encodePathPreservingSlashes, fetchWithAuth, inferProviderTypes } from './core';
import type {
  CompactionSettings,
  Cooldown,
  InferenceError,
  KeyConfig,
  LoggingLevelState,
  ModuleFilterState,
  OAuthCredentialStatus,
  OAuthDiscoveredModel,
  OAuthProviderInfo,
  OAuthProviderModelsResult,
  OAuthSession,
  Provider,
} from '../../types/settings';
import type {
  CustomQuotaChecker,
  Meter,
  QuotaCheckerInfo,
  QuotaCheckersResponse,
  QuotaStatusEntry,
  UserQuota,
} from '../../types/quota';

export function normalizeQuotaCheckerInfo(checker: QuotaCheckerInfo): QuotaCheckerInfo {
  return {
    ...checker,
    meters: Array.isArray(checker.meters) ? checker.meters : [],
  };
}

export async function fetchCustomQuotaCheckers(): Promise<CustomQuotaChecker[]> {
  const response = await fetchWithAuth(`${API_BASE}/v0/management/custom-checkers`);
  if (!response.ok) throw new Error('Failed to fetch custom quota checkers');
  return response.json();
}

export async function saveCustomQuotaChecker(
  id: string,
  payload: { displayName: string; code: string; enabled: boolean }
): Promise<CustomQuotaChecker> {
  const response = await fetchWithAuth(
    `${API_BASE}/v0/management/custom-checkers/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...payload }),
    }
  );
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(error.error || 'Failed to save custom quota checker');
  }
  return response.json();
}

export async function deleteCustomQuotaChecker(id: string): Promise<void> {
  const response = await fetchWithAuth(
    `${API_BASE}/v0/management/custom-checkers/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
    }
  );
  if (!response.ok) throw new Error('Failed to delete custom quota checker');
}

export async function testCustomQuotaChecker(
  id: string,
  provider: string,
  options: Record<string, unknown>,
  code?: string
): Promise<{ success: boolean; meters: Meter[]; error?: string }> {
  const response = await fetchWithAuth(
    `${API_BASE}/v0/management/custom-checkers/${encodeURIComponent(id)}/test`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, options, ...(code ? { code } : {}) }),
    }
  );
  const result = (await response.json()) as {
    success: boolean;
    meters: Meter[];
    error?: string;
  };
  if (!response.ok) throw new Error(result.error || 'Custom quota checker test failed');
  return result;
}

export async function fetchQuotaCheckers(): Promise<QuotaCheckersResponse> {
  const response = await fetchWithAuth(`${API_BASE}/v0/management/quota-checkers`);
  if (!response.ok) throw new Error('Failed to fetch quota checkers');
  const data = (await response.json()) as {
    knownTypes?: QuotaCheckersResponse['knownTypes'];
    configured?: (QuotaCheckerInfo & { displayName: string; pending: boolean })[];
  };
  return {
    knownTypes: data.knownTypes ?? [],
    configured: (data.configured ?? []).map(
      (c: QuotaCheckerInfo & { displayName: string; pending: boolean }) => ({
        ...normalizeQuotaCheckerInfo(c),
        displayName: c.displayName,
        pending: c.pending,
      })
    ),
  };
}

export const normalizeProviderQuotaChecker = (checker?: {
  type?: string;
  enabled?: boolean;
  intervalMinutes?: number;
  options?: Record<string, unknown>;
}): Provider['quotaChecker'] | undefined => {
  if (!checker) return undefined;

  const type = checker.type?.trim();
  if (!type) return undefined;

  return {
    type,
    enabled: checker.enabled !== false,
    intervalMinutes: Math.max(1, Number(checker.intervalMinutes || 30)),
    options: checker.options,
  };
};

export const getCooldowns = async (): Promise<Cooldown[]> => {
  try {
    const res = await fetchWithAuth(`${API_BASE}/v0/management/cooldowns`);
    if (!res.ok) throw new Error('Failed to fetch cooldowns');
    return await res.json();
  } catch (e) {
    console.error('API Error getCooldowns', e);
    return [];
  }
};

export const clearCooldown = async (provider?: string, model?: string): Promise<void> => {
  let url: string;
  if (provider) {
    url = `${API_BASE}/v0/management/cooldowns/${encodePathPreservingSlashes(provider)}`;
    if (model) {
      url += `?model=${encodeURIComponent(model)}`;
    }
  } else {
    url = `${API_BASE}/v0/management/cooldowns`;
  }

  const res = await fetchWithAuth(url, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to clear cooldown');
};

export const getConfig = async (): Promise<Record<string, unknown>> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/config`);
  if (!res.ok) throw new Error('Failed to fetch config');
  return await res.json();
};

export const getConfigExport = async (): Promise<Record<string, unknown>> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/config/export`);
  if (!res.ok) throw new Error('Failed to fetch config export');
  return await res.json();
};

export const getSystemSettings = async (): Promise<Record<string, unknown>> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/system-settings`);
  if (!res.ok) throw new Error('Failed to fetch system settings');
  return res.json();
};

export const patchSystemSettings = async (updates: Record<string, unknown>): Promise<void> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/system-settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Failed to update system settings');
  }
};

export const getDefaultQuotas = async (): Promise<string[]> => {
  const settings = await getSystemSettings();
  return Array.isArray(settings.default_quotas)
    ? settings.default_quotas.filter((v): v is string => typeof v === 'string')
    : [];
};

export const setDefaultQuotas = async (names: string[]): Promise<void> => {
  await patchSystemSettings({ default_quotas: names });
};

export const restart = async (): Promise<{ success: boolean; message: string }> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/restart`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: 'Failed to restart' }))) as {
      error?: string;
    };
    throw new Error(err.error || 'Failed to restart');
  }
  return res.json();
};

export const getKeys = async (): Promise<KeyConfig[]> => {
  try {
    const res = await fetchWithAuth(`${API_BASE}/v0/management/keys`);
    if (!res.ok) throw new Error('Failed to fetch keys');
    const keys = (await res.json()) as Record<
      string,
      {
        secret: string;
        comment?: string;
        quotas?: string[];
        allowedModels?: string[];
        allowedProviders?: string[];
        excludedModels?: string[];
        excludedProviders?: string[];
        allowRawPassthrough?: boolean;
        allowedIps?: string[];
        expiresAt?: number;
        disabledAt?: number;
      }
    >;

    return Object.entries(keys).map(([key, val]) => ({
      key,
      secret: val.secret,
      comment: val.comment,
      quotas: val.quotas,
      allowedModels: val.allowedModels,
      allowedProviders: val.allowedProviders,
      excludedModels: val.excludedModels,
      excludedProviders: val.excludedProviders,
      allowRawPassthrough: val.allowRawPassthrough === true,
      allowedIps: val.allowedIps,
      expiresAt: val.expiresAt,
      disabledAt: val.disabledAt,
    }));
  } catch (e) {
    console.error('API Error getKeys', e);
    return [];
  }
};

export const deleteKey = async (keyName: string): Promise<void> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/keys/${encodeURIComponent(keyName)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Failed to delete key');
  }
};

export const saveKey = async (keyConfig: KeyConfig, oldKeyName?: string): Promise<void> => {
  const res = await fetchWithAuth(
    `${API_BASE}/v0/management/keys/${encodeURIComponent(keyConfig.key)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: keyConfig.secret,
        comment: keyConfig.comment,
        quotas: keyConfig.quotas ?? [],
        allowedModels: keyConfig.allowedModels ?? [],
        allowedProviders: keyConfig.allowedProviders ?? [],
        excludedModels: keyConfig.excludedModels ?? [],
        excludedProviders: keyConfig.excludedProviders ?? [],
        allowRawPassthrough: keyConfig.allowRawPassthrough === true,
        allowedIps: keyConfig.allowedIps ?? [],
        ...(keyConfig.expiresInMinutes ? { expiresInMinutes: keyConfig.expiresInMinutes } : {}),
      }),
    }
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      error?: string;
      details?: Array<{ message?: string }>;
    };
    const detail =
      Array.isArray(err.details) && err.details[0]?.message ? `: ${err.details[0].message}` : '';
    throw new Error(`${err.error || 'Failed to save key'}${detail}`);
  }

  // Delete old key only after new one is saved successfully
  if (oldKeyName && oldKeyName !== keyConfig.key) {
    await deleteKey(oldKeyName);
  }
};

export const disableKey = async (keyName: string): Promise<void> => {
  const res = await fetchWithAuth(
    `${API_BASE}/v0/management/keys/${encodeURIComponent(keyName)}/disable`,
    { method: 'POST' }
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Failed to disable key');
  }
};

export const deleteProvider = async (
  providerId: string,
  cascade?: boolean
): Promise<{
  success: boolean;
  provider: string;
  removedTargets?: number;
  affectedAliases?: string[];
}> => {
  try {
    const url = `/v0/management/providers/${encodePathPreservingSlashes(providerId)}${cascade ? '?cascade=true' : ''}`;

    const response = await fetchWithAuth(url, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = (await response
        .json()
        .catch(() => ({ error: 'Failed to delete provider' }))) as {
        error?: string;
      };
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (e) {
    console.error('API Error deleteProvider', e);
    throw e;
  }
};

interface RawBackendProvider {
  display_name?: string;
  type?: string | string[];
  api_base_url?: string | Record<string, string>;
  api_key?: string;
  oauth_provider?: string;
  oauth_account?: string;
  enabled?: boolean;
  estimateTokens?: boolean;
  useClaudeMasking?: boolean;
  gemini_thinking_enabled?: boolean;
  disable_cooldown?: boolean;
  stall_cooldown?: boolean;
  allow_100_percent_utilization?: boolean;
  auto_compat?: boolean;
  discount?: number;
  headers?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  models?: string[] | Record<string, unknown>;
  quota_checker?: {
    type?: string;
    enabled?: boolean;
    intervalMinutes?: number;
    options?: Record<string, unknown>;
  };
  model_autosync?: {
    enabled?: boolean;
    intervalMinutes?: number;
  };
  adapter?: unknown[];
  timeoutMs?: number;
  maxConcurrency?: number;
  stallTtfbMs?: number;
  stallTtfbBytes?: number;
  stallMinBps?: number;
  stallWindowMs?: number;
  stallGracePeriodMs?: number;
  pi_ai_provider?: string;
  raw_passthrough?: {
    enabled?: boolean;
    base_url?: string;
    auth?: 'bearer' | 'x-api-key' | 'x-goog-api-key';
  };
}

export const getProviders = async (): Promise<Provider[]> => {
  try {
    const res = await fetchWithAuth(`${API_BASE}/v0/management/providers`);
    if (!res.ok) throw new Error('Failed to fetch providers');
    const providers = (await res.json()) as Record<string, RawBackendProvider>;

    return Object.entries(providers).map(([key, val]) => {
      let normalizedModels = val.models;
      if (Array.isArray(val.models)) {
        normalizedModels = val.models.reduce((acc: Record<string, unknown>, modelName: string) => {
          acc[modelName] = {};
          return acc;
        }, {});
      }

      const inferredTypes = val.type || inferProviderTypes(val.api_base_url);

      return {
        id: key,
        name: val.display_name || key,
        type: inferredTypes,
        apiBaseUrl: val.api_base_url,
        apiKey: val.api_key || '',
        oauthProvider: val.oauth_provider,
        oauthAccount: val.oauth_account,
        enabled: val.enabled !== false,
        estimateTokens: val.estimateTokens === true,
        useClaudeMasking: val.useClaudeMasking === true,
        geminiThinkingEnabled: val.gemini_thinking_enabled === true,
        disableCooldown: val.disable_cooldown === true,
        stallCooldown: val.stall_cooldown === true,
        allow100PercentUtilization: val.allow_100_percent_utilization === true,
        auto_compat: val.auto_compat === true,
        discount: typeof val.discount === 'number' ? val.discount : undefined,
        headers: val.headers,
        extraBody:
          val.extraBody && typeof val.extraBody === 'object' && !Array.isArray(val.extraBody)
            ? val.extraBody
            : {},
        models: normalizedModels,
        quotaChecker: normalizeProviderQuotaChecker(val.quota_checker),
        modelAutosync: val.model_autosync
          ? {
              enabled: val.model_autosync.enabled === true,
              intervalMinutes: Math.max(1, val.model_autosync.intervalMinutes || 60),
            }
          : { enabled: false, intervalMinutes: 60 },
        adapter: val.adapter ? (Array.isArray(val.adapter) ? val.adapter : [val.adapter]) : [],
        timeoutMs: typeof val.timeoutMs === 'number' ? val.timeoutMs : undefined,
        maxConcurrency: typeof val.maxConcurrency === 'number' ? val.maxConcurrency : undefined,
        stallTtfbMs: typeof val.stallTtfbMs === 'number' ? val.stallTtfbMs : undefined,
        stallTtfbBytes: typeof val.stallTtfbBytes === 'number' ? val.stallTtfbBytes : undefined,
        stallMinBps: typeof val.stallMinBps === 'number' ? val.stallMinBps : undefined,
        stallWindowMs: typeof val.stallWindowMs === 'number' ? val.stallWindowMs : undefined,
        stallGracePeriodMs:
          typeof val.stallGracePeriodMs === 'number' ? val.stallGracePeriodMs : undefined,
        pi_ai_provider: typeof val.pi_ai_provider === 'string' ? val.pi_ai_provider : undefined,
        rawPassthrough: val.raw_passthrough
          ? {
              enabled: val.raw_passthrough.enabled === true,
              baseUrl: val.raw_passthrough.base_url || '',
              auth: val.raw_passthrough.auth || 'bearer',
            }
          : undefined,
      };
    });
  } catch (e) {
    console.error('API Error getProviders', e);
    return [];
  }
};

export const saveProvider = async (provider: Provider, oldId?: string): Promise<void> => {
  const body: Record<string, unknown> = {
    api_base_url: provider.apiBaseUrl,
    display_name: provider.name,
    api_key: provider.apiKey,
    ...(provider.oauthProvider && { oauth_provider: provider.oauthProvider }),
    ...(provider.oauthAccount && { oauth_account: provider.oauthAccount }),
    enabled: provider.enabled,
    estimateTokens: provider.estimateTokens,
    useClaudeMasking: provider.useClaudeMasking,
    geminiThinkingEnabled: provider.geminiThinkingEnabled,
    disable_cooldown: provider.disableCooldown === true,
    stall_cooldown: provider.stallCooldown === true,
    allow_100_percent_utilization: provider.allow100PercentUtilization === true,
    auto_compat: provider.auto_compat === true,
    discount: provider.discount,
    headers: provider.headers,
    extraBody: provider.extraBody,
    models: provider.models,
    quota_checker: provider.quotaChecker?.type
      ? {
          type: provider.quotaChecker.type,
          enabled: provider.quotaChecker.enabled,
          intervalMinutes: Math.max(1, provider.quotaChecker.intervalMinutes || 30),
          options: provider.quotaChecker.options,
        }
      : undefined,
    model_autosync: {
      enabled: provider.modelAutosync?.enabled === true,
      intervalMinutes: Math.max(1, provider.modelAutosync?.intervalMinutes || 60),
    },
    adapter: provider.adapter ?? [],
    ...(provider.timeoutMs != null ? { timeoutMs: provider.timeoutMs } : {}),
    ...(provider.maxConcurrency != null ? { maxConcurrency: provider.maxConcurrency } : {}),
    ...(provider.stallTtfbMs != null ? { stallTtfbMs: provider.stallTtfbMs } : {}),
    ...(provider.stallTtfbBytes != null ? { stallTtfbBytes: provider.stallTtfbBytes } : {}),
    ...(provider.stallMinBps != null ? { stallMinBps: provider.stallMinBps } : {}),
    ...(provider.stallWindowMs != null ? { stallWindowMs: provider.stallWindowMs } : {}),
    ...(provider.stallGracePeriodMs != null
      ? { stallGracePeriodMs: provider.stallGracePeriodMs }
      : {}),
    ...(provider.rawPassthrough?.baseUrl
      ? {
          raw_passthrough: {
            enabled: provider.rawPassthrough.enabled,
            base_url: provider.rawPassthrough.baseUrl,
            auth: provider.rawPassthrough.auth,
          },
        }
      : {}),
    ...(provider.pi_ai_provider ? { pi_ai_provider: provider.pi_ai_provider } : {}),
  };

  const isExistingProvider = oldId === provider.id;
  const res = await fetchWithAuth(
    `${API_BASE}/v0/management/providers/${encodePathPreservingSlashes(provider.id)}`,
    {
      method: isExistingProvider ? 'PATCH' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      error?: string;
      details?: unknown;
    };
    const detail = err.details ? ` — ${JSON.stringify(err.details)}` : '';
    throw new Error((err.error || 'Failed to save provider') + detail);
  }

  // Delete old provider only after new one is saved successfully
  if (oldId && oldId !== provider.id) {
    await deleteProvider(oldId, false);
  }
};

export const updateProviderEnabled = async (
  providerId: string,
  enabled: boolean
): Promise<void> => {
  const res = await fetchWithAuth(
    `${API_BASE}/v0/management/providers/${encodePathPreservingSlashes(providerId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Failed to update provider status');
  }
};

export const fetchProviderModels = async (
  url: string,
  apiKey?: string
): Promise<{
  data: Array<{ id: string; object?: string; created?: number; owned_by?: string }>;
}> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/providers/fetch-models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, apiKey }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: { message: 'Unknown error' } }))) as {
      error?: { message?: string } | string;
      details?: string;
    };
    const errorMessage =
      (typeof err.error === 'object' ? err.error?.message : err.error) ||
      err.details ||
      'Failed to fetch models';
    throw new Error(errorMessage);
  }
  return res.json();
};

export const getDebugLogs = async (
  limit: number = 50,
  offset: number = 0
): Promise<{ requestId: string; createdAt: number; responseStatus: number | null }[]> => {
  try {
    const res = await fetchWithAuth(
      `${API_BASE}/v0/management/debug/logs?limit=${limit}&offset=${offset}`
    );
    if (!res.ok) throw new Error('Failed to fetch debug logs');
    const json = (await res.json()) as {
      data?: { requestId: string; createdAt: number; responseStatus: number | null }[];
    };
    return json.data || [];
  } catch (e) {
    console.error('API Error getDebugLogs', e);
    return [];
  }
};

export const getDebugLogDetail = async (requestId: string): Promise<any> => {
  try {
    const res = await fetchWithAuth(`${API_BASE}/v0/management/debug/logs/${requestId}`);
    if (!res.ok) throw new Error('Failed to fetch debug log detail');
    return await res.json();
  } catch (e) {
    console.error('API Error getDebugLogDetail', e);
    return null;
  }
};

export const deleteDebugLog = async (requestId: string): Promise<boolean> => {
  try {
    const res = await fetchWithAuth(`${API_BASE}/v0/management/debug/logs/${requestId}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch (e) {
    console.error('API Error deleteDebugLog', e);
    return false;
  }
};

export const deleteAllDebugLogs = async (): Promise<boolean> => {
  try {
    const res = await fetchWithAuth(`${API_BASE}/v0/management/debug/logs`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch (e) {
    console.error('API Error deleteAllDebugLogs', e);
    return false;
  }
};

export const getErrors = async (
  limit: number = 50,
  offset: number = 0
): Promise<InferenceError[]> => {
  try {
    const res = await fetchWithAuth(
      `${API_BASE}/v0/management/errors?limit=${limit}&offset=${offset}`
    );
    if (!res.ok) throw new Error('Failed to fetch error logs');
    const json = (await res.json()) as { data?: InferenceError[] };
    return json.data || [];
  } catch (e) {
    console.error('API Error getErrors', e);
    return [];
  }
};

export const deleteError = async (requestId: string): Promise<boolean> => {
  try {
    const res = await fetchWithAuth(`${API_BASE}/v0/management/errors/${requestId}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch (e) {
    console.error('API Error deleteError', e);
    return false;
  }
};

export const deleteAllErrors = async (): Promise<boolean> => {
  try {
    const res = await fetchWithAuth(`${API_BASE}/v0/management/errors`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch (e) {
    console.error('API Error deleteAllErrors', e);
    return false;
  }
};

export const getDebugMode = async (): Promise<{
  enabled: boolean;
  enabledGlobal?: boolean;
  enabledKeys?: string[];
  providers: string[] | null;
  keys: string[] | null;
  aliases: string[] | null;
}> => {
  try {
    const res = await fetchWithAuth(`${API_BASE}/v0/management/debug`);
    if (!res.ok) throw new Error('Failed to fetch debug status');
    const json = (await res.json()) as {
      enabled?: boolean;
      enabledGlobal?: boolean;
      enabledKeys?: string[];
      providers?: string[] | null;
      keys?: string[] | null;
      aliases?: string[] | null;
    };
    return {
      enabled: !!json.enabled,
      enabledGlobal: json.enabledGlobal === undefined ? undefined : !!json.enabledGlobal,
      enabledKeys: Array.isArray(json.enabledKeys) ? json.enabledKeys : undefined,
      providers: json.providers || null,
      keys: json.keys || json.enabledKeys || null,
      aliases: json.aliases || null,
    };
  } catch (e) {
    console.error('API Error getDebugMode', e);
    return { enabled: false, providers: null, keys: null, aliases: null };
  }
};

export const setDebugMode = async (
  enabled: boolean,
  providers?: string[] | null,
  keys?: string[] | null,
  aliases?: string[] | null
): Promise<{
  enabled: boolean;
  enabledGlobal?: boolean;
  enabledKeys?: string[];
  providers: string[] | null;
  keys: string[] | null;
  aliases: string[] | null;
}> => {
  try {
    const body: {
      enabled: boolean;
      providers?: string[] | null;
      keys?: string[] | null;
      aliases?: string[] | null;
    } = { enabled };
    if (providers !== undefined) {
      body.providers = providers;
    }
    if (keys !== undefined) {
      body.keys = keys;
    }
    if (aliases !== undefined) {
      body.aliases = aliases;
    }
    const res = await fetchWithAuth(`${API_BASE}/v0/management/debug`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('Failed to set debug status');
    const json = (await res.json()) as {
      enabled?: boolean;
      enabledGlobal?: boolean;
      enabledKeys?: string[];
      providers?: string[] | null;
      keys?: string[] | null;
      aliases?: string[] | null;
    };
    return {
      enabled: !!json.enabled,
      enabledGlobal: json.enabledGlobal === undefined ? undefined : !!json.enabledGlobal,
      enabledKeys: Array.isArray(json.enabledKeys) ? json.enabledKeys : undefined,
      providers: json.providers || null,
      keys: json.keys || json.enabledKeys || null,
      aliases: json.aliases || null,
    };
  } catch (e) {
    console.error('API Error setDebugMode', e);
    throw e;
  }
};

export const getLoggingLevel = async (): Promise<LoggingLevelState> => {
  try {
    const res = await fetchWithAuth(`${API_BASE}/v0/management/logging/level`);
    if (!res.ok) throw new Error('Failed to fetch logging level');
    const json = (await res.json()) as LoggingLevelState;
    return {
      level: json.level,
      startupLevel: json.startupLevel,
      supportedLevels: Array.isArray(json.supportedLevels)
        ? json.supportedLevels
        : ['error', 'warn', 'info', 'debug', 'verbose', 'silly'],
      ephemeral: !!json.ephemeral,
    };
  } catch (e) {
    console.error('API Error getLoggingLevel', e);
    return {
      level: 'info',
      startupLevel: 'info',
      supportedLevels: ['error', 'warn', 'info', 'debug', 'verbose', 'silly'],
      ephemeral: true,
    };
  }
};

export const setLoggingLevel = async (level: string): Promise<LoggingLevelState> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/logging/level`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ level }),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Failed to set logging level');
  }

  const json = (await res.json()) as LoggingLevelState;
  return {
    level: json.level,
    startupLevel: json.startupLevel,
    supportedLevels: Array.isArray(json.supportedLevels)
      ? json.supportedLevels
      : ['error', 'warn', 'info', 'debug', 'verbose', 'silly'],
    ephemeral: !!json.ephemeral,
  };
};

export const resetLoggingLevel = async (): Promise<LoggingLevelState> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/logging/level`, {
    method: 'DELETE',
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Failed to reset logging level');
  }

  const json = (await res.json()) as LoggingLevelState;
  return {
    level: json.level,
    startupLevel: json.startupLevel,
    supportedLevels: Array.isArray(json.supportedLevels)
      ? json.supportedLevels
      : ['error', 'warn', 'info', 'debug', 'verbose', 'silly'],
    ephemeral: !!json.ephemeral,
  };
};

export const getModuleFilter = async (): Promise<ModuleFilterState> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/logging/modules`);
  if (!res.ok) throw new Error('Failed to fetch module filter');
  const json = (await res.json()) as ModuleFilterState;
  return { modules: Array.isArray(json.modules) ? json.modules : [] };
};

export const setModuleFilter = async (modules: string[]): Promise<ModuleFilterState> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/logging/modules`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modules }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Failed to set module filter');
  }
  const json = (await res.json()) as ModuleFilterState;
  return { modules: Array.isArray(json.modules) ? json.modules : [] };
};

export const clearModuleFilter = async (): Promise<void> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/logging/modules`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Failed to clear module filter');
  }
};

export const getQuotas = async (): Promise<QuotaCheckerInfo[]> => {
  try {
    const res = await fetchWithAuth(`${API_BASE}/v0/management/quotas`);
    if (!res.ok) throw new Error('Failed to fetch quotas');
    const json = (await res.json()) as QuotaCheckerInfo[];
    return Array.isArray(json) ? json.map(normalizeQuotaCheckerInfo) : [];
  } catch (e) {
    console.error('API Error getQuotas', e);
    return [];
  }
};

export const getQuota = async (checkerId: string): Promise<QuotaCheckerInfo | null> => {
  try {
    const res = await fetchWithAuth(`${API_BASE}/v0/management/quotas/${checkerId}`);
    if (!res.ok) throw new Error('Failed to fetch quota');
    const json = (await res.json()) as QuotaCheckerInfo;
    return normalizeQuotaCheckerInfo(json);
  } catch (e) {
    console.error('API Error getQuota', e);
    return null;
  }
};

export const getQuotaHistory = async (
  checkerId: string,
  meterKey?: string,
  since?: string
): Promise<{ checkerId: string; meterKey?: string; since?: string; history: any[] } | null> => {
  try {
    const params = new URLSearchParams();
    if (meterKey) params.set('meterKey', meterKey);
    if (since) params.set('since', since);
    const res = await fetchWithAuth(
      `${API_BASE}/v0/management/quotas/${checkerId}/history?${params}`
    );
    if (!res.ok) throw new Error('Failed to fetch quota history');
    return (await res.json()) as {
      checkerId: string;
      meterKey?: string;
      since?: string;
      history: any[];
    };
  } catch (e) {
    console.error('API Error getQuotaHistory', e);
    return null;
  }
};

export const triggerQuotaCheck = async (checkerId: string): Promise<QuotaCheckerInfo | null> => {
  try {
    const res = await fetchWithAuth(`${API_BASE}/v0/management/quotas/${checkerId}/check`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to trigger quota check');
    return normalizeQuotaCheckerInfo((await res.json()) as QuotaCheckerInfo);
  } catch (e) {
    console.error('API Error triggerQuotaCheck', e);
    return null;
  }
};

export const getOAuthProviders = async (): Promise<OAuthProviderInfo[]> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/oauth/providers`);
  if (!res.ok) throw new Error('Failed to fetch OAuth providers');
  const json = (await res.json()) as { data?: OAuthProviderInfo[] };
  return json.data || [];
};

export const startOAuthSession = async (
  providerId: string,
  accountId: string
): Promise<OAuthSession> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/oauth/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId, accountId }),
  });
  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error || 'Failed to start OAuth session');
  }
  const json = (await res.json()) as { data: OAuthSession };
  return json.data;
};

export const deleteOAuthCredentials = async (
  providerId: string,
  accountId: string
): Promise<void> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/oauth/credentials`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId, accountId }),
  });
  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error || 'Failed to delete OAuth credentials');
  }
};

export const getOAuthCredentialStatus = async (
  providerId: string,
  accountId: string
): Promise<OAuthCredentialStatus> => {
  const query = new URLSearchParams({ providerId, accountId }).toString();
  const res = await fetchWithAuth(`${API_BASE}/v0/management/oauth/credentials/status?${query}`);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Failed to fetch OAuth credential status');
  }
  const json = (await res.json()) as { data: OAuthCredentialStatus };
  return json.data;
};

export const getOAuthSession = async (sessionId: string): Promise<OAuthSession> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/oauth/sessions/${sessionId}`);
  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error || 'Failed to fetch OAuth session');
  }
  const json = (await res.json()) as { data: OAuthSession };
  return json.data;
};

export const submitOAuthPrompt = async (
  sessionId: string,
  value: string
): Promise<OAuthSession> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/oauth/sessions/${sessionId}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error || 'Failed to submit OAuth prompt');
  }
  const json = (await res.json()) as { data: OAuthSession };
  return json.data;
};

export const submitOAuthManualCode = async (
  sessionId: string,
  value: string
): Promise<OAuthSession> => {
  const res = await fetchWithAuth(
    `${API_BASE}/v0/management/oauth/sessions/${sessionId}/manual-code`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    }
  );
  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error || 'Failed to submit OAuth code');
  }
  const json = (await res.json()) as { data: OAuthSession };
  return json.data;
};

export const cancelOAuthSession = async (sessionId: string): Promise<OAuthSession> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/oauth/sessions/${sessionId}/cancel`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error || 'Failed to cancel OAuth session');
  }
  const json = (await res.json()) as { data: OAuthSession };
  return json.data;
};

export const getOAuthProviderModels = async (
  providerId: string,
  accountId?: string
): Promise<OAuthProviderModelsResult> => {
  const query = new URLSearchParams({ providerId });
  const trimmedAccountId = accountId?.trim();
  if (trimmedAccountId) query.set('accountId', trimmedAccountId);
  const res = await fetchWithAuth(`${API_BASE}/v0/management/oauth/models?${query.toString()}`);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Failed to fetch OAuth provider models');
  }
  const json = (await res.json()) as {
    data?: OAuthDiscoveredModel[];
    source?: 'codex-backend' | 'catalog';
    warning?: string;
  };
  return {
    models: json.data || [],
    source: json.source ?? 'catalog',
    ...(json.warning ? { warning: json.warning } : {}),
  };
};

export const getUserQuotas = async (): Promise<Record<string, UserQuota>> => {
  try {
    const res = await fetchWithAuth(`${API_BASE}/v0/management/user-quotas`);
    if (!res.ok) throw new Error('Failed to fetch user quotas');
    return await res.json();
  } catch (e) {
    console.error('API Error getUserQuotas', e);
    return {};
  }
};

export const getUserQuota = async (name: string): Promise<UserQuota | null> => {
  try {
    const res = await fetchWithAuth(
      `${API_BASE}/v0/management/user-quotas/${encodeURIComponent(name)}`
    );
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error('Failed to fetch user quota');
    }
    return await res.json();
  } catch (e) {
    console.error('API Error getUserQuota', e);
    return null;
  }
};

export const saveUserQuota = async (name: string, quota: UserQuota): Promise<void> => {
  const res = await fetchWithAuth(
    `${API_BASE}/v0/management/user-quotas/${encodeURIComponent(name)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(quota),
    }
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: 'Unknown error' }))) as {
      error?: { message?: string } | string;
    };
    const msg = typeof err.error === 'object' ? err.error?.message : err.error;
    throw new Error(msg || 'Failed to save quota');
  }
};

export const updateUserQuota = async (name: string, updates: Partial<UserQuota>): Promise<void> => {
  const res = await fetchWithAuth(
    `${API_BASE}/v0/management/user-quotas/${encodeURIComponent(name)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    }
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: 'Unknown error' }))) as {
      error?: { message?: string } | string;
    };
    const msg = typeof err.error === 'object' ? err.error?.message : err.error;
    throw new Error(msg || 'Failed to update quota');
  }
};

export const deleteUserQuota = async (name: string): Promise<void> => {
  const res = await fetchWithAuth(
    `${API_BASE}/v0/management/user-quotas/${encodeURIComponent(name)}`,
    {
      method: 'DELETE',
    }
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: 'Unknown error' }))) as {
      error?: { message?: string } | string;
    };
    const msg = typeof err.error === 'object' ? err.error?.message : err.error;
    throw new Error(msg || 'Failed to delete quota');
  }
};

export const getQuotaStatus = async (
  key: string
): Promise<{
  key: string;
  quotas: QuotaStatusEntry[];
  quota_name: string | null;
  allowed: boolean;
  current_usage: number;
  limit: number | null;
  remaining: number | null;
  resets_at: string | null;
} | null> => {
  try {
    const res = await fetchWithAuth(
      `${API_BASE}/v0/management/quota/status/${encodeURIComponent(key)}`
    );
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error('Failed to fetch quota status');
    }
    return await res.json();
  } catch (e) {
    console.error('API Error getQuotaStatus', e);
    return null;
  }
};

export const clearQuota = async (key: string, quota?: string): Promise<void> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/quota/clear`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, ...(quota ? { quota } : {}) }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: 'Unknown error' }))) as {
      error?: { message?: string } | string;
    };
    const msg = typeof err.error === 'object' ? err.error?.message : err.error;
    throw new Error(msg || 'Failed to clear quota');
  }
};

export const recomputeQuota = async (
  key: string,
  quota: string
): Promise<{
  success: true;
  key: string;
  quota: string;
  usage: number;
  windowStartMs: number;
  message: string;
}> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/quota/recompute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, quota }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: 'Unknown error' }))) as {
      error?: { message?: string } | string;
      reason?: string;
    };
    const message =
      (typeof err.error === 'object' ? err.error?.message : err.error) ||
      'Failed to recompute quota';
    const wrapped = new Error(message) as Error & { reason?: string };
    wrapped.reason = err.reason;
    throw wrapped;
  }
  return res.json();
};

export const getSelfMe = async (): Promise<{
  role: 'admin' | 'limited';
  keyName?: string;
  allowedProviders?: string[];
  allowedModels?: string[];
  allowRawPassthrough?: boolean;
  quotaNames?: string[];
  quotaName?: string | null;
  comment?: string | null;
  traceEnabled?: boolean;
  traceEnabledGlobal?: boolean;
}> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/self/me`);
  if (!res.ok) throw new Error('Failed to fetch self info');
  return res.json();
};

export const rotateSelfSecret = async (): Promise<{
  keyName: string;
  secret: string;
  message: string;
}> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/self/rotate`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: 'Rotation failed' }))) as {
      error?: { message?: string } | string;
    };
    const msg = typeof err.error === 'object' ? err.error?.message : err.error;
    throw new Error(msg || 'Rotation failed');
  }
  return res.json();
};

export const updateSelfComment = async (
  comment: string | null
): Promise<{ success: boolean; keyName: string; comment: string | null }> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/self/comment`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment }),
  });
  if (!res.ok) throw new Error('Failed to update comment');
  return res.json();
};

export const toggleSelfDebug = async (
  enabled: boolean
): Promise<{ keyName: string; enabled: boolean; enabledGlobal: boolean }> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/self/debug/toggle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error('Failed to toggle trace');
  return res.json();
};

export const getSelfQuota = async (): Promise<{
  key: string;
  quotas: QuotaStatusEntry[];
  quotaName: string | null;
  allowed: boolean;
  currentUsage: number;
  limit: number | null;
  remaining: number | null;
  resetsAt: string | null;
  limitType: 'requests' | 'tokens' | 'cost' | null;
}> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/self/quota`);
  if (!res.ok) throw new Error('Failed to fetch quota status');
  return res.json();
};

export const createBackup = async (): Promise<Blob> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/backup`);
  if (!res.ok) throw new Error('Failed to create backup');
  return res.blob();
};

export const createFullBackup = async (): Promise<Blob> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/backup?full=true`);
  if (!res.ok) throw new Error('Failed to create full backup');
  return res.blob();
};

export const restoreBackup = async (
  data: object
): Promise<{
  success: boolean;
  restored: Record<string, number>;
  message: string;
}> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: 'Restore failed' }))) as {
      error?: string;
    };
    throw new Error(err.error || 'Restore failed');
  }
  return res.json();
};

export const restoreFullBackup = async (
  file: File
): Promise<{
  success: boolean;
  restored: Record<string, number>;
  message: string;
}> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: await file.arrayBuffer(),
  } as RequestInit);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: 'Restore failed' }))) as {
      error?: string;
    };
    throw new Error(err.error || 'Restore failed');
  }
  return res.json();
};

export const resetLogs = async (): Promise<{ success: boolean; message: string }> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/logs/reset`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: 'Reset logs failed' }))) as {
      error?: string;
    };
    throw new Error(err.error || 'Reset logs failed');
  }
  return res.json();
};

export const getFailoverPolicy = async (): Promise<{
  enabled: boolean;
  retryableStatusCodes: number[];
  retryableErrors: string[];
}> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/config/failover`);
  if (!res.ok) throw new Error('Failed to fetch failover policy');
  return res.json();
};

export const patchFailoverPolicy = async (updates: {
  enabled?: boolean;
  retryableStatusCodes?: number[];
  retryableErrors?: string[];
}): Promise<{
  enabled: boolean;
  retryableStatusCodes: number[];
  retryableErrors: string[];
}> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/config/failover`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('Failed to update failover policy');
  return res.json();
};

export const getCaptureTraceOnError = async (): Promise<{ enabled: boolean }> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/config/capture-trace-on-error`);
  if (!res.ok) throw new Error('Failed to fetch capture-trace-on-error setting');
  return res.json();
};

export const setCaptureTraceOnError = async (enabled: boolean): Promise<{ enabled: boolean }> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/config/capture-trace-on-error`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error('Failed to update capture-trace-on-error setting');
  return res.json();
};

export const getCooldownPolicy = async (): Promise<{
  initialMinutes: number;
  maxMinutes: number;
}> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/config/cooldown`);
  if (!res.ok) throw new Error('Failed to fetch cooldown policy');
  return res.json();
};

export const patchCooldownPolicy = async (updates: {
  initialMinutes?: number;
  maxMinutes?: number;
}): Promise<{
  initialMinutes: number;
  maxMinutes: number;
}> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/config/cooldown`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('Failed to update cooldown policy');
  return res.json();
};

export const getTrustedProxies = async (): Promise<{ trustedProxies: string[] }> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/config/trusted-proxies`);
  if (!res.ok) throw new Error('Failed to fetch trusted proxies');
  return res.json();
};

export const patchTrustedProxies = async (
  trustedProxies: string[]
): Promise<{ trustedProxies: string[] }> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/config/trusted-proxies`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trustedProxies }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      error?: string;
      details?: Array<{ message?: string }>;
    };
    const detail =
      Array.isArray(err.details) && err.details[0]?.message ? `: ${err.details[0].message}` : '';
    throw new Error(`${err.error || 'Failed to update trusted proxies'}${detail}`);
  }
  return res.json();
};

export const getExplorationRates = async (): Promise<{
  performanceExplorationRate: number;
  latencyExplorationRate: number;
  e2ePerformanceExplorationRate: number;
}> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/config/exploration-rate`);
  if (!res.ok) throw new Error('Failed to fetch exploration rate settings');
  return res.json();
};

export const patchExplorationRates = async (updates: {
  performanceExplorationRate?: number;
  latencyExplorationRate?: number;
  e2ePerformanceExplorationRate?: number;
}): Promise<{
  performanceExplorationRate: number;
  latencyExplorationRate: number;
  e2ePerformanceExplorationRate: number;
}> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/config/exploration-rate`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('Failed to update exploration rate settings');
  return res.json();
};

export const getBackgroundExploration = async (): Promise<{
  enabled: boolean;
  stalenessThresholdSeconds: number;
  workerConcurrency: number;
}> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/config/background-exploration`);
  if (!res.ok) throw new Error('Failed to fetch background exploration settings');
  return res.json();
};

export const patchBackgroundExploration = async (updates: {
  enabled?: boolean;
  stalenessThresholdSeconds?: number;
  workerConcurrency?: number;
}): Promise<{
  enabled: boolean;
  stalenessThresholdSeconds: number;
  workerConcurrency: number;
}> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/config/background-exploration`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('Failed to update background exploration settings');
  return res.json();
};

export const getTimeoutConfig = async (): Promise<{ defaultSeconds: number }> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/config/timeout`);
  if (!res.ok) throw new Error('Failed to fetch timeout settings');
  return res.json();
};

export const patchTimeoutConfig = async (updates: {
  defaultSeconds?: number;
}): Promise<{ defaultSeconds: number }> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/config/timeout`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('Failed to update timeout settings');
  return res.json();
};

export const getCompactionConfig = async (): Promise<CompactionSettings> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/config/compaction`);
  if (!res.ok) throw new Error('Failed to fetch compaction settings');
  return res.json();
};

export const patchCompactionConfig = async (
  updates: CompactionSettings
): Promise<CompactionSettings> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/config/compaction`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates, (_key, value) => (value === undefined ? null : value)),
  });
  if (!res.ok) throw new Error('Failed to update compaction settings');
  return res.json();
};

export const getStallConfig = async (): Promise<{
  ttfbSeconds: number | null;
  ttfbBytes: number;
  minBytesPerSecond: number | null;
  windowSeconds: number;
  gracePeriodSeconds: number;
  stallCooldown: boolean;
}> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/config/stall`);
  if (!res.ok) throw new Error('Failed to fetch stall detection settings');
  return res.json();
};

export const patchStallConfig = async (updates: {
  ttfbSeconds?: number | null;
  ttfbBytes?: number;
  minBytesPerSecond?: number | null;
  windowSeconds?: number;
  gracePeriodSeconds?: number;
  stallCooldown?: boolean;
}): Promise<{
  ttfbSeconds: number | null;
  ttfbBytes: number;
  minBytesPerSecond: number | null;
  windowSeconds: number;
  gracePeriodSeconds: number;
  stallCooldown: boolean;
}> => {
  const res = await fetchWithAuth(`${API_BASE}/v0/management/config/stall`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('Failed to update stall detection settings');
  return res.json();
};
