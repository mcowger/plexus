import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

export const apiKeys = sqliteTable('api_keys', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  secret: text('secret').notNull().unique(),
  secretHash: text('secret_hash').unique(),
  comment: text('comment'),
  quotaName: text('quota_name'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
