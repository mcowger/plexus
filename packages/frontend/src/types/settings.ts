export * from './quota';

/**
 * Shape of the principal returned by GET /v0/management/auth/verify.
 * Admins get just { role: 'admin' }; api-key users get the key metadata so
 * the frontend can render a scoped view without a follow-up call.
 */
export type Principal =
  | { role: 'admin' }
  | {
      role: 'limited';
      keyName: string;
      allowedProviders: string[];
      allowedModels: string[];
      excludedProviders: string[];
      excludedModels: string[];
      quotaName?: string | null;
      comment?: string | null;
    };

export interface CompactionSettings {
  enabled?: boolean;
  strategy?: 'native' | 'headroom';
  triggerRatio?: number;
  absoluteTriggerTokens?: number | null;
  minTokens?: number;
  protectRecent?: number;
  native?: { maxArrayItems?: number; maxStringChars?: number };
  headroom?: { baseUrl?: string; apiKey?: string; targetRatio?: number | null; timeoutMs?: number };
}

export interface Provider {
  id: string;
  name: string;
  type: string | string[];
  apiBaseUrl?: string | Record<string, string>;
  apiKey: string;
  oauthProvider?: string;
  oauthAccount?: string;
  enabled: boolean;
  disableCooldown?: boolean;
  stallCooldown?: boolean;
  allow100PercentUtilization?: boolean;
  estimateTokens?: boolean;
  useClaudeMasking?: boolean;
  geminiThinkingEnabled?: boolean;
  discount?: number;
  headers?: Record<string, string>;
  extraBody?: Record<string, any>;
  models?: string[] | Record<string, any>;
  quotaChecker?: {
    type?: string;
    enabled: boolean;
    intervalMinutes: number;
    options?: Record<string, unknown>;
  };
  modelAutosync?: {
    enabled: boolean;
    intervalMinutes: number;
  };
  adapter?: any[];
  timeoutMs?: number;
  maxConcurrency?: number | null;
  auto_compat?: boolean;
  // Per-provider stall detection overrides
  stallTtfbMs?: number | null;
  stallTtfbBytes?: number | null;
  stallMinBps?: number | null;
  stallWindowMs?: number | null;
  stallGracePeriodMs?: number | null;
  pi_ai_provider?: string;
  compaction?: CompactionSettings;
  rawPassthrough?: {
    enabled: boolean;
    baseUrl: string;
    auth: 'bearer' | 'x-api-key' | 'x-goog-api-key';
  };
}

export interface LoggingLevelState {
  level: string;
  startupLevel: string;
  supportedLevels: string[];
  ephemeral: boolean;
}

export interface ModuleFilterState {
  modules: string[];
}

export interface InferenceError {
  id: number;
  requestId: string;
  date: string;
  errorMessage: string;
  errorStack?: string;
  details?:
    | string
    | {
        apiType?: string;
        provider?: string;
        targetModel?: string;
        targetApiType?: string;
        url?: string;
        headers?: Record<string, string>;
        statusCode?: number;
        providerResponse?: string;
      };
  createdAt: number;
}

export interface Cooldown {
  provider: string;
  model: string;
  accountId?: string | null;
  expiry: number;
  timeRemainingMs: number;
  consecutiveFailures?: number;
  lastError?: string;
}

export interface KeyConfig {
  key: string; // The user-facing alias/name for the key (e.g. 'my-app')
  secret: string; // The actual sk-uuid
  comment?: string;
  // Zero or more quota-definition names assigned to this key (non-stacking:
  // when empty, the system's `default_quotas` fallback applies instead).
  // The deprecated single `quota` field is still accepted by the backend on
  // write, but responses only ever emit `quotas` — this type follows suit.
  quotas?: string[];
  allowedModels?: string[];
  allowedProviders?: string[];
  excludedModels?: string[];
  excludedProviders?: string[];
  allowRawPassthrough?: boolean;
  allowedIps?: string[];
  expiresInMinutes?: number;
  expiresAt?: number;
  disabledAt?: number;
}

export interface OAuthProviderInfo {
  id: string;
  name: string;
  usesCallbackServer: boolean;
}

export interface OAuthAuthInfo {
  url: string;
  instructions?: string;
}

export interface OAuthPrompt {
  message: string;
  placeholder?: string;
  allowEmpty?: boolean;
}

export interface OAuthSession {
  id: string;
  providerId: string;
  accountId: string;
  status: string;
  authInfo?: OAuthAuthInfo;
  prompt?: OAuthPrompt;
  progress: string[];
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface OAuthCredentialStatus {
  ready: boolean;
}

/**
 * A model entry returned by `GET /v0/management/oauth/models`. Codex is the one
 * OAuth provider whose list is account-scoped and fetched live, so entries can
 * carry a modality hint, the protocols they are reachable through, and the
 * upstream's own listing hint (`hide` models work but are not advertised).
 */
export interface OAuthDiscoveredModel {
  id: string;
  name?: string;
  context_length?: number;
  description?: string;
  pricing?: { prompt?: string; completion?: string };
  type?: 'text' | 'image';
  access_via?: string[];
  visibility?: 'list' | 'hide';
}

export interface OAuthProviderModelsResult {
  models: OAuthDiscoveredModel[];
  /** `catalog` means the live Codex lookup was unavailable and we fell back. */
  source: 'codex-backend' | 'catalog';
  /** Present only on a fallback — a warning, not a hard error. */
  warning?: string;
}
