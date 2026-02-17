import { logger } from '../../utils/logger';
import { getDatabase, getCurrentDialect } from '../../db/client';
import * as sqliteMcp from '../../../drizzle/schema/sqlite/mcp';
import * as pgMcp from '../../../drizzle/schema/postgres/mcp';
import { desc, eq, sql, and, like } from 'drizzle-orm';
import { toDbTimestamp } from '../../utils/normalize';

interface McpRequestUsageRecord {
  request_id: string;
  created_at: string;
  start_time: number;
  duration_ms: number | null;
  server_name: string;
  upstream_url: string;
  method: 'POST' | 'GET' | 'DELETE';
  jsonrpc_method: string | null;
  tool_name: string | null;
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
      const createdAt = toDbTimestamp(record.created_at, getCurrentDialect()) as string & Date;

      await this.ensureDb().insert(mcpRequestUsage).values({
        requestId: record.request_id,
        createdAt,
        startTime: record.start_time,
        durationMs: record.duration_ms,
        serverName: record.server_name,
        upstreamUrl: record.upstream_url,
        method: record.method,
        jsonrpcMethod: record.jsonrpc_method,
        toolName: record.tool_name,
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
      const createdAt = toDbTimestamp(record.created_at, getCurrentDialect()) as string & Date;

      await this.ensureDb().insert(mcpDebugLogs).values({
        requestId: record.request_id,
        rawRequestHeaders: record.raw_request_headers,
        rawRequestBody: record.raw_request_body,
        rawResponseHeaders: record.raw_response_headers,
        rawResponseBody: record.raw_response_body,
        createdAt,
      });

      logger.debug(`MCP debug log saved for request ${record.request_id}`);
    } catch (error) {
      logger.error('Failed to save MCP debug log', error);
    }
  }

  async getLogs(options: {
    limit?: number;
    offset?: number;
    serverName?: string;
    apiKey?: string;
  } = {}): Promise<{ data: McpRequestUsageRecord[]; total: number }> {
    try {
      const schema = this.getMcpSchema();
      const table = schema.mcpRequestUsage;
      const db = this.ensureDb();
      const limit = options.limit ?? 20;
      const offset = options.offset ?? 0;

      const conditions = [];
      if (options.serverName) {
        conditions.push(like(table.serverName, `%${options.serverName}%`));
      }
      if (options.apiKey) {
        conditions.push(like(table.apiKey, `%${options.apiKey}%`));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [rows, countRows] = await Promise.all([
        db.select().from(table)
          .where(whereClause)
          .orderBy(desc(table.startTime))
          .limit(limit)
          .offset(offset),
        db.select({ count: sql<number>`COUNT(*)` }).from(table).where(whereClause),
      ]);

      const total = Number(countRows[0]?.count ?? 0);

      const data: McpRequestUsageRecord[] = rows.map((r: any) => ({
        request_id: r.requestId,
        created_at: r.createdAt,
        start_time: r.startTime,
        duration_ms: r.durationMs,
        server_name: r.serverName,
        upstream_url: r.upstreamUrl,
        method: r.method,
        jsonrpc_method: r.jsonrpcMethod,
        tool_name: r.toolName ?? null,
        api_key: r.apiKey,
        attribution: r.attribution,
        source_ip: r.sourceIp,
        response_status: r.responseStatus,
        is_streamed: Boolean(r.isStreamed),
        has_debug: Boolean(r.hasDebug),
        error_code: r.errorCode,
        error_message: r.errorMessage,
      }));

      return { data, total };
    } catch (error) {
      logger.error('Failed to get MCP logs', error);
      return { data: [], total: 0 };
    }
  }

  async deleteLog(requestId: string): Promise<boolean> {
    try {
      const schema = this.getMcpSchema();
      const table = schema.mcpRequestUsage;
      const result = await this.ensureDb()
        .delete(table)
        .where(eq(table.requestId, requestId));
      return true;
    } catch (error) {
      logger.error('Failed to delete MCP log', error);
      return false;
    }
  }

  async deleteAllLogs(beforeDate?: Date): Promise<boolean> {
    try {
      const schema = this.getMcpSchema();
      const table = schema.mcpRequestUsage;
      const db = this.ensureDb();

      if (beforeDate) {
        const beforeMs = beforeDate.getTime();
        await db.delete(table).where(sql`${table.startTime} < ${beforeMs}`);
      } else {
        await db.delete(table);
      }
      return true;
    } catch (error) {
      logger.error('Failed to delete MCP logs', error);
      return false;
    }
  }
}
