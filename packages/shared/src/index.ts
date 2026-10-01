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
  PiAiQuirks,
  ProviderPreset,
  ProviderPresetDraft,
  ProviderPresetTemplateVar,
} from './provider-presets';

export {
  AUTO_TASK_KINDS,
  AUTO_CAPABILITY_TIERS,
  AUTO_REASONING_SUITABILITY,
  AutoTaskKindSchema,
  AutoCapabilityTierSchema,
  AutoReasoningSuitabilitySchema,
  AutoRoutingScoringSchema,
  AutoRoutingPreferencesSchema,
  AutoRoutingSwitchingSchema,
  AutoRoutingConfigSchema,
  AutoTargetProfileSchema,
  DEFAULT_AUTO_ROUTING_SCORING,
  DEFAULT_AUTO_ROUTING_PREFERENCES,
  DEFAULT_AUTO_ROUTING_SWITCHING,
  DEFAULT_AUTO_ROUTING_CONFIG,
} from './auto-routing';
export type {
  AutoTaskKind,
  AutoCapabilityTier,
  AutoReasoningSuitability,
  AutoRoutingScoring,
  AutoRoutingPreferences,
  AutoRoutingSwitching,
  AutoRoutingConfig,
  AutoTargetProfile,
} from './auto-routing';

export {
  LocalHttpMcpServerConfigSchema,
  McpKeyCreateSchema,
  McpKeySchema,
  McpServerConfigSchema,
  McpServerSettingsSchema,
  RemoteHttpMcpServerConfigSchema,
} from './mcp';
export type { McpKey, McpKeyCreate, McpServerConfig } from './mcp';
