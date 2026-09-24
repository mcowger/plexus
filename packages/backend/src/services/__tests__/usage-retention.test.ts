import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  UsageStorageService,
  getUsageRetentionDays,
  DEFAULT_USAGE_RETENTION_DAYS,
} from '../observability/usage-storage';
import { McpUsageStorageService } from '../mcp-proxy/mcp-usage-storage';
import { QuotaScheduler } from '../quota/quota-scheduler';
import { toDbTimestampMs } from '../../utils/normalize';
import {
  closeDatabase,
  getCurrentDialect,
  getDatabase,
  getSchema,
  initializeDatabase,
} from '../../db/client';
import { runMigrations } from '../../db/migrate';
import * as sqliteMcp from '../../../drizzle/schema/sqlite/mcp';
import * as pgMcp from '../../../drizzle/schema/postgres/mcp';

const DAY_MS = 24 * 60 * 60 * 1000;

function usageRecord(requestId: string, ageDays: number): any {
  const at = Date.now() - ageDays * DAY_MS;
  return {
    requestId,
    date: new Date(at).toISOString(),
    incomingApiType: 'chat',
    startTime: at,
    durationMs: 10,
    isStreamed: false,
    responseStatus: 'success',
    createdAt: at,
  };
}

function mcpRecord(requestId: string, ageDays: number): any {
  const at = Date.now() - ageDays * DAY_MS;
  return {
    request_id: requestId,
    created_at: new Date(at).toISOString(),
    start_time: at,
    duration_ms: 10,
    server_name: 'test-server',
    upstream_url: 'http://localhost:9999',
    method: 'POST',
    jsonrpc_method: 'tools/list',
    tool_name: null,
    api_key: null,
    attribution: null,
    source_ip: null,
    response_status: 200,
    is_streamed: false,
    has_debug: false,
    error_code: null,
    error_message: null,
  };
}

function mcpDebugRecord(requestId: string, ageDays: number): any {
  return {
    request_id: requestId,
    raw_request_headers: null,
    raw_request_body: null,
    raw_response_headers: null,
    raw_response_body: null,
    created_at: new Date(Date.now() - ageDays * DAY_MS).toISOString(),
  };
}

describe('observability retention', () => {
  beforeEach(async () => {
    await closeDatabase();
    process.env.DATABASE_URL = process.env.PLEXUS_TEST_DB_URL ?? process.env.DATABASE_URL;
    delete process.env.PLEXUS_USAGE_RETENTION_DAYS;
    initializeDatabase(process.env.DATABASE_URL);
    await runMigrations();

    const db = getDatabase() as any;
    const schema = getSchema() as any;
    await db.delete(schema.inferenceErrors);
    await db.delete(schema.debugLogs);
    await db.delete(schema.requestUsage);
    await db.delete(schema.meterSnapshots);

    const mcpSchema = getCurrentDialect() === 'sqlite' ? sqliteMcp : pgMcp;
    await db.delete((mcpSchema as any).mcpDebugLogs);
    await db.delete((mcpSchema as any).mcpRequestUsage);
  });

  afterEach(async () => {
    delete process.env.PLEXUS_USAGE_RETENTION_DAYS;
    QuotaScheduler.getInstance().stop();
    await closeDatabase();
  });

  it('defaults retention to 365 days and honors the env override', () => {
    expect(DEFAULT_USAGE_RETENTION_DAYS).toBe(365);
    expect(getUsageRetentionDays()).toBe(365);

    process.env.PLEXUS_USAGE_RETENTION_DAYS = '7';
    expect(getUsageRetentionDays()).toBe(7);

    process.env.PLEXUS_USAGE_RETENTION_DAYS = 'bogus';
    expect(getUsageRetentionDays()).toBe(365);

    process.env.PLEXUS_USAGE_RETENTION_DAYS = '0';
    expect(getUsageRetentionDays()).toBe(365);
  });

  it('prunes usage, debug, and error rows older than the TTL', async () => {
    const storage = new UsageStorageService();
    const db = getDatabase() as any;
    const schema = getSchema() as any;
    const oldAt = Date.now() - 40 * DAY_MS;

    await storage.saveRequest(usageRecord('old-req', 40));
    await storage.saveRequest(usageRecord('fresh-req', 1));
    await storage.saveDebugLog({ requestId: 'old-debug', createdAt: oldAt });
    await storage.saveDebugLog({ requestId: 'fresh-debug', createdAt: Date.now() });
    await db.insert(schema.inferenceErrors).values({
      requestId: 'old-error',
      date: new Date(oldAt).toISOString(),
      errorMessage: 'old',
      createdAt: oldAt,
    });
    await db.insert(schema.inferenceErrors).values({
      requestId: 'fresh-error',
      date: new Date().toISOString(),
      errorMessage: 'fresh',
      createdAt: Date.now(),
    });

    const result = await storage.cleanupOldRecords(30);

    expect(result).toEqual({ deletedUsage: 1, deletedDebugLogs: 1, deletedErrors: 1 });
    expect(await storage.getDebugLog('old-debug')).toBeNull();
    expect(await storage.getDebugLog('fresh-debug')).not.toBeNull();

    const remainingUsage = await db.select().from(schema.requestUsage);
    expect(remainingUsage.map((r: any) => r.requestId)).toEqual(['fresh-req']);

    const remainingErrors = await db.select().from(schema.inferenceErrors);
    expect(remainingErrors.map((r: any) => r.requestId)).toEqual(['fresh-error']);
  });

  it('keeps everything when all rows are within the TTL', async () => {
    const storage = new UsageStorageService();
    await storage.saveRequest(usageRecord('fresh-req', 1));
    await storage.saveDebugLog({ requestId: 'fresh-debug', createdAt: Date.now() });

    const result = await storage.cleanupOldRecords(30);

    expect(result).toEqual({ deletedUsage: 0, deletedDebugLogs: 0, deletedErrors: 0 });
    expect(await storage.getDebugLog('fresh-debug')).not.toBeNull();
  });

  it('prunes MCP logs and debug logs older than the TTL', async () => {
    const mcpStorage = new McpUsageStorageService();
    await mcpStorage.saveRequest(mcpRecord('old-mcp', 40));
    await mcpStorage.saveRequest(mcpRecord('fresh-mcp', 1));
    await mcpStorage.saveDebugLog(mcpDebugRecord('old-mcp-debug', 40));
    await mcpStorage.saveDebugLog(mcpDebugRecord('fresh-mcp-debug', 1));

    const result = await mcpStorage.cleanupOldLogs(30);

    expect(result).toEqual({ deletedLogs: 1, deletedDebugLogs: 1 });

    const { data } = await mcpStorage.getLogs({ limit: 10 });
    expect(data.map((r) => r.request_id)).toEqual(['fresh-mcp']);
  });

  it('prunes meter snapshots older than the TTL', async () => {
    const scheduler = QuotaScheduler.getInstance();
    const db = getDatabase() as any;
    const schema = getSchema() as any;
    const dialect = getCurrentDialect();

    const snapshot = (id: string, ageDays: number) => ({
      checkerId: 'retention-checker',
      checkerType: 'test',
      provider: 'test-provider',
      meterKey: id,
      kind: 'allowance',
      unit: '',
      label: id,
      utilizationState: 'reported',
      utilizationPercent: 10,
      status: 'ok',
      checkedAt: toDbTimestampMs(Date.now() - ageDays * DAY_MS, dialect),
      createdAt: toDbTimestampMs(Date.now() - ageDays * DAY_MS, dialect),
    });

    await db.insert(schema.meterSnapshots).values(snapshot('old-meter', 40));
    await db.insert(schema.meterSnapshots).values(snapshot('fresh-meter', 1));

    const result = await scheduler.cleanupOldSnapshots(30);

    expect(result).toEqual({ deletedSnapshots: 1 });
    const remaining = await db.select().from(schema.meterSnapshots);
    expect(remaining.map((r: any) => r.meterKey)).toEqual(['fresh-meter']);
  });

  it('starts and stops the cleanup jobs without error', async () => {
    const scheduler = QuotaScheduler.getInstance();
    scheduler.startRetentionJob(24, 30);
    // Second start is a no-op with a warning, not a second timer.
    scheduler.startRetentionJob(24, 30);
    scheduler.stopRetentionJob();

    const storage = new UsageStorageService();
    const mcpStorage = new McpUsageStorageService();

    storage.startCleanupJob(24, 30);
    mcpStorage.startCleanupJob(24, 30);
    // Second start is a no-op with a warning, not a second timer.
    storage.startCleanupJob(24, 30);

    storage.stopCleanupJob();
    mcpStorage.stopCleanupJob();
  });
});
