// Cooldown time formatting utilities
export {
  formatMinutesToMinSec,
  formatMsToMinSec,
  INDEFINITE_COOLDOWN_MS,
  INDEFINITE_COOLDOWN_THRESHOLD_MS,
} from './format-time';

// Quota ranking (most-constrained selection) shared by backend and frontend
export { constrainedRatio, mostConstrained, sortMostConstrainedFirst } from './quota-ranking';
export type { QuotaRatioFields } from './quota-ranking';

export {
  isOAuthPlaceholderUrl,
  isBodyCacheKeyInjectionField,
  getDefaultCacheKeyInjection,
  PROVIDER_CACHE_KEY_INJECTION_OPTIONS,
  PROVIDER_CACHE_KEY_INJECTION_VALUES,
  ProviderCacheKeyInjectionSchema,
  getDefaultResponsesExtensions,
  RESPONSES_EXTENSIONS,
  RESPONSES_LITE_EXTENSIONS,
  RESPONSES_EXTENSION_OPTIONS,
  ResponsesExtensionSchema,
} from './provider';
export type {
  ProviderCacheKeyInjection,
  ProviderCacheKeyInjectionOption,
  ResponsesExtension,
  ResponsesExtensionOption,
} from './provider';

export {
  ProviderPresetSchema,
  PiAiQuirksSchema,
  applyProviderPreset,
  findProviderPreset,
  findUnresolvedPresetVars,
  substitutePresetVars,
} from './provider-presets';
export type {
  ApplyProviderPresetOptions,
  PiAiQuirks,
  ProviderPreset,
  ProviderPresetDraft,
  ProviderPresetTemplateVar,
} from './provider-presets';

export {
  LocalHttpMcpServerConfigSchema,
  McpKeyCreateSchema,
  McpKeySchema,
  McpServerConfigSchema,
  McpServerSettingsSchema,
  RemoteHttpMcpServerConfigSchema,
} from './mcp';
export type { McpKey, McpKeyCreate, McpServerConfig } from './mcp';
