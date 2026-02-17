import { pgTable, serial, text, integer, index, timestamp } from 'drizzle-orm/pg-core';

export const mcpRequestUsage = pgTable('mcp_request_usage', {
  id: serial('id').primaryKey(),
  requestId: text('request_id').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  startTime: integer('start_time').notNull(),
  durationMs: integer('duration_ms'),
  serverName: text('server_name').notNull(),
  upstreamUrl: text('upstream_url').notNull(),
  method: text('method').notNull(),
  jsonrpcMethod: text('jsonrpc_method'),
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

export const mcpDebugLogs = pgTable('mcp_debug_logs', {
  id: serial('id').primaryKey(),
  requestId: text('request_id').notNull().unique(),
  rawRequestHeaders: text('raw_request_headers'),
  rawRequestBody: text('raw_request_body'),
  rawResponseHeaders: text('raw_response_headers'),
  rawResponseBody: text('raw_response_body'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  requestIdIdx: index('idx_mcp_debug_logs_request_id').on(table.requestId),
}));
