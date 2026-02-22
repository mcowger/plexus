import { sqliteTable, integer, text, real, index } from 'drizzle-orm/sqlite-core';

export const classifierLog = sqliteTable(
  'classifier_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    requestId: text('request_id').notNull(),
    tier: text('tier').notNull(),
    score: real('score').notNull(),
    confidence: real('confidence').notNull(),
    method: text('method').notNull(), // "short-circuit" | "rules"
    reasoning: text('reasoning').notNull(),
    signals: text('signals').notNull(), // JSON array stringified
    agenticScore: real('agentic_score').notNull(),
    hasStructuredOutput: integer('has_structured_output').notNull(), // 0 | 1
    resolvedAlias: text('resolved_alias'), // the tier_models alias that was selected
    createdAt: integer('created_at').notNull(),
  },
  (table) => ({
    requestIdIdx: index('idx_classifier_log_request_id').on(table.requestId),
    createdAtIdx: index('idx_classifier_log_created_at').on(table.createdAt),
  })
);
