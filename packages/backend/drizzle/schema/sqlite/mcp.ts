import { sqliteTable, integer, text, index } from 'drizzle-orm/sqlite-core';

export const mcpRequestUsage = sqliteTable('mcp_request_usage', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  requestId: text('request_id').notNull().unique(),
  createdAt: text('created_at').notNull(),
  startTime: integer('start_time').notNull(),
  durationMs: integer('duration_ms'),
  serverName: text('server_name').notNull(),
  upstreamUrl: text('upstream_url').notNull(),
  method: text('method').notNull(),
  jsonrpcMethod: text('jsonrpc_method'),
  toolName: text('tool_name'),
  apiKey: text('api_key'),
  attribution: text('attribution'),
  sourceIp: text('source_ip'),
  responseStatus: integer('response_status'),
  isStreamed: integer('is_streamed').notNull().default(0),
  hasDebug: integer('has_debug').notNull().default(0),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
}, (table) => ({
  serverNameIdx: index('idx_mcp_request_usage_server_name').on(table.serverName),
  createdAtIdx: index('idx_mcp_request_usage_created_at').on(table.createdAt),
}));

export const mcpDebugLogs = sqliteTable('mcp_debug_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  requestId: text('request_id').notNull().unique(),
  rawRequestHeaders: text('raw_request_headers'),
  rawRequestBody: text('raw_request_body'),
  rawResponseHeaders: text('raw_response_headers'),
  rawResponseBody: text('raw_response_body'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  requestIdIdx: index('idx_mcp_debug_logs_request_id').on(table.requestId),
}));
