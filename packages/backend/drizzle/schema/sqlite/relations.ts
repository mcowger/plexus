import { relations } from 'drizzle-orm';
import { requestUsage } from './request-usage';
import { debugLogs } from './debug-logs';
import { inferenceErrors } from './inference-errors';

export const requestUsageRelations = relations(requestUsage, ({ one }) => ({
  debugLog: one(debugLogs, {
    fields: [requestUsage.requestId],
    references: [debugLogs.requestId],
  }),
  errors: one(inferenceErrors, {
    fields: [requestUsage.requestId],
    references: [inferenceErrors.requestId],
  }),
}));

export const debugLogsRelations = relations(debugLogs, ({ one }) => ({
  usage: one(requestUsage, {
    fields: [debugLogs.requestId],
    references: [requestUsage.requestId],
  }),
}));

export const inferenceErrorsRelations = relations(inferenceErrors, ({ one }) => ({
  usage: one(requestUsage, {
    fields: [inferenceErrors.requestId],
    references: [requestUsage.requestId],
  }),
}));
