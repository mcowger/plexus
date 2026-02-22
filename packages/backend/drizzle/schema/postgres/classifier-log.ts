import { pgTable, serial, text, real, bigint, boolean, index } from 'drizzle-orm/pg-core';

export const classifierLog = pgTable(
  'classifier_log',
  {
    id: serial('id').primaryKey(),
    requestId: text('request_id').notNull(),
    tier: text('tier').notNull(),
    score: real('score').notNull(),
    confidence: real('confidence').notNull(),
    method: text('method').notNull(), // "short-circuit" | "rules"
    reasoning: text('reasoning').notNull(),
    signals: text('signals').notNull(), // JSON array stringified
    agenticScore: real('agentic_score').notNull(),
    hasStructuredOutput: boolean('has_structured_output').notNull(),
    resolvedAlias: text('resolved_alias'), // the tier_models alias that was selected
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    requestIdIdx: index('idx_classifier_log_request_id').on(table.requestId),
    createdAtIdx: index('idx_classifier_log_created_at').on(table.createdAt),
  })
);
