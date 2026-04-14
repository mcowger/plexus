// Re-export from sqlite by default for backward compatibility
export * from './sqlite/request-usage';
export * from './sqlite/provider-cooldowns';
export * from './sqlite/debug-logs';
export * from './sqlite/inference-errors';
export * from './sqlite/provider-performance';
export * from './sqlite/quota-snapshots';
export * from './sqlite/responses';
export * from './sqlite/mcp';
export * from './sqlite/quota-state';
export {
  requestUsageRelations,
  debugLogsRelations,
  inferenceErrorsRelations,
} from './sqlite/relations';

// Dialect-specific PostgreSQL exports
export { requestUsage as pgRequestUsage } from './postgres/request-usage';
export { providerCooldowns as pgProviderCooldowns } from './postgres/provider-cooldowns';
export { debugLogs as pgDebugLogs } from './postgres/debug-logs';
export { inferenceErrors as pgInferenceErrors } from './postgres/inference-errors';
export { providerPerformance as pgProviderPerformance } from './postgres/provider-performance';
export { quotaSnapshots as pgQuotaSnapshots } from './postgres/quota-snapshots';
export {
  responses as pgResponses,
  conversations as pgConversations,
  responseItems as pgResponseItems,
} from './postgres/responses';
export {
  mcpRequestUsage as pgMcpRequestUsage,
  mcpDebugLogs as pgMcpDebugLogs,
} from './postgres/mcp';
export { quotaState as pgQuotaState } from './postgres/quota-state';

// Config tables (SQLite default exports)
export * from './sqlite/providers';
export * from './sqlite/provider-models';
export * from './sqlite/model-aliases';
export * from './sqlite/model-alias-targets';
export * from './sqlite/alias-metadata-overrides';
export * from './sqlite/api-keys';
export * from './sqlite/user-quota-definitions';
export * from './sqlite/mcp-servers';
export * from './sqlite/system-settings';
export * from './sqlite/oauth-credentials';
export {
  providersRelations,
  providerModelsRelations,
  modelAliasesRelations,
  modelAliasTargetsRelations,
  aliasMetadataOverridesRelations,
} from './sqlite/config-relations';

// Config tables (PostgreSQL exports)
export { providers as pgProviders } from './postgres/providers';
export { providerModels as pgProviderModels } from './postgres/provider-models';
export { modelAliases as pgModelAliases } from './postgres/model-aliases';
export { modelAliasTargets as pgModelAliasTargets } from './postgres/model-alias-targets';
export { aliasMetadataOverrides as pgAliasMetadataOverrides } from './postgres/alias-metadata-overrides';
export { apiKeys as pgApiKeys } from './postgres/api-keys';
export { userQuotaDefinitions as pgUserQuotaDefinitions } from './postgres/user-quota-definitions';
export { mcpServers as pgMcpServers } from './postgres/mcp-servers';
export { systemSettings as pgSystemSettings } from './postgres/system-settings';
export { oauthCredentials as pgOauthCredentials } from './postgres/oauth-credentials';
