import { pgTable, serial, text, integer, boolean, unique } from 'drizzle-orm/pg-core';
import { modelAliases } from './model-aliases';

export const modelAliasTargets = pgTable(
  'model_alias_targets',
  {
    id: serial('id').primaryKey(),
    aliasId: integer('alias_id')
      .notNull()
      .references(() => modelAliases.id, { onDelete: 'cascade' }),
    providerSlug: text('provider_slug').notNull(),
    modelName: text('model_name').notNull(),
    enabled: boolean('enabled').notNull().default(true),
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
