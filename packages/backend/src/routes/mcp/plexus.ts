import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { getConfig, type PlexusConfig } from '../../config';
import { logger } from '../../utils/logger';
import { ConfigService } from '../../services/config-service';
import { UsageStorageService } from '../../services/usage-storage';
import { getCurrentDialect, getSchema } from '../../db/client';
import { DebugManager } from '../../services/debug-manager';
import { BackupService } from '../../services/backup-service';
import { CooldownManager } from '../../services/cooldown-manager';
import { ManagementAuthError, authenticate, requireAdmin } from '../management/_principal';

const PLEXUS_MANAGEMENT_PROMPT = `Plexus is a unified API gateway for LLMs. It exposes OpenAI- and Anthropic-compatible endpoints, routes requests to configured providers, records usage, and manages provider, model alias, key, quota, debug, and MCP gateway configuration.

Use /mcp/plexus for admin-only Plexus management. All requests require x-admin-key. Do not use bearer inference keys for this endpoint.

The tools are compact domain tools. Prefer inspection before mutation: list or get the current state, explain the intended change, then call the relevant tool with operation, id, category, query, and body.

Destructive or high-impact operations require destructive: "acknowledged". Secrets are redacted by default. Only request redact: false when you have specific authorization and the operation explicitly supports unredacted output.

Common workflows:
- Review request activity with plexus_usage list or summary.
- Inspect provider setup with plexus_provider list or get.
- Inspect model routing with plexus_model_alias list or get.
- Inspect inference keys with plexus_key list or get; normal responses redact secrets.
- Check upstream quota state with plexus_quota_checker types, list, or get.
- Inspect user quota definitions with plexus_quota list or get.
- Review MCP gateway configuration with plexus_mcp_gateway servers_list.
- Inspect general settings with plexus_settings get and a category.
- Use plexus_debug state before enabling debug tracing.
- Use plexus_operations backup, restore, list_cooldowns, or clear_cooldowns for operational actions.

Best practices:
- Keep changes narrow and reversible.
- Avoid broad overwrite operations unless necessary.
- Never expose provider API keys, inference key secrets, cookies, sessions, or OAuth tokens in chat unless specifically authorized.
- Include enough context in body payloads for future auditability.`;

const TOOL_NAMES = [
  'plexus_config',
  'plexus_provider',
  'plexus_model_alias',
  'plexus_key',
  'plexus_quota',
  'plexus_quota_checker',
  'plexus_usage',
  'plexus_debug',
  'plexus_mcp_gateway',
  'plexus_settings',
  'plexus_operations',
] as const;

const DESTRUCTIVE_OPERATIONS = new Set([
  'delete',
  'delete_all',
  'clear',
  'clear_for_key',
  'quota_clear',
  'delete_log',
  'delete_all_logs',
  'restore',
  'restart',
  'rotate',
  'truncate',
  'import',
  'overwrite',
]);

const ToolInputSchema = {
  operation: z
    .string()
    .min(1)
    .describe('Operation to perform, such as list, get, status, or summary.'),
  id: z
    .string()
    .optional()
    .describe('Optional resource identifier for get/update/delete operations.'),
  category: z.string().optional().describe('Optional settings or subdomain category.'),
  query: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Optional filters, pagination, or sort options.'),
  body: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Optional payload for mutating operations.'),
  destructive: z
    .string()
    .optional()
    .describe('Must be exactly "acknowledged" for destructive or high-impact operations.'),
  redact: z
    .boolean()
    .optional()
    .describe('Defaults to true. redact: false is only honored by explicitly authorized handlers.'),
};

type ToolInput = {
  operation: string;
  id?: string;
  category?: string;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  destructive?: string;
  redact?: boolean;
};

type ToolResponse = {
  ok: boolean;
  operation: string;
  data?: unknown;
  error?: {
    message: string;
    type: string;
    code: number;
  };
};

class McpToolError extends Error {
  type: string;
  code: number;

  constructor(message: string, type: string, code: number) {
    super(message);
    this.type = type;
    this.code = code;
  }
}

export async function registerPlexusMcpRoutes(
  fastify: FastifyInstance,
  usageStorage?: UsageStorageService
) {
  fastify.register(async (plexusMcp) => {
    plexusMcp.setErrorHandler(async (error, _request, reply) => {
      if (error instanceof ManagementAuthError) {
        return reply.code(error.statusCode).send(error.authBody);
      }
      throw error;
    });

    // Reject early when the admin MCP is disabled (before auth, to avoid leaking key validity)
    plexusMcp.addHook('preHandler', async (_request, reply) => {
      try {
        const configService = ConfigService.getInstance();
        const mcpEnabled = await configService.getSetting<boolean>('mcpEnabled', true);
        if (!mcpEnabled) {
          return reply.code(418).send({
            error: {
              message: 'Plexus Management MCP is disabled. Enable it on the MCP Servers page.',
              type: 'mcp_disabled',
            },
          });
        }
      } catch {
        // ConfigService not initialized — default to enabled
      }
    });

    plexusMcp.addHook('preHandler', authenticate);
    plexusMcp.addHook('preHandler', requireAdmin);

    plexusMcp.post('/mcp/plexus', (request, reply) =>
      handlePlexusMcpRequest(request, reply, usageStorage)
    );
    plexusMcp.get('/mcp/plexus', (request, reply) =>
      handlePlexusMcpRequest(request, reply, usageStorage)
    );
    plexusMcp.delete('/mcp/plexus', (request, reply) =>
      handlePlexusMcpRequest(request, reply, usageStorage)
    );
  });
}

async function handlePlexusMcpRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  usageStorage?: UsageStorageService
) {
  // The SDK server owns one active transport at a time. A singleton would need
  // close/reconnect queueing, so stateless per-request servers are simpler and safer.
  const server = createPlexusMcpServer(usageStorage);
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);

  try {
    const webRequest = toWebRequest(request);
    const webResponse = await transport.handleRequest(webRequest, { parsedBody: request.body });

    for (const [key, value] of webResponse.headers.entries()) {
      reply.header(key, value);
    }

    const body = await webResponse.text();
    return reply.code(webResponse.status).send(body || undefined);
  } finally {
    await server.close();
  }
}

function createPlexusMcpServer(usageStorage?: UsageStorageService) {
  const server = new McpServer(
    {
      name: 'plexus-management',
      version: '0.1.0',
    },
    {
      instructions: PLEXUS_MANAGEMENT_PROMPT,
    }
  );

  server.registerResource(
    'plexus_management_guide',
    'plexus://management/guide',
    {
      title: 'Plexus Management Guide',
      description: 'How to safely interact with Plexus through the management MCP server.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: PLEXUS_MANAGEMENT_PROMPT,
        },
      ],
    })
  );

  server.registerPrompt(
    'plexus_management_guide',
    {
      title: 'Plexus Management Guide',
      description: 'Best practices and examples for managing Plexus through MCP.',
    },
    async () => ({
      description: 'Use this guide before making Plexus management changes.',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: PLEXUS_MANAGEMENT_PROMPT,
          },
        },
      ],
    })
  );

  for (const toolName of TOOL_NAMES) {
    server.registerTool(
      toolName,
      {
        title: toolName,
        description: getToolDescription(toolName),
        inputSchema: ToolInputSchema,
      },
      async (input) =>
        toToolResult(await handleToolCall(toolName, input as ToolInput, usageStorage))
    );
  }

  return server;
}

async function handleToolCall(
  toolName: (typeof TOOL_NAMES)[number],
  input: ToolInput,
  usageStorage?: UsageStorageService
) {
  try {
    if (DESTRUCTIVE_OPERATIONS.has(input.operation)) {
      requireDestructiveAck(input);
    }

    const config = getConfig();

    switch (toolName) {
      case 'plexus_config':
        return handleConfigTool(input, config);
      case 'plexus_provider':
        return handleRecordTool(input, config.providers ?? {}, 'provider');
      case 'plexus_model_alias':
        return handleRecordTool(input, config.models ?? {}, 'model_alias');
      case 'plexus_key':
        return handleRecordTool(input, config.keys ?? {}, 'key');
      case 'plexus_quota':
        return handleRecordTool(input, config.user_quotas ?? {}, 'quota');
      case 'plexus_quota_checker':
        return handleQuotaCheckerTool(input, config);
      case 'plexus_mcp_gateway':
        return handleMcpGatewayTool(input, config);
      case 'plexus_settings':
        return handleSettingsTool(input, config);
      case 'plexus_usage':
        return handleUsageTool(input, usageStorage);
      case 'plexus_debug':
        return handleDebugTool(input, usageStorage);
      case 'plexus_operations':
        return handleOperationsTool(input, usageStorage);
    }
  } catch (error) {
    if (error instanceof McpToolError) {
      return errorResponse(input.operation, error.message, error.type, error.code);
    }
    logger.warn(`Plexus MCP tool ${toolName} failed: ${(error as Error).message}`);
    return errorResponse(input.operation, 'Plexus MCP tool call failed.', 'internal_error', 500);
  }
}

async function handleUsageTool(
  input: ToolInput,
  usageStorage?: UsageStorageService
): Promise<ToolResponse> {
  if (!usageStorage) {
    throw new McpToolError('Usage storage service is not available.', 'internal_error', 500);
  }

  switch (input.operation) {
    case 'list': {
      const query = input.query ?? {};
      const limit = parsePositiveInt(query.limit, 50);
      const offset = parsePositiveInt(query.offset, 0);
      const sortBy = asOptionalString(query.sortBy) as
        | 'date'
        | 'apiKey'
        | 'provider'
        | 'incomingModelAlias'
        | 'costTotal'
        | 'durationMs'
        | undefined;
      const sortDir = asOptionalString(query.sortDir) === 'asc' ? 'asc' : 'desc';
      const result = await usageStorage.getUsage(
        {
          startDate: asOptionalString(query.startDate),
          endDate: asOptionalString(query.endDate),
          apiKey: asOptionalString(query.apiKey),
          apiKeyMatch: asOptionalString(query.apiKeyMatch) === 'exact' ? 'exact' : 'like',
          incomingApiType: asOptionalString(query.incomingApiType),
          provider: asOptionalString(query.provider),
          incomingModelAlias: asOptionalString(query.incomingModelAlias),
          selectedModelName: asOptionalString(query.selectedModelName),
          outgoingApiType: asOptionalString(query.outgoingApiType),
          minDurationMs: parseOptionalInt(query.minDurationMs),
          maxDurationMs: parseOptionalInt(query.maxDurationMs),
          responseStatus: asOptionalString(query.responseStatus),
        },
        { limit, offset, sortBy, sortDir }
      );
      return successResponse(input.operation, result);
    }
    case 'summary':
      return successResponse(
        input.operation,
        await getUsageSummary(usageStorage, input.query ?? {})
      );
    case 'delete': {
      if (!input.id) {
        throw new McpToolError('Missing id for usage delete operation.', 'invalid_request', 400);
      }
      const success = await usageStorage.deleteUsageLog(input.id);
      if (!success) {
        throw new McpToolError('Usage log not found or could not be deleted', 'not_found', 404);
      }
      return successResponse(input.operation, { success: true, requestId: input.id });
    }
    case 'delete_all': {
      const olderThanDays = parseOptionalInt(input.query?.olderThanDays);
      let beforeDate: Date | undefined;
      if (olderThanDays !== undefined) {
        beforeDate = new Date();
        beforeDate.setDate(beforeDate.getDate() - olderThanDays);
      }
      const success = await usageStorage.deleteAllUsageLogs(beforeDate);
      if (!success) {
        throw new McpToolError('Failed to delete usage logs', 'internal_error', 500);
      }
      return successResponse(input.operation, {
        success: true,
        olderThanDays: olderThanDays ?? null,
      });
    }
    default:
      throw unsupportedOperation(input.operation, ['list', 'summary', 'delete', 'delete_all']);
  }
}

async function handleDebugTool(
  input: ToolInput,
  usageStorage?: UsageStorageService
): Promise<ToolResponse> {
  if (!usageStorage) {
    throw new McpToolError('Usage storage service is not available.', 'internal_error', 500);
  }

  const debugManager = DebugManager.getInstance();

  switch (input.operation) {
    case 'state':
      return successResponse(input.operation, {
        enabled: debugManager.isEnabled(),
        enabledGlobal: debugManager.isEnabled(),
        enabledKeys: debugManager.getEnabledKeys(),
        providers: debugManager.getProviderFilter(),
      });
    case 'update': {
      const body = input.body ?? {};
      if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
        throw new McpToolError('body.enabled must be a boolean.', 'invalid_request', 400);
      }
      if (
        body.providers !== undefined &&
        body.providers !== null &&
        (!Array.isArray(body.providers) || body.providers.some((v) => typeof v !== 'string'))
      ) {
        throw new McpToolError(
          'body.providers must be null or an array of strings.',
          'invalid_request',
          400
        );
      }
      if (typeof body.enabled === 'boolean') {
        debugManager.setEnabled(body.enabled);
      }
      if (body.providers !== undefined) {
        debugManager.setProviderFilter((body.providers as string[] | null) ?? null);
      }
      return successResponse(input.operation, {
        enabled: debugManager.isEnabled(),
        enabledGlobal: debugManager.isEnabled(),
        enabledKeys: debugManager.getEnabledKeys(),
        providers: debugManager.getProviderFilter(),
      });
    }
    case 'logs': {
      const query = input.query ?? {};
      const limit = parsePositiveInt(query.limit, 50);
      const offset = parsePositiveInt(query.offset, 0);
      const logs = await usageStorage.getDebugLogs(limit, offset);
      return successResponse(input.operation, logs);
    }
    case 'get_log': {
      if (!input.id) {
        throw new McpToolError('Missing id for debug get_log operation.', 'invalid_request', 400);
      }
      const log = await usageStorage.getDebugLog(input.id);
      if (!log) {
        throw new McpToolError('Log not found', 'not_found', 404);
      }
      return successResponse(input.operation, log);
    }
    case 'delete_log': {
      if (!input.id) {
        throw new McpToolError(
          'Missing id for debug delete_log operation.',
          'invalid_request',
          400
        );
      }
      const success = await usageStorage.deleteDebugLog(input.id);
      if (!success) {
        throw new McpToolError('Log not found or could not be deleted', 'not_found', 404);
      }
      return successResponse(input.operation, { success: true, requestId: input.id });
    }
    case 'delete_all_logs': {
      const success = await usageStorage.deleteAllDebugLogs();
      if (!success) {
        throw new McpToolError('Failed to delete logs', 'internal_error', 500);
      }
      return successResponse(input.operation, { success: true });
    }
    default:
      throw unsupportedOperation(input.operation, [
        'state',
        'update',
        'logs',
        'get_log',
        'delete_log',
        'delete_all_logs',
      ]);
  }
}

async function handleOperationsTool(
  input: ToolInput,
  usageStorage?: UsageStorageService
): Promise<ToolResponse> {
  switch (input.operation) {
    case 'backup': {
      const backupService = new BackupService();
      const full = input.query?.full === true || asOptionalString(input.query?.full) === 'true';
      if (full) {
        const archive = await backupService.exportFullBackup();
        return successResponse(input.operation, {
          full: true,
          bytes: archive.byteLength,
          contentType: 'application/gzip',
          encoding: 'base64',
          archive: archive.toString('base64'),
        });
      }
      return successResponse(input.operation, {
        full: false,
        backup: await backupService.exportConfigBackup(),
      });
    }
    case 'restore': {
      const backupService = new BackupService();
      const body = input.body ?? {};
      if (body.full === true || typeof body.archive === 'string') {
        if (typeof body.archive !== 'string') {
          throw new McpToolError(
            'body.archive must be a base64 string for full restore.',
            'invalid_request',
            400
          );
        }
        const result = await backupService.restoreFullBackup(Buffer.from(body.archive, 'base64'));
        return successResponse(input.operation, result);
      }
      if (!body.plexus_backup) {
        throw new McpToolError(
          'Invalid backup: missing plexus_backup field',
          'invalid_request',
          400
        );
      }
      return successResponse(input.operation, await backupService.restoreFullBackup(body));
    }
    case 'restart':
      return successResponse(input.operation, {
        success: true,
        message:
          'Restart is supported through the HTTP management API but is intentionally disabled from MCP to avoid dropping the current MCP session.',
        supported: false,
      });
    case 'list_cooldowns':
      return successResponse(input.operation, CooldownManager.getInstance().getCooldowns());
    case 'clear_cooldowns': {
      const provider = input.id ?? asOptionalString(input.query?.provider);
      const model = asOptionalString(input.query?.model);
      await CooldownManager.getInstance().clearCooldown(provider, model);
      return successResponse(input.operation, {
        success: true,
        provider: provider ?? null,
        model: model ?? null,
      });
    }
    case 'reset_logs': {
      if (!usageStorage) {
        throw new McpToolError('Usage storage service is not available.', 'internal_error', 500);
      }
      const [successUsage, successErrors, successDebug] = await Promise.all([
        usageStorage.deleteAllUsageLogs(),
        usageStorage.deleteAllErrors(),
        usageStorage.deleteAllDebugLogs(),
      ]);
      if (!successUsage || !successErrors || !successDebug) {
        throw new McpToolError('Failed to reset some logs', 'internal_error', 500);
      }
      return successResponse(input.operation, {
        success: true,
        message: 'All logs have been reset successfully',
      });
    }
    default:
      throw unsupportedOperation(input.operation, [
        'backup',
        'restore',
        'restart',
        'list_cooldowns',
        'clear_cooldowns',
        'reset_logs',
      ]);
  }
}

async function getUsageSummary(usageStorage: UsageStorageService, query: Record<string, unknown>) {
  const range = asOptionalString(query.range) ?? 'day';
  const startDateStr = asOptionalString(query.startDate);
  const endDateStr = asOptionalString(query.endDate);

  if (range === 'custom') {
    if (!startDateStr || !endDateStr) {
      throw new McpToolError(
        'startDate and endDate are required for custom range',
        'invalid_request',
        400
      );
    }
    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new McpToolError('Invalid date format', 'invalid_request', 400);
    }
    if (endDate < startDate) {
      throw new McpToolError('endDate must be after startDate', 'invalid_request', 400);
    }
  } else if (!['hour', 'day', 'week', 'month'].includes(range)) {
    throw new McpToolError('Invalid range', 'invalid_request', 400);
  }

  const now = new Date();
  now.setSeconds(0, 0);
  let rangeStart = new Date(now);
  let rangeEnd = new Date(now);

  if (range === 'custom' && startDateStr && endDateStr) {
    rangeStart = new Date(startDateStr);
    rangeEnd = new Date(endDateStr);
  } else {
    switch (range as 'hour' | 'day' | 'week' | 'month') {
      case 'hour':
        rangeStart.setHours(rangeStart.getHours() - 1);
        break;
      case 'day':
        rangeStart.setHours(rangeStart.getHours() - 24);
        break;
      case 'week':
        rangeStart.setDate(rangeStart.getDate() - 7);
        break;
      case 'month':
        rangeStart.setDate(rangeStart.getDate() - 30);
        break;
    }
  }

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const statsStart = new Date(now);
  statsStart.setDate(statsStart.getDate() - 7);

  let stepSeconds = 60;
  if (range === 'custom') {
    const durationMs = rangeEnd.getTime() - rangeStart.getTime();
    const durationMinutes = durationMs / (1000 * 60);
    const durationSeconds = durationMs / 1000;

    if (durationMinutes <= 30) stepSeconds = 60;
    else if (durationMinutes <= 24 * 60) stepSeconds = 300;
    else if (durationMinutes <= 7 * 24 * 60) stepSeconds = 3600;
    else stepSeconds = 21600;

    const maxBuckets = 100;
    const calculatedBuckets = Math.ceil(durationSeconds / stepSeconds);
    if (calculatedBuckets > maxBuckets) {
      stepSeconds = Math.ceil(durationSeconds / maxBuckets);
    }
  } else {
    switch (range) {
      case 'hour':
        stepSeconds = 60;
        break;
      case 'day':
        stepSeconds = 3600;
        break;
      case 'week':
      case 'month':
        stepSeconds = 86400;
        break;
    }
  }

  const db = usageStorage.getDb();
  const schema = getSchema();
  const dialect = getCurrentDialect();
  const stepMs = stepSeconds * 1000;
  const nowMs = now.getTime();
  const rangeStartMs = rangeStart.getTime();
  const rangeEndMs = rangeEnd.getTime();
  const statsStartMs = statsStart.getTime();
  const todayStartMs = todayStart.getTime();
  const stepMsLiteral = sql.raw(String(stepMs));
  const bucketStartMs =
    dialect === 'sqlite'
      ? sql<number>`CAST((CAST(${schema.requestUsage.startTime} AS INTEGER) / ${stepMsLiteral}) * ${stepMsLiteral} AS INTEGER)`
      : sql<number>`FLOOR(${schema.requestUsage.startTime}::double precision / ${stepMsLiteral}) * ${stepMsLiteral}`;

  const apiKey = asOptionalString(query.apiKey);
  const keyFilter = apiKey ? eq(schema.requestUsage.apiKey, apiKey) : undefined;

  const toNumber = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));

  const seriesRows = await db
    .select({
      bucketStartMs,
      requests: sql<number>`COUNT(*)`,
      inputTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensInput}), 0)`,
      outputTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensOutput}), 0)`,
      cachedTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCached}), 0)`,
      cacheWriteTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCacheWrite}), 0)`,
      kwhUsed: sql<number>`COALESCE(SUM(${schema.requestUsage.kwhUsed}), 0)`,
    })
    .from(schema.requestUsage)
    .where(
      and(
        gte(schema.requestUsage.startTime, rangeStartMs),
        lte(schema.requestUsage.startTime, rangeEndMs),
        ...(keyFilter ? [keyFilter] : [])
      )
    )
    .groupBy(bucketStartMs)
    .orderBy(bucketStartMs);

  const statsRows = await db
    .select({
      requests: sql<number>`COUNT(*)`,
      inputTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensInput}), 0)`,
      outputTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensOutput}), 0)`,
      cachedTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCached}), 0)`,
      cacheWriteTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCacheWrite}), 0)`,
      kwhUsed: sql<number>`COALESCE(SUM(${schema.requestUsage.kwhUsed}), 0)`,
      avgDurationMs: sql<number>`COALESCE(AVG(${schema.requestUsage.durationMs}), 0)`,
      totalDurationMs: sql<number>`COALESCE(SUM(${schema.requestUsage.durationMs}), 0)`,
    })
    .from(schema.requestUsage)
    .where(
      and(
        gte(schema.requestUsage.startTime, statsStartMs),
        lte(schema.requestUsage.startTime, nowMs),
        ...(keyFilter ? [keyFilter] : []),
        gte(schema.requestUsage.startTime, rangeStartMs),
        lte(schema.requestUsage.startTime, rangeEndMs)
      )
    );

  const todayRows = await db
    .select({
      requests: sql<number>`COUNT(*)`,
      inputTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensInput}), 0)`,
      outputTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensOutput}), 0)`,
      reasoningTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensReasoning}), 0)`,
      cachedTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCached}), 0)`,
      cacheWriteTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCacheWrite}), 0)`,
      kwhUsed: sql<number>`COALESCE(SUM(${schema.requestUsage.kwhUsed}), 0)`,
      totalCost: sql<number>`COALESCE(SUM(${schema.requestUsage.costTotal}), 0)`,
    })
    .from(schema.requestUsage)
    .where(
      and(
        gte(schema.requestUsage.startTime, todayStartMs),
        lte(schema.requestUsage.startTime, nowMs),
        ...(keyFilter ? [keyFilter] : [])
      )
    );

  const statsRow = statsRows[0] || {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    kwhUsed: 0,
    avgDurationMs: 0,
    totalDurationMs: 0,
  };

  const todayRow = todayRows[0] || {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    kwhUsed: 0,
    totalCost: 0,
  };

  return {
    range,
    series: seriesRows.map((row: any) => ({
      bucketStartMs: toNumber(row.bucketStartMs),
      requests: toNumber(row.requests),
      inputTokens: toNumber(row.inputTokens),
      outputTokens: toNumber(row.outputTokens),
      cachedTokens: toNumber(row.cachedTokens),
      cacheWriteTokens: toNumber(row.cacheWriteTokens),
      kwhUsed: toNumber(row.kwhUsed),
      tokens:
        toNumber(row.inputTokens) +
        toNumber(row.outputTokens) +
        toNumber(row.cachedTokens) +
        toNumber(row.cacheWriteTokens),
    })),
    stats: {
      totalRequests: toNumber(statsRow.requests),
      totalTokens:
        toNumber(statsRow.inputTokens) +
        toNumber(statsRow.outputTokens) +
        toNumber(statsRow.cachedTokens) +
        toNumber(statsRow.cacheWriteTokens),
      totalKwhUsed: toNumber(statsRow.kwhUsed),
      avgDurationMs: toNumber(statsRow.avgDurationMs),
      totalDurationMs: toNumber(statsRow.totalDurationMs),
    },
    today: {
      requests: toNumber(todayRow.requests),
      inputTokens: toNumber(todayRow.inputTokens),
      outputTokens: toNumber(todayRow.outputTokens),
      reasoningTokens: toNumber(todayRow.reasoningTokens),
      cachedTokens: toNumber(todayRow.cachedTokens),
      cacheWriteTokens: toNumber(todayRow.cacheWriteTokens),
      kwhUsed: toNumber(todayRow.kwhUsed),
      totalCost: toNumber(todayRow.totalCost),
    },
  };
}

function parsePositiveInt(value: unknown, defaultValue: number): number {
  const parsed = parseOptionalInt(value);
  return parsed === undefined || Number.isNaN(parsed) ? defaultValue : parsed;
}

function parseOptionalInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : parseInt(String(value), 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function handleConfigTool(input: ToolInput, config: PlexusConfig): ToolResponse {
  switch (input.operation) {
    case 'get':
    case 'export':
      return successResponse(input.operation, redactSecrets(config));
    case 'status':
      return successResponse(input.operation, {
        providerCount: Object.keys(config.providers ?? {}).length,
        modelAliasCount: Object.keys(config.models ?? {}).length,
        keyCount: Object.keys(config.keys ?? {}).length,
        quotaCount: Object.keys(config.user_quotas ?? {}).length,
        mcpServerCount: Object.keys(getMcpServers(config)).length,
      });
    default:
      throw unsupportedOperation(input.operation, ['get', 'export', 'status']);
  }
}

function handleRecordTool(
  input: ToolInput,
  records: Record<string, unknown>,
  resourceType: string
): ToolResponse {
  switch (input.operation) {
    case 'list':
      return successResponse(
        input.operation,
        Object.entries(records).map(([id, value]) => ({ id, ...asObject(redactSecrets(value)) }))
      );
    case 'get': {
      if (!input.id) {
        throw new McpToolError(
          `Missing id for ${resourceType} get operation.`,
          'invalid_request',
          400
        );
      }
      if (!(input.id in records)) {
        throw new McpToolError(`${resourceType} '${input.id}' was not found.`, 'not_found', 404);
      }
      return successResponse(input.operation, {
        id: input.id,
        ...asObject(redactSecrets(records[input.id])),
      });
    }
    default:
      throw unsupportedOperation(input.operation, ['list', 'get']);
  }
}

function handleQuotaCheckerTool(input: ToolInput, config: PlexusConfig): ToolResponse {
  const checkers: Record<string, unknown>[] = Object.entries(config.providers ?? {}).flatMap(
    ([providerId, provider]) => {
      const quotaChecker = provider.quota_checker;
      if (!quotaChecker) return [];
      return [
        {
          id: quotaChecker.id ?? `${providerId}:${quotaChecker.type}`,
          provider: providerId,
          ...asObject(redactSecrets(quotaChecker)),
        },
      ];
    }
  );

  switch (input.operation) {
    case 'list':
      return successResponse(input.operation, checkers);
    case 'get': {
      if (!input.id) {
        throw new McpToolError(
          'Missing id for quota checker get operation.',
          'invalid_request',
          400
        );
      }
      const checker = checkers.find((candidate) => candidate.id === input.id);
      if (!checker) {
        throw new McpToolError(`quota_checker '${input.id}' was not found.`, 'not_found', 404);
      }
      return successResponse(input.operation, checker);
    }
    case 'types':
      return successResponse(input.operation, [
        ...new Set(
          checkers.map((checker) => checker.type).filter((type) => typeof type === 'string')
        ),
      ]);
    default:
      throw unsupportedOperation(input.operation, ['types', 'list', 'get']);
  }
}

function handleMcpGatewayTool(input: ToolInput, config: PlexusConfig): ToolResponse {
  const servers = getMcpServers(config);

  switch (input.operation) {
    case 'servers_list':
    case 'list':
      return successResponse(
        input.operation,
        Object.entries(servers).map(([id, value]) => ({ id, ...asObject(redactSecrets(value)) }))
      );
    case 'get': {
      if (!input.id) {
        throw new McpToolError('Missing id for MCP gateway get operation.', 'invalid_request', 400);
      }
      if (!(input.id in servers)) {
        throw new McpToolError(`mcp_gateway server '${input.id}' was not found.`, 'not_found', 404);
      }
      return successResponse(input.operation, {
        id: input.id,
        ...asObject(redactSecrets(servers[input.id])),
      });
    }
    default:
      throw unsupportedOperation(input.operation, ['servers_list', 'list', 'get']);
  }
}

function handleSettingsTool(input: ToolInput, config: PlexusConfig): ToolResponse {
  if (input.operation !== 'get') {
    throw unsupportedOperation(input.operation, ['get']);
  }

  const settings = {
    failover: config.failover,
    cooldown: config.cooldown,
    timeout: config.timeout,
    stall: config.stall,
    trusted_proxies: config.trustedProxies,
    vision_fallthrough: config.vision_fallthrough,
    background_exploration: config.backgroundExploration,
    exploration: {
      performanceExplorationRate: config.performanceExplorationRate,
      latencyExplorationRate: config.latencyExplorationRate,
      e2ePerformanceExplorationRate: config.e2ePerformanceExplorationRate,
    },
  };

  if (!input.category || input.category === 'all') {
    return successResponse(input.operation, redactSecrets(settings));
  }

  if (!(input.category in settings)) {
    throw new McpToolError(
      `settings category '${input.category}' was not found.`,
      'not_found',
      404
    );
  }

  return successResponse(
    input.operation,
    redactSecrets(settings[input.category as keyof typeof settings])
  );
}

function requireDestructiveAck(input: ToolInput) {
  if (input.destructive !== 'acknowledged') {
    throw new McpToolError(
      'This destructive operation requires destructive: "acknowledged".',
      'confirmation_required',
      400
    );
  }
}

function toToolResult(response: ToolResponse): CallToolResult {
  return {
    structuredContent: response,
    content: [
      {
        type: 'text',
        text: JSON.stringify(response, null, 2),
      },
    ],
    isError: !response.ok,
  };
}

function successResponse(operation: string, data: unknown): ToolResponse {
  return { ok: true, operation, data };
}

function errorResponse(
  operation: string,
  message: string,
  type: string,
  code: number
): ToolResponse {
  return {
    ok: false,
    operation,
    error: { message, type, code },
  };
}

function unsupportedOperation(operation: string, allowed: string[]) {
  return new McpToolError(
    `Unsupported operation '${operation}'. Allowed operations: ${allowed.join(', ')}.`,
    'invalid_request',
    400
  );
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => {
      if (isSensitiveKey(key)) {
        return [key, '[REDACTED]'];
      }
      return [key, redactSecrets(nested)];
    })
  );
}

function isSensitiveKey(key: string) {
  const normalized = key.toLowerCase();
  return (
    normalized === 'secret' ||
    normalized === 'api_key' ||
    normalized === 'apikey' ||
    normalized === 'authorization' ||
    normalized === 'cookie' ||
    normalized.includes('token') ||
    normalized.includes('session') ||
    normalized.includes('password') ||
    normalized.includes('authcookie') ||
    normalized.includes('managementapikey')
  );
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value };
}

function getMcpServers(config: PlexusConfig) {
  return config.mcpServers ?? config.mcp_servers ?? {};
}

function getToolDescription(toolName: string) {
  switch (toolName) {
    case 'plexus_config':
      return 'Inspect Plexus configuration and status. Initial operations: get, export, status.';
    case 'plexus_provider':
      return 'Inspect providers and provider routing configuration. Initial operations: list, get.';
    case 'plexus_model_alias':
      return 'Inspect model aliases, targets, and target groups. Initial operations: list, get.';
    case 'plexus_key':
      return 'Inspect inference keys with secrets redacted. Initial operations: list, get.';
    case 'plexus_quota':
      return 'Inspect user quota definitions. Initial operations: list, get.';
    case 'plexus_quota_checker':
      return 'Inspect upstream provider quota checker configuration. Initial operations: types, list, get.';
    case 'plexus_usage':
      return 'Review request logs and summaries. Operations: list, summary, delete, delete_all.';
    case 'plexus_debug':
      return 'Review and manage debug tracing. Operations: state, update, logs, get_log, delete_log, delete_all_logs.';
    case 'plexus_mcp_gateway':
      return 'Inspect Plexus upstream MCP gateway configuration. Initial operations: servers_list, list, get.';
    case 'plexus_settings':
      return 'Inspect Plexus settings by category. Initial operations: get.';
    case 'plexus_operations':
      return 'Run high-impact operational actions. Operations: backup, restore, restart, list_cooldowns, clear_cooldowns, reset_logs.';
    default:
      return 'Plexus management tool.';
  }
}

function toWebRequest(request: FastifyRequest) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      headers.set(key, value.join(', '));
    } else if (value !== undefined) {
      headers.set(key, String(value));
    }
  }

  const rawProtoHeader = request.headers['x-forwarded-proto'];
  const rawProto = Array.isArray(rawProtoHeader) ? rawProtoHeader[0] : rawProtoHeader;
  const protocol = rawProto === 'https' ? 'https' : 'http';
  const host = request.headers.host ?? 'localhost';
  const url = `${protocol}://${host}${request.url}`;

  return new Request(url, {
    method: request.method,
    headers,
    body:
      request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : JSON.stringify(request.body ?? null),
  });
}
