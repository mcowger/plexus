import { sqliteTable, integer, text, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const debugLogs = sqliteTable('debug_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  requestId: text('request_id').notNull(),
  rawRequest: text('raw_request'),
  transformedRequest: text('transformed_request'),
  rawResponse: text('raw_response'),
  transformedResponse: text('transformed_response'),
  rawResponseSnapshot: text('raw_response_snapshot'),
  transformedResponseSnapshot: text('transformed_response_snapshot'),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  requestIdIdx: index('idx_debug_logs_request_id').on(table.requestId),
  createdAtIdx: index('idx_debug_logs_created_at').on(table.createdAt),
}));
