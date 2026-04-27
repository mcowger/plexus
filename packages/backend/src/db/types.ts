import { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';

export type RequestUsage = InferSelectModel<typeof schema.requestUsage>;
export type ProviderCooldown = InferSelectModel<typeof schema.providerCooldowns>;
export type DebugLog = InferSelectModel<typeof schema.debugLogs>;
export type InferenceError = InferSelectModel<typeof schema.inferenceErrors>;
export type ProviderPerformance = InferSelectModel<typeof schema.providerPerformance>;
// QuotaSnapshot / NewQuotaSnapshot removed — the old quota_snapshots table is
// superseded by meter_snapshots. See src/types/meter.ts for the new types.
export type McpRequestUsage = InferSelectModel<typeof schema.mcpRequestUsage>;
export type McpDebugLog = InferSelectModel<typeof schema.mcpDebugLogs>;

export type NewRequestUsage = InferInsertModel<typeof schema.requestUsage>;
export type NewProviderCooldown = InferInsertModel<typeof schema.providerCooldowns>;
export type NewDebugLog = InferInsertModel<typeof schema.debugLogs>;
export type NewInferenceError = InferInsertModel<typeof schema.inferenceErrors>;
export type NewProviderPerformance = InferInsertModel<typeof schema.providerPerformance>;
export type NewMcpRequestUsage = InferInsertModel<typeof schema.mcpRequestUsage>;
export type NewMcpDebugLog = InferInsertModel<typeof schema.mcpDebugLogs>;

export type UsageRecord = Omit<RequestUsage, 'isStreamed' | 'isPassthrough'> & {
  isStreamed: boolean;
  isPassthrough: boolean;
  hasDebug?: boolean;
  hasError?: boolean;
};
