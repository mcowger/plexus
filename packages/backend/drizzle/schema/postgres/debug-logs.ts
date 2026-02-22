import { pgTable, serial, text, bigint, index } from 'drizzle-orm/pg-core';

export const debugLogs = pgTable(
  'debug_logs',
  {
    id: serial('id').primaryKey(),
    requestId: text('request_id').notNull(),
    rawRequest: text('raw_request'),
    transformedRequest: text('transformed_request'),
    rawResponse: text('raw_response'),
    transformedResponse: text('transformed_response'),
    rawResponseSnapshot: text('raw_response_snapshot'),
    transformedResponseSnapshot: text('transformed_response_snapshot'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    requestIdIdx: index('idx_debug_logs_request_id').on(table.requestId),
    createdAtIdx: index('idx_debug_logs_created_at').on(table.createdAt),
  })
);
