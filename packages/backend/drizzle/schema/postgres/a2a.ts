import { pgTable, serial, text, integer, index, uniqueIndex, timestamp } from 'drizzle-orm/pg-core';

export const a2aAgents = pgTable('a2a_agents', {
  id: serial('id').primaryKey(),
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
  lastDiscoveredAt: timestamp('last_discovered_at'),
  lastHealthyAt: timestamp('last_healthy_at'),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  endpointIdx: index('idx_a2a_agents_endpoint').on(table.endpoint),
  enabledIdx: index('idx_a2a_agents_enabled').on(table.enabled),
  updatedAtIdx: index('idx_a2a_agents_updated_at').on(table.updatedAt),
}));

export const a2aTasks = pgTable('a2a_tasks', {
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
  submittedAt: timestamp('submitted_at').notNull().defaultNow(),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  canceledAt: timestamp('canceled_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  contextIdIdx: index('idx_a2a_tasks_context_id').on(table.contextId),
  ownerKeyIdx: index('idx_a2a_tasks_owner_key').on(table.ownerKey),
  agentIdIdx: index('idx_a2a_tasks_agent_id').on(table.agentId),
  statusIdx: index('idx_a2a_tasks_status').on(table.status),
  createdAtIdx: index('idx_a2a_tasks_created_at').on(table.createdAt),
  idempotencyKeyIdx: uniqueIndex('uq_a2a_tasks_idempotency_key').on(table.idempotencyKey),
}));

export const a2aTaskEvents = pgTable('a2a_task_events', {
  id: serial('id').primaryKey(),
  taskId: text('task_id').notNull(),
  eventType: text('event_type').notNull(),
  sequence: integer('sequence').notNull(),
  payload: text('payload').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  taskIdIdx: index('idx_a2a_task_events_task_id').on(table.taskId),
  createdAtIdx: index('idx_a2a_task_events_created_at').on(table.createdAt),
  taskSequenceIdx: uniqueIndex('uq_a2a_task_events_task_sequence').on(table.taskId, table.sequence),
}));

export const a2aPushNotificationConfigs = pgTable('a2a_push_notification_configs', {
  id: serial('id').primaryKey(),
  taskId: text('task_id').notNull(),
  ownerKey: text('owner_key').notNull().default('system'),
  configId: text('config_id').notNull(),
  endpoint: text('endpoint').notNull(),
  authentication: text('authentication'),
  metadata: text('metadata'),
  enabled: integer('enabled').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  taskIdIdx: index('idx_a2a_push_configs_task_id').on(table.taskId),
  ownerKeyIdx: index('idx_a2a_push_configs_owner_key').on(table.ownerKey),
  taskConfigIdx: uniqueIndex('uq_a2a_push_configs_task_config').on(table.taskId, table.configId),
}));
