import { parse, stringify } from 'yaml';
import { formatNumber } from './format';

const API_BASE = ''; // Proxied via server.ts

const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
  const headers = new Headers(options.headers || {});
  const adminKey = localStorage.getItem('plexus_admin_key');
  if (adminKey) {
    headers.set('x-admin-key', adminKey);
  }
  
  const res = await fetch(url, { ...options, headers });
  
  if (res.status === 401) {
    // If unauthorized, clear key to trigger re-login
    localStorage.removeItem('plexus_admin_key');
    // Optional: Dispatch event or reload. 
    // Usually the React Context will catch this on next refresh, or we can reload here.
    if (window.location.pathname !== '/ui/login') {
       window.location.href = '/ui/login';
    }
  }
  return res;
};

export interface Stat {
  label: string;
  value: string | number;
  change?: number;
  icon?: string;
}

export interface UsageData {
  timestamp: string;
  requests: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export interface Provider {
  id: string;
  name: string;
  type: string | string[];
  apiBaseUrl?: string | Record<string, string>;
  apiKey: string;
  enabled: boolean;
  discount?: number;
  headers?: Record<string, string>;
  extraBody?: Record<string, any>;
  models?: string[] | Record<string, any>;
}

export interface Model {
  id: string;
  name: string;
  providerId: string;
  pricingSource?: string;
}

export interface Alias {
    id: string;
    aliases?: string[];
    selector?: string;
    priority?: 'selector' | 'api_match';
    targets: Array<{ provider: string; model: string; apiType?: string[] }>;
}

export interface InferenceError {
    id: number;
    request_id: string;
    date: string;
    error_message: string;
    error_stack?: string;
    details?: string;
    created_at: number;
}

export interface Cooldown {
    provider: string;
    accountId?: string;
    expiry: number;
    timeRemainingMs: number;
}

// Backend Types
export interface UsageRecord {
    requestId: string;
    date: string;
    sourceIp?: string;
    apiKey?: string;
    incomingApiType?: string;
    provider?: string;
    incomingModelAlias?: string;
    selectedModelName?: string;
    outgoingApiType?: string;
    tokensInput?: number;
    tokensOutput?: number;
    tokensReasoning?: number;
    tokensCached?: number;
    costInput?: number;
    costOutput?: number;
    costCached?: number;
    costTotal?: number;
    costSource?: string;
    costMetadata?: string;
    startTime: number;
    durationMs: number;
    isStreamed: boolean;
    responseStatus: string;
    ttftMs?: number;
    tokensPerSec?: number;
    hasDebug?: boolean;
    hasError?: boolean;
    isPassthrough?: boolean;
}

interface BackendResponse<T> {
    data: T;
    total: number;
    error?: string;
}

interface PlexusConfig {
    providers: Record<string, {
        type: string | string[];
        api_key?: string;
        api_base_url?: string | Record<string, string>;
        display_name?: string;
        models?: string[] | Record<string, any>;
        enabled?: boolean; // Custom field we might want to preserve if we could
    }>;
    models?: Record<string, any>;
    keys?: Record<string, KeyConfig>;
}

export interface KeyConfig {
    key: string; // The user-facing alias/name for the key (e.g. 'my-app')
    secret: string; // The actual sk-uuid
    comment?: string;
}

export const formatLargeNumber = formatNumber;

export const STAT_LABELS = {
    REQUESTS: 'Total Requests',
    PROVIDERS: 'Active Providers',
    TOKENS: 'Total Tokens',
    DURATION: 'Avg. Duration'
} as const;

export const api = {
  getCooldowns: async (): Promise<Cooldown[]> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/cooldowns`);
          if (!res.ok) throw new Error('Failed to fetch cooldowns');
          return await res.json();
      } catch (e) {
          console.error("API Error getCooldowns", e);
          return [];
      }
  },

  clearCooldown: async (provider?: string, accountId?: string): Promise<void> => {
      let url: string;
      if (provider) {
          url = `${API_BASE}/v0/management/cooldowns/${provider}`;
          if (accountId) {
              url += `?accountId=${encodeURIComponent(accountId)}`;
          }
      } else {
          url = `${API_BASE}/v0/management/cooldowns`;
      }

      const res = await fetchWithAuth(url, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to clear cooldown');
  },

  getStats: async (): Promise<Stat[]> => {
    try {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
        
        // Fetch last 1000 requests for stats calculation (approximation)
        const params = new URLSearchParams({
            limit: '1000',
            startDate: startDate.toISOString()
        });
        
        const res = await fetchWithAuth(`${API_BASE}/v0/management/usage?${params}`);
        if (!res.ok) throw new Error('Failed to fetch usage');
        const json = await res.json() as BackendResponse<UsageRecord[]>;
        
        const records = json.data || [];
        const totalRequests = json.total;
        
        const totalTokens = records.reduce((acc, r) => acc + (r.tokensInput || 0) + (r.tokensOutput || 0), 0);
        const avgLatency = records.length ? Math.round(records.reduce((acc, r) => acc + (r.durationMs || 0), 0) / records.length) : 0;
        
        // Get active providers count
        const configStr = await api.getConfig();
        const config = parse(configStr) as PlexusConfig;
        const activeProviders = Object.keys(config.providers || {}).length;

        return [
            { label: STAT_LABELS.REQUESTS, value: totalRequests.toLocaleString() }, // Change calculation requires historical comparison
            { label: STAT_LABELS.PROVIDERS, value: activeProviders },
            { label: STAT_LABELS.TOKENS, value: formatLargeNumber(totalTokens) },
            { label: STAT_LABELS.DURATION, value: avgLatency + 'ms' },
        ];
    } catch (e) {
        console.error("API Error getStats", e);
        return [
            { label: STAT_LABELS.REQUESTS, value: '-' },
            { label: STAT_LABELS.PROVIDERS, value: '-' },
            { label: STAT_LABELS.TOKENS, value: '-' },
            { label: STAT_LABELS.DURATION, value: '-' },
        ];
    }
  },

  getUsageData: async (range: 'hour' | 'day' | 'week' | 'month' = 'week'): Promise<UsageData[]> => {
    try {
        const startDate = new Date();
        let bucketFormat: (d: Date) => string;
        let buckets = 0;
        let step = 0; // ms

        switch (range) {
            case 'hour':
                startDate.setHours(startDate.getHours() - 1);
                bucketFormat = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                buckets = 60;
                step = 60 * 1000; // 1 min
                break;
            case 'day':
                startDate.setHours(startDate.getHours() - 24);
                bucketFormat = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); // Hour resolution
                buckets = 24;
                step = 60 * 60 * 1000; // 1 hour
                break;
            case 'week':
            default:
                startDate.setDate(startDate.getDate() - 7);
                bucketFormat = (d) => d.toLocaleDateString();
                buckets = 7;
                step = 24 * 60 * 60 * 1000; // 1 day
                break;
            case 'month':
                startDate.setDate(startDate.getDate() - 30);
                bucketFormat = (d) => d.toLocaleDateString();
                buckets = 30;
                step = 24 * 60 * 60 * 1000; // 1 day
                break;
        }
        
        const params = new URLSearchParams({
            limit: '5000',
            startDate: startDate.toISOString()
        });
        
        const res = await fetchWithAuth(`${API_BASE}/v0/management/usage?${params}`);
        if (!res.ok) throw new Error('Failed to fetch usage');
        const json = await res.json() as BackendResponse<UsageRecord[]>;
        const records = json.data || [];

        // Grouping
        const grouped: Record<string, UsageData> = {};
        
        // Initialize buckets
        const now = Date.now();
        for (let i = buckets; i >= 0; i--) {
            const t = new Date(now - (i * step));
            // Snap to bucket start
            if (range === 'day') t.setMinutes(0, 0, 0); 
            if (range === 'week' || range === 'month') t.setHours(0, 0, 0, 0);
            
            const key = bucketFormat(t);
            if (!grouped[key]) {
                grouped[key] = { 
                    timestamp: key, 
                    requests: 0, 
                    tokens: 0,
                    inputTokens: 0,
                    outputTokens: 0,
                    cachedTokens: 0
                };
            }
        }

        records.forEach(r => {
            const d = new Date(r.date);
            if (d < startDate) return;
            
            let key = bucketFormat(d);
            // Fix key generation for aggregation to match initialized buckets if needed, 
            // but simplified formatting usually aligns enough for visual graph
            
            // For 'day' (24h), we want to group by hour. bucketFormat returns HH:MM.
            // If we initialized buckets as HH:00, we need to snap record time to HH:00
            if (range === 'day') d.setMinutes(0, 0, 0);
            if (range === 'week' || range === 'month') d.setHours(0, 0, 0, 0);
            
            key = bucketFormat(d);

            if (!grouped[key]) {
                grouped[key] = { 
                    timestamp: key, 
                    requests: 0, 
                    tokens: 0,
                    inputTokens: 0,
                    outputTokens: 0,
                    cachedTokens: 0
                };
            }
            grouped[key].requests++;
            grouped[key].tokens += (r.tokensInput || 0) + (r.tokensOutput || 0);
            grouped[key].inputTokens += (r.tokensInput || 0);
            grouped[key].outputTokens += (r.tokensOutput || 0);
            grouped[key].cachedTokens += (r.tokensCached || 0);
        });

        return Object.values(grouped);
    } catch (e) {
        console.error("API Error getUsageData", e);
        return [];
    }
  },

  getLogs: async (limit: number = 50, offset: number = 0, filters: Record<string, any> = {}): Promise<{ data: UsageRecord[], total: number }> => {
      const params = new URLSearchParams({
          limit: limit.toString(),
          offset: offset.toString(),
          ...filters
      });

      const res = await fetchWithAuth(`${API_BASE}/v0/management/usage?${params}`);
      if (!res.ok) throw new Error('Failed to fetch logs');
      return await res.json() as BackendResponse<UsageRecord[]>;
  },

  getConfig: async (): Promise<string> => {
    const res = await fetchWithAuth(`${API_BASE}/v0/management/config`);
    if (!res.ok) throw new Error('Failed to fetch config');
    return await res.text();
  },

  saveConfig: async (config: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_BASE}/v0/management/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/yaml' }, // or application/x-yaml
        body: config
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to save config');
    }
  },

  getKeys: async (): Promise<KeyConfig[]> => {
      try {
          const yamlStr = await api.getConfig();
          const config = parse(yamlStr) as PlexusConfig;
          if (!config.keys) return [];
          
          return Object.entries(config.keys).map(([key, val]) => ({
              key,
              secret: val.secret,
              comment: val.comment
          }));
      } catch (e) {
          console.error("API Error getKeys", e);
          return [];
      }
  },

  saveKey: async (keyConfig: KeyConfig, oldKeyName?: string): Promise<void> => {
      const yamlStr = await api.getConfig();
      let config: any;
      try {
          config = parse(yamlStr);
      } catch (e) {
          config = { providers: {}, models: {}, keys: {} };
      }

      if (!config) config = {};
      if (!config.keys) config.keys = {};

      // If key name changed, delete old key
      if (oldKeyName && oldKeyName !== keyConfig.key && config.keys[oldKeyName]) {
          delete config.keys[oldKeyName];
      }

      config.keys[keyConfig.key] = {
          secret: keyConfig.secret,
          comment: keyConfig.comment
      };

      const newYaml = stringify(config);
      await api.saveConfig(newYaml);
  },

  deleteKey: async (keyName: string): Promise<void> => {
      const yamlStr = await api.getConfig();
      let config: any;
      try {
          config = parse(yamlStr);
      } catch (e) {
          return; // Nothing to delete
      }

      if (config && config.keys && config.keys[keyName]) {
          delete config.keys[keyName];
          const newYaml = stringify(config);
          await api.saveConfig(newYaml);
      }
  },

  getProviders: async (): Promise<Provider[]> => {
    try {
        const yamlStr = await api.getConfig();
        const config = parse(yamlStr) as PlexusConfig;
        
        if (!config.providers) return [];

        return Object.entries(config.providers).map(([key, val]) => ({
            id: key,
            name: val.display_name || key,
            type: val.type,
            apiBaseUrl: val.api_base_url,
            apiKey: val.api_key || '',
            enabled: val.enabled !== false, // Default to true if not present
            discount: val.discount,
            headers: val.headers,
            extraBody: val.extraBody,
            models: val.models
        }));
    } catch (e) {
        console.error("API Error getProviders", e);
        return [];
    }
  },

  saveProviders: async (providers: Provider[]): Promise<void> => {
      // 1. Get current config to preserve other sections (like models)
      const yamlStr = await api.getConfig();
      let config: any;
      try {
          config = parse(yamlStr);
      } catch (e) {
          config = { providers: {}, models: {} };
      }

      if (!config) config = {};
      if (!config.providers) config.providers = {};

      // 2. Reconstruct providers object
      // We need to be careful not to lose existing fields if the Provider interface is a subset
      // But here we are assuming the Provider interface is the source of truth for the keys we manage.
      // However, to be safe, we should merge.
      
      // Strategy: Create a new providers object based on input
      const newProvidersObj: Record<string, any> = {};
      
      for (const p of providers) {
          const existing = config.providers[p.id] || {};
          newProvidersObj[p.id] = {
              ...existing, // Keep existing fields like models list if any
              type: p.type,
              api_key: p.apiKey,
              api_base_url: p.apiBaseUrl,
              display_name: p.name,
              discount: p.discount,
              headers: p.headers,
              extraBody: p.extraBody,
              models: p.models
          };
      }
      
      config.providers = newProvidersObj;

      // 3. Save
      const newYaml = stringify(config);
      await api.saveConfig(newYaml);
  },

  saveProvider: async (provider: Provider, oldId?: string): Promise<void> => {
      const yamlStr = await api.getConfig();
      let config: any;
      try {
          config = parse(yamlStr);
      } catch (e) {
          config = { providers: {}, models: {} };
      }

      if (!config) config = {};
      if (!config.providers) config.providers = {};

      // If ID changed, delete old key
      if (oldId && oldId !== provider.id && config.providers[oldId]) {
          delete config.providers[oldId];
      }

      config.providers[provider.id] = {
          type: provider.type,
          api_key: provider.apiKey,
          api_base_url: provider.apiBaseUrl,
          display_name: provider.name,
          discount: provider.discount,
          headers: provider.headers,
          extraBody: provider.extraBody,
          models: provider.models,
          enabled: provider.enabled
      };

      const newYaml = stringify(config);
      await api.saveConfig(newYaml);
  },

  saveAlias: async (alias: Alias, oldId?: string): Promise<void> => {
      const yamlStr = await api.getConfig();
      let config: any;
      try {
          config = parse(yamlStr);
      } catch (e) {
          config = { providers: {}, models: {} };
      }

      if (!config) config = {};
      if (!config.models) config.models = {};

      // If ID changed, delete old key
      if (oldId && oldId !== alias.id && config.models[oldId]) {
          delete config.models[oldId];
      }

      config.models[alias.id] = {
          selector: alias.selector,
          priority: alias.priority || 'selector',
          additional_aliases: alias.aliases,
          targets: alias.targets.map(t => ({
              provider: t.provider,
              model: t.model
          }))
      };

      const newYaml = stringify(config);
      await api.saveConfig(newYaml);
  },

  getModels: async (): Promise<Model[]> => {
    try {
        const yamlStr = await api.getConfig();
        const config = parse(yamlStr) as PlexusConfig;
        const models: Model[] = [];

        // Extract models from providers
        if (config.providers) {
            Object.entries(config.providers).forEach(([pKey, pVal]) => {
                if (pVal.models) {
                    if (Array.isArray(pVal.models)) {
                        pVal.models.forEach(m => {
                            models.push({
                                id: m,
                                name: m,
                                providerId: pKey
                            });
                        });
                    } else if (typeof pVal.models === 'object') {
                        Object.entries(pVal.models).forEach(([mKey, mVal]) => {
                            models.push({
                                id: mKey,
                                name: mKey,
                                providerId: pKey,
                                pricingSource: mVal.pricing?.source
                            });
                        });
                    }
                }
            });
        }
        return models;
    } catch (e) {
        console.error("API Error getModels", e);
        return [];
    }
  },

  getAliases: async (): Promise<Alias[]> => {
    try {
        const yamlStr = await api.getConfig();
        const config = parse(yamlStr) as PlexusConfig;
        const aliases: Alias[] = [];
        const providers = config.providers || {};

        if (config.models) {
            Object.entries(config.models).forEach(([key, val]) => {
                const targets = (val.targets || []).map((t: { provider: string; model: string }) => {
                    const providerConfig = providers[t.provider];
                    let apiType: string | string[] = providerConfig?.type || 'unknown';

                    // Check for specific model config overrides (access_via)
                    if (providerConfig?.models && !Array.isArray(providerConfig.models)) {
                        const modelConfig = providerConfig.models[t.model];
                        if (modelConfig && modelConfig.access_via) {
                            apiType = modelConfig.access_via;
                        }
                    }

                    return {
                        provider: t.provider,
                        model: t.model,
                        apiType: Array.isArray(apiType) ? apiType : [apiType]
                    };
                });

                aliases.push({
                    id: key,
                    aliases: val.additional_aliases || [],
                    selector: val.selector,
                    priority: val.priority,
                    targets
                });
            });
        }
        return aliases;
    } catch (e) {
        console.error("API Error getAliases", e);
        return [];
    }
  },

  getDebugLogs: async (limit: number = 50, offset: number = 0): Promise<{ requestId: string, createdAt: number }[]> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/debug/logs?limit=${limit}&offset=${offset}`);
          if (!res.ok) throw new Error('Failed to fetch debug logs');
          return await res.json();
      } catch (e) {
          console.error("API Error getDebugLogs", e);
          return [];
      }
  },

  getDebugLogDetail: async (requestId: string): Promise<any> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/debug/logs/${requestId}`);
          if (!res.ok) throw new Error('Failed to fetch debug log detail');
          return await res.json();
      } catch (e) {
          console.error("API Error getDebugLogDetail", e);
          return null;
      }
  },

  deleteDebugLog: async (requestId: string): Promise<boolean> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/debug/logs/${requestId}`, {
              method: 'DELETE'
          });
          return res.ok;
      } catch (e) {
          console.error("API Error deleteDebugLog", e);
          return false;
      }
  },

  deleteAllDebugLogs: async (): Promise<boolean> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/debug/logs`, {
              method: 'DELETE'
          });
          return res.ok;
      } catch (e) {
          console.error("API Error deleteAllDebugLogs", e);
          return false;
      }
  },

  getErrors: async (limit: number = 50, offset: number = 0): Promise<InferenceError[]> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/errors?limit=${limit}&offset=${offset}`);
          if (!res.ok) throw new Error('Failed to fetch error logs');
          return await res.json();
      } catch (e) {
          console.error("API Error getErrors", e);
          return [];
      }
  },

  deleteError: async (requestId: string): Promise<boolean> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/errors/${requestId}`, {
              method: 'DELETE'
          });
          return res.ok;
      } catch (e) {
          console.error("API Error deleteError", e);
          return false;
      }
  },

  deleteAllErrors: async (): Promise<boolean> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/errors`, {
              method: 'DELETE'
          });
          return res.ok;
      } catch (e) {
          console.error("API Error deleteAllErrors", e);
          return false;
      }
  },

  deleteUsageLog: async (requestId: string): Promise<boolean> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/usage/${requestId}`, {
              method: 'DELETE'
          });
          return res.ok;
      } catch (e) {
          console.error("API Error deleteUsageLog", e);
          return false;
      }
  },

  deleteAllUsageLogs: async (olderThanDays?: number): Promise<boolean> => {
      try {
          let url = `${API_BASE}/v0/management/usage`;
          if (olderThanDays !== undefined) {
              url += `?olderThanDays=${olderThanDays}`;
          }
          const res = await fetchWithAuth(url, {
              method: 'DELETE'
          });
          return res.ok;
      } catch (e) {
          console.error("API Error deleteAllUsageLogs", e);
          return false;
      }
  },

  getDebugMode: async (): Promise<boolean> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/debug`);
          if (!res.ok) throw new Error('Failed to fetch debug status');
          const json = await res.json();
          return !!json.enabled;
      } catch (e) {
          console.error("API Error getDebugMode", e);
          return false;
      }
  },

  setDebugMode: async (enabled: boolean): Promise<boolean> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/management/debug`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ enabled })
          });
          if (!res.ok) throw new Error('Failed to set debug status');
          const json = await res.json();
          return !!json.enabled;
      } catch (e) {
          console.error("API Error setDebugMode", e);
          throw e;
      }
  },

  // OAuth Management
  getOAuthStatus: async (provider: string = 'antigravity'): Promise<{
      configured: boolean;
      provider?: string;
      user?: string;
      project_id?: string;
      expires_at?: number;
      expires_in_seconds?: number;
      is_expired?: boolean;
      auth_url?: string;
      message?: string;
  }> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/oauth/status?provider=${provider}`);
          if (!res.ok) throw new Error('Failed to fetch OAuth status');
          return await res.json();
      } catch (e) {
          console.error("API Error getOAuthStatus", e);
          return { configured: false, message: 'Error fetching OAuth status' };
      }
  },

  initiateOAuthFlow: async (provider: string = 'antigravity'): Promise<{
      auth_url: string;
      instructions: string;
  }> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/oauth/authorize?provider=${provider}`);
          if (!res.ok) throw new Error('Failed to initiate OAuth flow');
          return await res.json();
      } catch (e) {
          console.error("API Error initiateOAuthFlow", e);
          throw e;
      }
  },

  deleteOAuthCredentials: async (provider: string, userIdentifier: string): Promise<boolean> => {
      try {
          const res = await fetchWithAuth(
              `${API_BASE}/v0/oauth/credentials?provider=${provider}&user_identifier=${encodeURIComponent(userIdentifier)}`,
              { method: 'DELETE' }
          );
          return res.ok;
      } catch (e) {
          console.error("API Error deleteOAuthCredentials", e);
          return false;
      }
  },

  refreshOAuthToken: async (): Promise<{ success: boolean; message: string }> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/oauth/refresh`, {
              method: 'POST'
          });
          if (!res.ok) throw new Error('Failed to refresh OAuth token');
          return await res.json();
      } catch (e) {
          console.error("API Error refreshOAuthToken", e);
          return { success: false, message: 'Failed to trigger token refresh' };
      }
  },

  getOAuthRefreshStatus: async (): Promise<{
      available: boolean;
      running?: boolean;
      checkInterval?: number;
      refreshThreshold?: number;
      message?: string;
  }> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/oauth/refresh/status`);
          if (!res.ok) throw new Error('Failed to fetch refresh status');
          return await res.json();
      } catch (e) {
          console.error("API Error getOAuthRefreshStatus", e);
          return { available: false, message: 'Error fetching refresh status' };
      }
  },

  // Multi-Account OAuth Management
  getOAuthCredentialsGrouped: async (provider?: string): Promise<{
      providers: Array<{
          provider: string;
          accounts: Array<{
              user_identifier: string;
              expires_at: number;
              expires_in_seconds: number;
              is_expired: boolean;
              project_id?: string;
              on_cooldown: boolean;
              cooldown_expiry?: number;
              cooldown_remaining_seconds?: number;
              status: 'active' | 'expiring' | 'expired' | 'cooldown';
              last_refreshed_at: number;
              token_age_seconds: number;
              refresh_token_expires_at: number;
              refresh_token_expires_in_seconds: number;
          }>;
      }>;
  }> => {
      try {
          const url = provider
              ? `${API_BASE}/v0/oauth/credentials/grouped?provider=${provider}`
              : `${API_BASE}/v0/oauth/credentials/grouped`;
          const res = await fetchWithAuth(url);
          if (!res.ok) throw new Error('Failed to fetch OAuth credentials');
          return await res.json();
      } catch (e) {
          console.error("API Error getOAuthCredentialsGrouped", e);
          return { providers: [] };
      }
  },

  // Claude Code OAuth Management
  initiateClaudeCodeAuth: async (): Promise<{
      auth_url: string;
      state: string;
  }> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/oauth/claude/authorize`, {
              method: 'POST'
          });
          if (!res.ok) throw new Error('Failed to initiate Claude Code OAuth flow');
          return await res.json();
      } catch (e) {
          console.error("API Error initiateClaudeCodeAuth", e);
          throw e;
      }
  },

  getClaudeCodeAccounts: async (): Promise<{
      accounts: Array<{
          email: string;
          organization_name: string;
          organization_uuid: string;
          account_uuid: string;
          expires_at: number;
          expires_in_seconds: number;
          is_expired: boolean;
          on_cooldown: boolean;
          cooldown_remaining_seconds?: number;
          status: 'active' | 'expired' | 'cooldown';
          last_refreshed_at: number;
      }>;
  }> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/oauth/claude/accounts`);
          if (!res.ok) throw new Error('Failed to fetch Claude Code accounts');
          return await res.json();
      } catch (e) {
          console.error("API Error getClaudeCodeAccounts", e);
          return { accounts: [] };
      }
  },

  refreshClaudeCodeToken: async (email: string): Promise<{
      success: boolean;
      expires_at?: number;
      error?: string;
  }> => {
      try {
          const res = await fetchWithAuth(`${API_BASE}/v0/oauth/claude/refresh`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email })
          });
          if (!res.ok) {
              const error = await res.json();
              return { success: false, error: error.error || 'Failed to refresh token' };
          }
          return await res.json();
      } catch (e) {
          console.error("API Error refreshClaudeCodeToken", e);
          return { success: false, error: 'Failed to refresh token' };
      }
  },

  deleteClaudeCodeAccount: async (email: string): Promise<boolean> => {
      try {
          const res = await fetchWithAuth(
              `${API_BASE}/v0/oauth/claude/${encodeURIComponent(email)}`,
              { method: 'DELETE' }
          );
          return res.ok;
      } catch (e) {
          console.error("API Error deleteClaudeCodeAccount", e);
          return false;
      }
  }
};
