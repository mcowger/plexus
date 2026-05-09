import { sqliteTable, integer, text, unique } from 'drizzle-orm/sqlite-core';
import { modelAliases } from './model-aliases';

export const modelAliasTargets = sqliteTable(
  'model_alias_targets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    aliasId: integer('alias_id')
      .notNull()
      .references(() => modelAliases.id, { onDelete: 'cascade' }),
    providerSlug: text('provider_slug').notNull(),
    modelName: text('model_name').notNull(),
    enabled: integer('enabled').notNull().default(1),
    groupName: text('group_name'), // target group label
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => ({
    aliasProviderModelUnique: unique('uq_alias_targets').on(
      table.aliasId,
      table.providerSlug,
      table.modelName
    ),
  })
);
