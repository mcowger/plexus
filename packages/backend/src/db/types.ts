import { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';

export type RequestUsage = InferSelectModel<typeof schema.requestUsage>;
export type ProviderCooldown = InferSelectModel<typeof schema.providerCooldowns>;
export type DebugLog = InferSelectModel<typeof schema.debugLogs>;
export type InferenceError = InferSelectModel<typeof schema.inferenceErrors>;
export type ProviderPerformance = InferSelectModel<typeof schema.providerPerformance>;
export type QuotaSnapshot = InferSelectModel<typeof schema.quotaSnapshots>;
export type McpRequestUsage = InferSelectModel<typeof schema.mcpRequestUsage>;
export type McpDebugLog = InferSelectModel<typeof schema.mcpDebugLogs>;
export type A2aAgent = InferSelectModel<typeof schema.a2aAgents>;
export type A2aTask = InferSelectModel<typeof schema.a2aTasks>;
export type A2aTaskEvent = InferSelectModel<typeof schema.a2aTaskEvents>;
export type A2aPushNotificationConfig = InferSelectModel<typeof schema.a2aPushNotificationConfigs>;

export type NewRequestUsage = InferInsertModel<typeof schema.requestUsage>;
export type NewProviderCooldown = InferInsertModel<typeof schema.providerCooldowns>;
export type NewDebugLog = InferInsertModel<typeof schema.debugLogs>;
export type NewInferenceError = InferInsertModel<typeof schema.inferenceErrors>;
export type NewProviderPerformance = InferInsertModel<typeof schema.providerPerformance>;
export type NewQuotaSnapshot = InferInsertModel<typeof schema.quotaSnapshots>;
export type NewMcpRequestUsage = InferInsertModel<typeof schema.mcpRequestUsage>;
export type NewMcpDebugLog = InferInsertModel<typeof schema.mcpDebugLogs>;
export type NewA2aAgent = InferInsertModel<typeof schema.a2aAgents>;
export type NewA2aTask = InferInsertModel<typeof schema.a2aTasks>;
export type NewA2aTaskEvent = InferInsertModel<typeof schema.a2aTaskEvents>;
export type NewA2aPushNotificationConfig = InferInsertModel<typeof schema.a2aPushNotificationConfigs>;

export type UsageRecord = Omit<RequestUsage, 'isStreamed' | 'isPassthrough'> & {
  isStreamed: boolean;
  isPassthrough: boolean;
  hasDebug?: boolean;
  hasError?: boolean;
};
