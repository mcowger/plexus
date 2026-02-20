import { sqliteTable, integer, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const a2aAgents = sqliteTable('a2a_agents', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  agentId: text('agent_id').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  endpoint: text('endpoint').notNull(),
  version: text('version').notNull(),
  capabilities: text('capabilities'),
  skills: text('skills'),
  defaultInputModes: text('default_input_modes'),
  defaultOutputModes: text('default_output_modes'),
  additionalInterfaces: text('additional_interfaces'),
  authConfig: text('auth_config'),
  metadata: text('metadata'),
  enabled: integer('enabled').notNull().default(1),
  lastDiscoveredAt: text('last_discovered_at'),
  lastHealthyAt: text('last_healthy_at'),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  endpointIdx: index('idx_a2a_agents_endpoint').on(table.endpoint),
  enabledIdx: index('idx_a2a_agents_enabled').on(table.enabled),
  updatedAtIdx: index('idx_a2a_agents_updated_at').on(table.updatedAt),
}));

export const a2aTasks = sqliteTable('a2a_tasks', {
  id: text('id').primaryKey(),
  contextId: text('context_id').notNull(),
  ownerKey: text('owner_key').notNull().default('system'),
  ownerAttribution: text('owner_attribution'),
  agentId: text('agent_id').notNull(),
  status: text('status').notNull(),
  latestMessage: text('latest_message'),
  requestMessage: text('request_message'),
  artifacts: text('artifacts'),
  metadata: text('metadata'),
  idempotencyKey: text('idempotency_key'),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  submittedAt: text('submitted_at').notNull(),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  canceledAt: text('canceled_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  contextIdIdx: index('idx_a2a_tasks_context_id').on(table.contextId),
  ownerKeyIdx: index('idx_a2a_tasks_owner_key').on(table.ownerKey),
  agentIdIdx: index('idx_a2a_tasks_agent_id').on(table.agentId),
  statusIdx: index('idx_a2a_tasks_status').on(table.status),
  createdAtIdx: index('idx_a2a_tasks_created_at').on(table.createdAt),
  idempotencyKeyIdx: uniqueIndex('uq_a2a_tasks_idempotency_key').on(table.idempotencyKey),
}));

export const a2aTaskEvents = sqliteTable('a2a_task_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskId: text('task_id').notNull(),
  eventType: text('event_type').notNull(),
  sequence: integer('sequence').notNull(),
  payload: text('payload').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  taskIdIdx: index('idx_a2a_task_events_task_id').on(table.taskId),
  createdAtIdx: index('idx_a2a_task_events_created_at').on(table.createdAt),
  taskSequenceIdx: uniqueIndex('uq_a2a_task_events_task_sequence').on(table.taskId, table.sequence),
}));

export const a2aPushNotificationConfigs = sqliteTable('a2a_push_notification_configs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskId: text('task_id').notNull(),
  ownerKey: text('owner_key').notNull().default('system'),
  configId: text('config_id').notNull(),
  endpoint: text('endpoint').notNull(),
  authentication: text('authentication'),
  metadata: text('metadata'),
  enabled: integer('enabled').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  taskIdIdx: index('idx_a2a_push_configs_task_id').on(table.taskId),
  ownerKeyIdx: index('idx_a2a_push_configs_owner_key').on(table.ownerKey),
  taskConfigIdx: uniqueIndex('uq_a2a_push_configs_task_config').on(table.taskId, table.configId),
}));
