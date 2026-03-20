import { pgTable, serial, text, bigint } from 'drizzle-orm/pg-core';

export const apiKeys = pgTable('api_keys', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  secret: text('secret').notNull().unique(),
  secretHash: text('secret_hash').unique(),
  comment: text('comment'),
  quotaName: text('quota_name'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});
