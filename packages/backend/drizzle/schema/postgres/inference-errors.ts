import { pgTable, serial, text, bigint, index } from 'drizzle-orm/pg-core';

export const inferenceErrors = pgTable(
  'inference_errors',
  {
    id: serial('id').primaryKey(),
    requestId: text('request_id').notNull(),
    date: text('date').notNull(),
    apiKey: text('api_key'),
    errorMessage: text('error_message'),
    errorStack: text('error_stack'),
    details: text('details'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    requestIdIdx: index('idx_errors_request_id').on(table.requestId),
    dateIdx: index('idx_errors_date').on(table.date),
    apiKeyIdx: index('idx_inference_errors_api_key').on(table.apiKey),
  })
);
