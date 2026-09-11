import * as usageApi from './usage';
import * as mcpApi from './mcp';
import * as aliasesApi from './aliases';
import * as settingsApi from './settings';

export {
  API_BASE,
  fetchWithAuth,
  formatLargeNumber,
  formatPoints,
  inferProviderTypes,
  STAT_LABELS,
  verifyAdminKey,
} from './core';

export {
  fetchCustomQuotaCheckers,
  fetchQuotaCheckers,
  saveCustomQuotaChecker,
  deleteCustomQuotaChecker,
  testCustomQuotaChecker,
  normalizeQuotaCheckerInfo,
} from './settings';

export { aliasToConfigPayload } from './aliases';

export const api = {
  // Cooldowns
  getCooldowns: settingsApi.getCooldowns,
  clearCooldown: settingsApi.clearCooldown,

  // Stats & Dashboard
  getStats: usageApi.getStats,
  getDashboardData: usageApi.getDashboardData,
  getUsageSummary: usageApi.getUsageSummary,
  getSummaryData: usageApi.getSummaryData,
  getUsageData: usageApi.getUsageData,
  getTodayMetrics: usageApi.getTodayMetrics,
  getProviderPerformance: usageApi.getProviderPerformance,
  clearProviderPerformance: usageApi.clearProviderPerformance,
  getLogs: usageApi.getLogs,
  getUsageRecords: usageApi.getUsageRecords,

  // Config & System
  getConfig: settingsApi.getConfig,
  getConfigExport: settingsApi.getConfigExport,
  getDefaultQuotas: settingsApi.getDefaultQuotas,
  setDefaultQuotas: settingsApi.setDefaultQuotas,
  restart: settingsApi.restart,

  // Keys
  getKeys: settingsApi.getKeys,
  saveKey: settingsApi.saveKey,
  disableKey: settingsApi.disableKey,
  deleteKey: settingsApi.deleteKey,

  // Providers
  getProviders: settingsApi.getProviders,
  saveProvider: settingsApi.saveProvider,
  updateProviderEnabled: settingsApi.updateProviderEnabled,
  getVisionFallthroughConfig: aliasesApi.getVisionFallthroughConfig,
  updateVisionFallthroughConfig: aliasesApi.updateVisionFallthroughConfig,
  deleteProvider: settingsApi.deleteProvider,
  getAffectedAliases: aliasesApi.getAffectedAliases,

  // Aliases & Models
  saveAlias: aliasesApi.saveAlias,
  previewModelResolution: aliasesApi.previewModelResolution,
  getModels: aliasesApi.getModels,
  getAliases: aliasesApi.getAliases,

  // Debug & Logging
  getDebugLogs: settingsApi.getDebugLogs,
  getDebugLogDetail: settingsApi.getDebugLogDetail,
  deleteDebugLog: settingsApi.deleteDebugLog,
  deleteAllDebugLogs: settingsApi.deleteAllDebugLogs,
  getErrors: settingsApi.getErrors,
  deleteError: settingsApi.deleteError,
  deleteAllErrors: settingsApi.deleteAllErrors,
  deleteUsageLog: usageApi.deleteUsageLog,
  deleteAllUsageLogs: usageApi.deleteAllUsageLogs,
  getDebugMode: settingsApi.getDebugMode,
  setDebugMode: settingsApi.setDebugMode,
  getLoggingLevel: settingsApi.getLoggingLevel,
  setLoggingLevel: settingsApi.setLoggingLevel,
  resetLoggingLevel: settingsApi.resetLoggingLevel,
  getModuleFilter: settingsApi.getModuleFilter,
  setModuleFilter: settingsApi.setModuleFilter,
  clearModuleFilter: settingsApi.clearModuleFilter,

  // Model Testing & Quotas
  testModel: aliasesApi.testModel,
  getQuotas: settingsApi.getQuotas,
  getQuota: settingsApi.getQuota,
  getQuotaHistory: settingsApi.getQuotaHistory,
  triggerQuotaCheck: settingsApi.triggerQuotaCheck,
  deleteAlias: aliasesApi.deleteAlias,
  deleteAllAliases: aliasesApi.deleteAllAliases,

  // OAuth
  getOAuthProviders: settingsApi.getOAuthProviders,
  startOAuthSession: settingsApi.startOAuthSession,
  deleteOAuthCredentials: settingsApi.deleteOAuthCredentials,
  getOAuthCredentialStatus: settingsApi.getOAuthCredentialStatus,
  getOAuthSession: settingsApi.getOAuthSession,
  submitOAuthPrompt: settingsApi.submitOAuthPrompt,
  submitOAuthManualCode: settingsApi.submitOAuthManualCode,
  cancelOAuthSession: settingsApi.cancelOAuthSession,

  // Metadata Catalogs & Pi Models
  searchModelMetadata: aliasesApi.searchModelMetadata,
  getModelMetadata: aliasesApi.getModelMetadata,
  refreshModelMetadata: aliasesApi.refreshModelMetadata,
  getPiProviders: aliasesApi.getPiProviders,
  getPiModels: aliasesApi.getPiModels,
  getOAuthProviderModels: settingsApi.getOAuthProviderModels,

  // MCP Servers
  getMcpServers: mcpApi.getMcpServers,
  saveMcpServer: mcpApi.saveMcpServer,
  deleteMcpServer: mcpApi.deleteMcpServer,
  getMcpServerKeys: mcpApi.getMcpServerKeys,
  addMcpServerKey: mcpApi.addMcpServerKey,
  deleteMcpServerKey: mcpApi.deleteMcpServerKey,
  clearMcpServerKeyCooldown: mcpApi.clearMcpServerKeyCooldown,
  getMcpServerStatus: mcpApi.getMcpServerStatus,
  startMcpServer: mcpApi.startMcpServer,
  stopMcpServer: mcpApi.stopMcpServer,
  restartMcpServer: mcpApi.restartMcpServer,
  getMcpLogs: mcpApi.getMcpLogs,
  getMcpOAuthClients: mcpApi.getMcpOAuthClients,
  revokeMcpOAuthToken: mcpApi.revokeMcpOAuthToken,
  updateMcpOAuthClientStatus: mcpApi.updateMcpOAuthClientStatus,
  deleteMcpOAuthClient: mcpApi.deleteMcpOAuthClient,
  revokeMcpOAuthClientTokens: mcpApi.revokeMcpOAuthClientTokens,
  deleteMcpLog: mcpApi.deleteMcpLog,
  deleteAllMcpLogs: mcpApi.deleteAllMcpLogs,

  // User Quotas
  getUserQuotas: settingsApi.getUserQuotas,
  getUserQuota: settingsApi.getUserQuota,
  saveUserQuota: settingsApi.saveUserQuota,
  updateUserQuota: settingsApi.updateUserQuota,
  deleteUserQuota: settingsApi.deleteUserQuota,
  getQuotaStatus: settingsApi.getQuotaStatus,
  clearQuota: settingsApi.clearQuota,
  recomputeQuota: settingsApi.recomputeQuota,

  // Concurrency & Provider Models
  getConcurrencyData: usageApi.getConcurrencyData,
  fetchProviderModels: settingsApi.fetchProviderModels,

  // Self-service
  getSelfMe: settingsApi.getSelfMe,
  rotateSelfSecret: settingsApi.rotateSelfSecret,
  updateSelfComment: settingsApi.updateSelfComment,
  toggleSelfDebug: settingsApi.toggleSelfDebug,
  getSelfQuota: settingsApi.getSelfQuota,

  // Backup & Restore
  createBackup: settingsApi.createBackup,
  createFullBackup: settingsApi.createFullBackup,
  restoreBackup: settingsApi.restoreBackup,
  restoreFullBackup: settingsApi.restoreFullBackup,
  resetLogs: settingsApi.resetLogs,

  // System & Policy Settings
  getSystemSettings: settingsApi.getSystemSettings,
  patchSystemSettings: settingsApi.patchSystemSettings,
  getFailoverPolicy: settingsApi.getFailoverPolicy,
  patchFailoverPolicy: settingsApi.patchFailoverPolicy,
  getCaptureTraceOnError: settingsApi.getCaptureTraceOnError,
  setCaptureTraceOnError: settingsApi.setCaptureTraceOnError,
  getCooldownPolicy: settingsApi.getCooldownPolicy,
  patchCooldownPolicy: settingsApi.patchCooldownPolicy,
  getTrustedProxies: settingsApi.getTrustedProxies,
  patchTrustedProxies: settingsApi.patchTrustedProxies,
  getExplorationRates: settingsApi.getExplorationRates,
  patchExplorationRates: settingsApi.patchExplorationRates,
  getBackgroundExploration: settingsApi.getBackgroundExploration,
  patchBackgroundExploration: settingsApi.patchBackgroundExploration,
  getTimeoutConfig: settingsApi.getTimeoutConfig,
  patchTimeoutConfig: settingsApi.patchTimeoutConfig,
  getCompactionConfig: settingsApi.getCompactionConfig,
  patchCompactionConfig: settingsApi.patchCompactionConfig,
  getMcpEnabled: mcpApi.getMcpEnabled,
  patchMcpEnabled: mcpApi.patchMcpEnabled,
  getStallConfig: settingsApi.getStallConfig,
  patchStallConfig: settingsApi.patchStallConfig,
};
