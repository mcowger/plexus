import { sqliteTable, integer, text, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const inferenceErrors = sqliteTable(
  'inference_errors',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    requestId: text('request_id').notNull(),
    date: text('date').notNull(),
    apiKey: text('api_key'),
    errorMessage: text('error_message'),
    errorStack: text('error_stack'),
    details: text('details'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => ({
    requestIdIdx: index('idx_errors_request_id').on(table.requestId),
    dateIdx: index('idx_errors_date').on(table.date),
    apiKeyIdx: index('idx_inference_errors_api_key').on(table.apiKey),
  })
);
