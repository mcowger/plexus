import { relations } from 'drizzle-orm';

import { debugLogs } from './debug-logs';
import { inferenceErrors } from './inference-errors';
import { requestUsage } from './request-usage';

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
