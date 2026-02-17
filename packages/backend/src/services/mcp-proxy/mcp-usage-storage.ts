import { logger } from '../../utils/logger';
import { getDatabase, getCurrentDialect } from '../../db/client';
import * as sqliteMcp from '../../../drizzle/schema/sqlite/mcp';
import * as pgMcp from '../../../drizzle/schema/postgres/mcp';

interface McpRequestUsageRecord {
  request_id: string;
  created_at: string;
  start_time: number;
  duration_ms: number | null;
  server_name: string;
  upstream_url: string;
  method: 'POST' | 'GET' | 'DELETE';
  jsonrpc_method: string | null;
  api_key: string | null;
  attribution: string | null;
  source_ip: string | null;
  response_status: number | null;
  is_streamed: boolean;
  has_debug: boolean;
  error_code: string | null;
  error_message: string | null;
}

interface McpDebugLogRecord {
  request_id: string;
  raw_request_headers: string | null;
  raw_request_body: string | null;
  raw_response_headers: string | null;
  raw_response_body: string | null;
  created_at: string;
}

export class McpUsageStorageService {
  private db: ReturnType<typeof getDatabase> | null = null;

  constructor() {}

  private ensureDb() {
    if (!this.db) {
      this.db = getDatabase();
    }
    return this.db;
  }

  private getMcpSchema() {
    const dialect = getCurrentDialect();
    if (dialect === 'sqlite') {
      return sqliteMcp;
    } else {
      return pgMcp;
    }
  }

  async saveRequest(record: McpRequestUsageRecord) {
    try {
      const schema = this.getMcpSchema();
      const mcpRequestUsage = schema.mcpRequestUsage;

      await this.ensureDb().insert(mcpRequestUsage).values({
        requestId: record.request_id,
        createdAt: record.created_at,
        startTime: record.start_time,
        durationMs: record.duration_ms,
        serverName: record.server_name,
        upstreamUrl: record.upstream_url,
        method: record.method,
        jsonrpcMethod: record.jsonrpc_method,
        apiKey: record.api_key,
        attribution: record.attribution,
        sourceIp: record.source_ip,
        responseStatus: record.response_status,
        isStreamed: record.is_streamed ? 1 : 0,
        hasDebug: record.has_debug ? 1 : 0,
        errorCode: record.error_code,
        errorMessage: record.error_message,
      });

      logger.debug(`MCP usage record saved for request ${record.request_id}`);
    } catch (error) {
      logger.error('Failed to save MCP usage record', error);
    }
  }

  async saveDebugLog(record: McpDebugLogRecord) {
    try {
      const schema = this.getMcpSchema();
      const mcpDebugLogs = schema.mcpDebugLogs;

      await this.ensureDb().insert(mcpDebugLogs).values({
        requestId: record.request_id,
        rawRequestHeaders: record.raw_request_headers,
        rawRequestBody: record.raw_request_body,
        rawResponseHeaders: record.raw_response_headers,
        rawResponseBody: record.raw_response_body,
        createdAt: record.created_at,
      });

      logger.debug(`MCP debug log saved for request ${record.request_id}`);
    } catch (error) {
      logger.error('Failed to save MCP debug log', error);
    }
  }
}
