import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getConfig, type PlexusConfig } from '../../config';
import { logger } from '../../utils/logger';
import { ConfigService } from '../../services/config-service';
import { McpUsageStorageService } from '../../services/mcp-proxy/mcp-usage-storage';
import { getClientIp } from '../../utils/ip';
import { ManagementAuthError, authenticate, requireAdmin } from '../management/_principal';

const PLEXUS_MANAGEMENT_PROMPT = `Plexus is a unified API gateway for LLMs. It exposes OpenAI- and Anthropic-compatible endpoints, provider-native raw endpoints, routes requests to configured providers, records usage, and manages provider, model alias, key, quota, debug, and MCP gateway configuration.

Use /mcp/plexus for admin-only Plexus management. All requests require x-admin-key. Do not use bearer inference keys for this endpoint.

The tools are compact domain tools. Prefer inspection before mutation: list or get the current state, explain the intended change, then call the relevant tool with operation, id, category, query, and body.

Destructive or high-impact operations require destructive: "acknowledged". Secrets are redacted by default. Only request redact: false when you have specific authorization and the operation explicitly supports unredacted output.

Common workflows:
- Review request activity with plexus_usage list or summary.
- Inspect or update provider setup with plexus_provider list, get, put, update, delete, or fetch_models.
- Raw provider access uses provider raw_passthrough { enabled, base_url, auth } plus key allowRawPassthrough. It is provider-wide, bypasses model restrictions/routing/failover/transformation, and should be treated as high-impact.
- Inspect or update model routing with plexus_model_alias list, get, put, update, delete, or delete_all.
- Inspect or update inference keys with plexus_key list, get, put, update, or delete; normal responses redact secrets.
- Check upstream quota state with plexus_quota_checker types, list, or get.
- Inspect or update user quota definitions with plexus_quota list, get, put, update, or delete; check or repair a key's quota usage with plexus_quota status, clear, or recompute.
- Review or update MCP gateway configuration with plexus_mcp_gateway servers_list, get, put, update, or delete.
- Inspect general settings with plexus_settings get and a category.
- Inspect recent system logs with plexus_system_logs recent.
- Inspect or change the runtime logging level with plexus_system_logs level, set_level, or reset_level.
- Use plexus_debug state before enabling debug tracing.
- Use plexus_operations backup, restore, refresh_metadata, list_cooldowns, or clear_cooldowns for operational actions.

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
  'plexus_system_logs',
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
  'disable',
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
    .describe(
      'Optional resource identifier for get/update/delete operations (the key name for plexus_quota status).'
    ),
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

type ManagementShimContext = {
  fastify: FastifyInstance;
  headers: Record<string, string>;
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
  mcpUsageStorage: McpUsageStorageService
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
      handlePlexusMcpRequest(request, reply, mcpUsageStorage)
    );
    plexusMcp.get('/mcp/plexus', (request, reply) =>
      handlePlexusMcpRequest(request, reply, mcpUsageStorage)
    );
    plexusMcp.delete('/mcp/plexus', (request, reply) =>
      handlePlexusMcpRequest(request, reply, mcpUsageStorage)
    );
  });
}

async function handlePlexusMcpRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  mcpUsageStorage: McpUsageStorageService
) {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();
  const sourceIp = getClientIp(request);
  const method = request.method as 'POST' | 'GET' | 'DELETE';
  const requestBody =
    request.body && typeof request.body === 'object'
      ? (request.body as Record<string, unknown>)
      : undefined;
  const jsonrpcMethod = typeof requestBody?.method === 'string' ? requestBody.method : null;
  const toolName =
    jsonrpcMethod === 'tools/call' &&
    requestBody?.params &&
    typeof requestBody.params === 'object' &&
    typeof (requestBody.params as Record<string, unknown>).name === 'string'
      ? ((requestBody.params as Record<string, unknown>).name as string)
      : null;
  const shimContext: ManagementShimContext = {
    fastify: reply.server,
    headers: buildShimHeaders(request),
  };

  // The SDK server owns one active transport at a time. A singleton would need
  // close/reconnect queueing, so stateless per-request servers are simpler and safer.
  const server = createPlexusMcpServer(shimContext);
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
    await mcpUsageStorage.saveRequest({
      request_id: requestId,
      created_at: new Date().toISOString(),
      start_time: startTime,
      duration_ms: Date.now() - startTime,
      server_name: 'plexus',
      upstream_url: '/mcp/plexus',
      method,
      jsonrpc_method: jsonrpcMethod,
      tool_name: toolName,
      api_key: 'admin',
      attribution: null,
      source_ip: sourceIp,
      response_status: webResponse.status,
      is_streamed: false,
      has_debug: false,
      error_code: webResponse.status >= 400 ? 'MCP_ERROR' : null,
      error_message: webResponse.status >= 400 ? body || 'MCP request failed' : null,
    });
    return reply.code(webResponse.status).send(body || undefined);
  } finally {
    await server.close();
  }
}

function createPlexusMcpServer(shimContext: ManagementShimContext) {
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
      description:
        'How to safely manage Plexus routing, raw provider access, keys, quotas, and operations.',
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
      description:
        'Best practices for providers, raw passthrough, keys, quotas, and operations through MCP.',
    },
    async () => ({
      description: 'Use this guide before changing Plexus routing or privileged raw access.',
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
      async (input) => toToolResult(await handleToolCall(toolName, input as ToolInput, shimContext))
    );
  }

  return server;
}

async function handleToolCall(
  toolName: (typeof TOOL_NAMES)[number],
  input: ToolInput,
  shimContext: ManagementShimContext
) {
  try {
    if (DESTRUCTIVE_OPERATIONS.has(input.operation)) {
      requireDestructiveAck(input);
    }

    const config = getConfig();

    switch (toolName) {
      case 'plexus_config':
        return await handleConfigTool(input, config, shimContext);
      case 'plexus_provider':
        return await handleProviderTool(input, shimContext);
      case 'plexus_model_alias':
        return await handleModelAliasTool(input, shimContext);
      case 'plexus_key':
        return await handleKeyTool(input, shimContext);
      case 'plexus_quota':
        return await handleQuotaTool(input, shimContext);
      case 'plexus_quota_checker':
        return handleQuotaCheckerTool(input, config);
      case 'plexus_mcp_gateway':
        return await handleMcpGatewayTool(input, shimContext);
      case 'plexus_settings':
        return await handleSettingsTool(input, shimContext);
      case 'plexus_system_logs':
        return await handleSystemLogsTool(input, shimContext);
      case 'plexus_usage':
        return await handleUsageTool(input, shimContext);
      case 'plexus_debug':
        return await handleDebugTool(input, shimContext);
      case 'plexus_operations':
        return await handleOperationsTool(input, shimContext);
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
  shimContext: ManagementShimContext
): Promise<ToolResponse> {
  switch (input.operation) {
    case 'list': {
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'GET',
          '/v0/management/usage',
          undefined,
          input.query
        )
      );
    }
    case 'summary': {
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'GET',
          '/v0/management/usage/summary',
          undefined,
          input.query
        )
      );
    }
    case 'delete': {
      if (!input.id) {
        throw new McpToolError('Missing id for usage delete operation.', 'invalid_request', 400);
      }
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'DELETE',
          `/v0/management/usage/${encodePathPreservingSlashes(input.id)}`
        )
      );
    }
    case 'delete_all': {
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'DELETE',
          '/v0/management/usage',
          undefined,
          input.query
        )
      );
    }
    default:
      throw unsupportedOperation(input.operation, ['list', 'summary', 'delete', 'delete_all']);
  }
}

async function handleDebugTool(
  input: ToolInput,
  shimContext: ManagementShimContext
): Promise<ToolResponse> {
  switch (input.operation) {
    case 'state':
      return successResponse(
        input.operation,
        await callManagementRoute(shimContext, 'GET', '/v0/management/debug')
      );
    case 'update':
      return successResponse(
        input.operation,
        await callManagementRoute(shimContext, 'PATCH', '/v0/management/debug', input.body ?? {})
      );
    case 'logs':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'GET',
          '/v0/management/debug/logs',
          undefined,
          input.query
        )
      );
    case 'get_log': {
      if (!input.id) {
        throw new McpToolError('Missing id for debug get_log operation.', 'invalid_request', 400);
      }
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'GET',
          `/v0/management/debug/logs/${encodePathPreservingSlashes(input.id)}`
        )
      );
    }
    case 'delete_log': {
      if (!input.id) {
        throw new McpToolError(
          'Missing id for debug delete_log operation.',
          'invalid_request',
          400
        );
      }
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'DELETE',
          `/v0/management/debug/logs/${encodePathPreservingSlashes(input.id)}`
        )
      );
    }
    case 'delete_all_logs':
      return successResponse(
        input.operation,
        await callManagementRoute(shimContext, 'DELETE', '/v0/management/debug/logs')
      );
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
  shimContext: ManagementShimContext
): Promise<ToolResponse> {
  switch (input.operation) {
    case 'backup': {
      const full = input.query?.full === true || asOptionalString(input.query?.full) === 'true';
      if (full) {
        const archive = await callManagementRoute(
          shimContext,
          'GET',
          '/v0/management/backup',
          undefined,
          { full: 'true' },
          true
        );
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
        backup: await callManagementRoute(shimContext, 'GET', '/v0/management/backup'),
      });
    }
    case 'restore': {
      const body = input.body ?? {};
      if (body.full === true || typeof body.archive === 'string') {
        if (typeof body.archive !== 'string') {
          throw new McpToolError(
            'body.archive must be a base64 string for full restore.',
            'invalid_request',
            400
          );
        }
        return successResponse(
          input.operation,
          await callManagementRoute(
            shimContext,
            'POST',
            '/v0/management/restore',
            Buffer.from(body.archive, 'base64'),
            undefined,
            false,
            { 'content-type': 'application/gzip' }
          )
        );
      }
      if (!body.plexus_backup) {
        throw new McpToolError(
          'Invalid backup: missing plexus_backup field',
          'invalid_request',
          400
        );
      }
      return successResponse(input.operation, {
        ...(await callManagementRoute(shimContext, 'POST', '/v0/management/restore', body)),
      });
    }
    case 'restart':
      return successResponse(
        input.operation,
        await callManagementRoute(shimContext, 'POST', '/v0/management/restart')
      );
    case 'refresh_metadata':
      return successResponse(
        input.operation,
        await callManagementRoute(shimContext, 'POST', '/v0/management/models/metadata/refresh')
      );
    case 'list_cooldowns':
      return successResponse(
        input.operation,
        await callManagementRoute(shimContext, 'GET', '/v0/management/cooldowns')
      );
    case 'clear_cooldowns': {
      const provider = input.id ?? asOptionalString(input.query?.provider);
      const model = asOptionalString(input.query?.model);
      return successResponse(
        input.operation,
        provider
          ? await callManagementRoute(
              shimContext,
              'DELETE',
              `/v0/management/cooldowns/${encodePathPreservingSlashes(provider)}`,
              undefined,
              model ? { model } : undefined
            )
          : await callManagementRoute(shimContext, 'DELETE', '/v0/management/cooldowns')
      );
    }
    case 'reset_logs':
      return successResponse(
        input.operation,
        await callManagementRoute(shimContext, 'DELETE', '/v0/management/logs/reset')
      );
    default:
      throw unsupportedOperation(input.operation, [
        'backup',
        'restore',
        'restart',
        'refresh_metadata',
        'list_cooldowns',
        'clear_cooldowns',
        'reset_logs',
      ]);
  }
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

async function handleConfigTool(
  input: ToolInput,
  config: PlexusConfig,
  shimContext: ManagementShimContext
): Promise<ToolResponse> {
  switch (input.operation) {
    case 'get':
      return successResponse(
        input.operation,
        redactSecrets(await callManagementRoute(shimContext, 'GET', '/v0/management/config'))
      );
    case 'export':
      return successResponse(
        input.operation,
        redactSecrets(await callManagementRoute(shimContext, 'GET', '/v0/management/config/export'))
      );
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

async function handleProviderTool(
  input: ToolInput,
  shimContext: ManagementShimContext
): Promise<ToolResponse> {
  switch (input.operation) {
    case 'list': {
      const providers = await callManagementRoute(shimContext, 'GET', '/v0/management/providers');
      return successResponse(input.operation, mapRecordResponse(redactSecrets(providers)));
    }
    case 'get': {
      const id = requireId(input, 'provider');
      const provider = await callManagementRoute(
        shimContext,
        'GET',
        `/v0/management/providers/${encodePathPreservingSlashes(id)}`
      );
      return successResponse(input.operation, { id, ...asObject(redactSecrets(provider)) });
    }
    case 'put':
    case 'create':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'PUT',
          `/v0/management/providers/${encodePathPreservingSlashes(requireId(input, 'provider'))}`,
          input.body ?? {}
        )
      );
    case 'update':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'PATCH',
          `/v0/management/providers/${encodePathPreservingSlashes(requireId(input, 'provider'))}`,
          input.body ?? {}
        )
      );
    case 'delete':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'DELETE',
          `/v0/management/providers/${encodePathPreservingSlashes(requireId(input, 'provider'))}`,
          undefined,
          input.query
        )
      );
    case 'fetch_models':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'POST',
          '/v0/management/providers/fetch-models',
          input.body ?? {}
        )
      );
    default:
      throw unsupportedOperation(input.operation, [
        'list',
        'get',
        'put',
        'create',
        'update',
        'delete',
        'fetch_models',
      ]);
  }
}

async function handleModelAliasTool(
  input: ToolInput,
  shimContext: ManagementShimContext
): Promise<ToolResponse> {
  switch (input.operation) {
    case 'list': {
      const aliases = await callManagementRoute(shimContext, 'GET', '/v0/management/aliases');
      return successResponse(input.operation, mapRecordResponse(aliases));
    }
    case 'get': {
      const id = requireId(input, 'model_alias');
      const alias = await callManagementRoute(
        shimContext,
        'GET',
        `/v0/management/aliases/${encodePathPreservingSlashes(id)}`
      );
      return successResponse(input.operation, { id, ...stripNamedId(alias, 'slug') });
    }
    case 'put':
    case 'create':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'PUT',
          `/v0/management/aliases/${encodePathPreservingSlashes(requireId(input, 'model_alias'))}`,
          input.body ?? {}
        )
      );
    case 'update':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'PATCH',
          `/v0/management/aliases/${encodePathPreservingSlashes(requireId(input, 'model_alias'))}`,
          input.body ?? {}
        )
      );
    case 'delete':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'DELETE',
          `/v0/management/models/${encodePathPreservingSlashes(requireId(input, 'model_alias'))}`
        )
      );
    case 'delete_all':
      return successResponse(
        input.operation,
        await callManagementRoute(shimContext, 'DELETE', '/v0/management/models')
      );
    default:
      throw unsupportedOperation(input.operation, [
        'list',
        'get',
        'put',
        'create',
        'update',
        'delete',
        'delete_all',
      ]);
  }
}

async function handleKeyTool(
  input: ToolInput,
  shimContext: ManagementShimContext
): Promise<ToolResponse> {
  switch (input.operation) {
    case 'list': {
      const keys = await callManagementRoute(shimContext, 'GET', '/v0/management/keys');
      return successResponse(input.operation, mapRecordResponse(redactSecrets(keys)));
    }
    case 'get': {
      const id = requireId(input, 'key');
      const key = await callManagementRoute(
        shimContext,
        'GET',
        `/v0/management/keys/${encodeURIComponent(id)}`
      );
      return successResponse(input.operation, { id, ...stripNamedId(redactSecrets(key), 'name') });
    }
    case 'put':
    case 'create':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'PUT',
          `/v0/management/keys/${encodeURIComponent(requireId(input, 'key'))}`,
          input.body ?? {}
        )
      );
    case 'update':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'PATCH',
          `/v0/management/keys/${encodeURIComponent(requireId(input, 'key'))}`,
          input.body ?? {}
        )
      );
    case 'delete':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'DELETE',
          `/v0/management/keys/${encodeURIComponent(requireId(input, 'key'))}`
        )
      );
    case 'disable':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'POST',
          `/v0/management/keys/${encodeURIComponent(requireId(input, 'key'))}/disable`
        )
      );
    default:
      throw unsupportedOperation(input.operation, [
        'list',
        'get',
        'put',
        'create',
        'update',
        'delete',
        'disable',
      ]);
  }
}

async function handleQuotaTool(
  input: ToolInput,
  shimContext: ManagementShimContext
): Promise<ToolResponse> {
  switch (input.operation) {
    case 'list': {
      const quotas = await callManagementRoute(shimContext, 'GET', '/v0/management/user-quotas');
      return successResponse(input.operation, mapRecordResponse(quotas));
    }
    case 'get': {
      const id = requireId(input, 'quota');
      const quota = await callManagementRoute(
        shimContext,
        'GET',
        `/v0/management/user-quotas/${encodeURIComponent(id)}`
      );
      return successResponse(input.operation, { id, ...stripNamedId(quota, 'name') });
    }
    case 'put':
    case 'create':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'PUT',
          `/v0/management/user-quotas/${encodeURIComponent(requireId(input, 'quota'))}`,
          input.body ?? {}
        )
      );
    case 'update':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'PATCH',
          `/v0/management/user-quotas/${encodeURIComponent(requireId(input, 'quota'))}`,
          input.body ?? {}
        )
      );
    case 'delete':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'DELETE',
          `/v0/management/user-quotas/${encodeURIComponent(requireId(input, 'quota'))}`
        )
      );
    case 'status': {
      const key = requireId(input, 'key');
      const status = await callManagementRoute(
        shimContext,
        'GET',
        `/v0/management/quota/status/${encodeURIComponent(key)}`
      );
      return successResponse(input.operation, status);
    }
    case 'clear':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'POST',
          '/v0/management/quota/clear',
          input.body ?? {}
        )
      );
    case 'recompute':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'POST',
          '/v0/management/quota/recompute',
          input.body ?? {}
        )
      );
    default:
      throw unsupportedOperation(input.operation, [
        'list',
        'get',
        'put',
        'create',
        'update',
        'delete',
        'status',
        'clear',
        'recompute',
      ]);
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

async function handleMcpGatewayTool(
  input: ToolInput,
  shimContext: ManagementShimContext
): Promise<ToolResponse> {
  switch (input.operation) {
    case 'servers_list':
    case 'list': {
      const servers = await callManagementRoute(shimContext, 'GET', '/v0/management/mcp-servers');
      return successResponse(input.operation, mapRecordResponse(redactSecrets(servers)));
    }
    case 'get': {
      const id = requireId(input, 'mcp_gateway');
      const server = await callManagementRoute(
        shimContext,
        'GET',
        `/v0/management/mcp-servers/${encodeURIComponent(id)}`
      );
      return successResponse(input.operation, {
        id,
        ...stripNamedId(redactSecrets(server), 'name'),
      });
    }
    case 'put':
    case 'create':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'PUT',
          `/v0/management/mcp-servers/${encodeURIComponent(requireId(input, 'mcp_gateway'))}`,
          input.body ?? {}
        )
      );
    case 'update':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'PATCH',
          `/v0/management/mcp-servers/${encodeURIComponent(requireId(input, 'mcp_gateway'))}`,
          input.body ?? {}
        )
      );
    case 'delete':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'DELETE',
          `/v0/management/mcp-servers/${encodeURIComponent(requireId(input, 'mcp_gateway'))}`
        )
      );
    case 'status':
    case 'logs': {
      const id = requireId(input, 'mcp_gateway');
      const suffix = input.operation === 'logs' ? 'process-logs' : 'status';
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'GET',
          `/v0/management/mcp-servers/${encodeURIComponent(id)}/${suffix}`
        )
      );
    }
    case 'start':
    case 'stop':
    case 'restart': {
      const id = requireId(input, 'mcp_gateway');
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'POST',
          `/v0/management/mcp-servers/${encodeURIComponent(id)}/${input.operation}`
        )
      );
    }
    default:
      throw unsupportedOperation(input.operation, [
        'servers_list',
        'list',
        'get',
        'put',
        'create',
        'update',
        'delete',
        'status',
        'start',
        'stop',
        'restart',
        'logs',
      ]);
  }
}

async function handleSettingsTool(
  input: ToolInput,
  shimContext: ManagementShimContext
): Promise<ToolResponse> {
  if (input.operation !== 'get') {
    throw unsupportedOperation(input.operation, ['get']);
  }

  const categories = {
    failover: '/v0/management/config/failover',
    cooldown: '/v0/management/config/cooldown',
    timeout: '/v0/management/config/timeout',
    stall: '/v0/management/config/stall',
    trusted_proxies: '/v0/management/config/trusted-proxies',
    vision_fallthrough: '/v0/management/config/vision-fallthrough',
    background_exploration: '/v0/management/config/background-exploration',
    exploration: '/v0/management/config/exploration-rate',
  } as const;

  if (!input.category || input.category === 'all') {
    const [
      failover,
      cooldown,
      timeout,
      stall,
      trusted_proxies,
      vision_fallthrough,
      background_exploration,
      exploration,
    ] = await Promise.all([
      callManagementRoute(shimContext, 'GET', categories.failover),
      callManagementRoute(shimContext, 'GET', categories.cooldown),
      callManagementRoute(shimContext, 'GET', categories.timeout),
      callManagementRoute(shimContext, 'GET', categories.stall),
      callManagementRoute(shimContext, 'GET', categories.trusted_proxies),
      callManagementRoute(shimContext, 'GET', categories.vision_fallthrough),
      callManagementRoute(shimContext, 'GET', categories.background_exploration),
      callManagementRoute(shimContext, 'GET', categories.exploration),
    ]);
    return successResponse(input.operation, {
      failover,
      cooldown,
      timeout,
      stall,
      trusted_proxies,
      vision_fallthrough,
      background_exploration,
      exploration,
    });
  }

  if (!(input.category in categories)) {
    throw new McpToolError(
      `settings category '${input.category}' was not found.`,
      'not_found',
      404
    );
  }

  return successResponse(
    input.operation,
    await callManagementRoute(
      shimContext,
      'GET',
      categories[input.category as keyof typeof categories]
    )
  );
}

async function handleSystemLogsTool(
  input: ToolInput,
  shimContext: ManagementShimContext
): Promise<ToolResponse> {
  switch (input.operation) {
    case 'recent':
      return successResponse(
        input.operation,
        await callManagementRoute(
          shimContext,
          'GET',
          '/v0/system/logs/recent',
          undefined,
          input.query
        )
      );
    case 'level':
      return successResponse(
        input.operation,
        await callManagementRoute(shimContext, 'GET', '/v0/management/logging/level')
      );
    case 'set_level': {
      const level = asOptionalString(input.body?.level) ?? asOptionalString(input.query?.level);
      if (!level) {
        throw new McpToolError(
          'Missing level for set_level operation. Provide body.level or query.level.',
          'invalid_request',
          400
        );
      }
      return successResponse(
        input.operation,
        await callManagementRoute(shimContext, 'PUT', '/v0/management/logging/level', { level })
      );
    }
    case 'reset_level':
      return successResponse(
        input.operation,
        await callManagementRoute(shimContext, 'DELETE', '/v0/management/logging/level')
      );
    default:
      throw unsupportedOperation(input.operation, ['recent', 'level', 'set_level', 'reset_level']);
  }
}

function requireId(input: ToolInput, resourceType: string): string {
  if (!input.id) {
    throw new McpToolError(`Missing id for ${resourceType} operation.`, 'invalid_request', 400);
  }
  return input.id;
}

function mapRecordResponse(records: unknown): Array<Record<string, unknown>> {
  const object = asObject(records);
  return Object.entries(object).map(([id, value]) => ({ id, ...asObject(value) }));
}

function stripNamedId(value: unknown, key: string): Record<string, unknown> {
  const object = asObject(value);
  const { [key]: _ignored, ...rest } = object;
  return rest;
}

function buildShimHeaders(request: FastifyRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  const adminKey = request.headers['x-admin-key'];
  if (typeof adminKey === 'string') {
    headers['x-admin-key'] = adminKey;
  }
  return headers;
}

async function callManagementRoute(
  shimContext: ManagementShimContext,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  query?: Record<string, unknown>,
  raw: boolean = false,
  extraHeaders?: Record<string, string>
): Promise<any> {
  const url = appendQuery(path, query);
  const response: any = await (shimContext.fastify.inject as any)({
    method,
    url,
    headers: {
      ...shimContext.headers,
      ...(body !== undefined && !Buffer.isBuffer(body)
        ? { 'content-type': 'application/json' }
        : {}),
      ...extraHeaders,
    },
    payload: body as any,
  });

  if (response.statusCode >= 400) {
    throw toMcpToolError(response);
  }

  if (raw) {
    return response.rawPayload;
  }

  if (!response.body) {
    return {};
  }

  try {
    return JSON.parse(response.body);
  } catch {
    return response.body;
  }
}

function appendQuery(path: string, query?: Record<string, unknown>): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

function toMcpToolError(response: { statusCode: number; body: string }): McpToolError {
  let parsed: any = null;
  try {
    parsed = response.body ? JSON.parse(response.body) : null;
  } catch {
    parsed = null;
  }

  const message =
    parsed?.error?.message ??
    parsed?.error ??
    parsed?.message ??
    (response.body || 'Management request failed');
  const type =
    parsed?.error?.type ??
    (response.statusCode === 404
      ? 'not_found'
      : response.statusCode === 409
        ? 'conflict_error'
        : response.statusCode === 400
          ? 'invalid_request'
          : 'server_error');
  const code = parsed?.error?.code ?? response.statusCode;
  return new McpToolError(message, type, code);
}

function encodePathPreservingSlashes(value: string): string {
  return value
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
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
      return 'Inspect and manage providers and provider routing configuration. Operations: list, get, put, create, update, delete, fetch_models. Static API-key providers may define raw_passthrough { enabled, base_url, auth } to expose /raw/{provider}/* without routing, failover, adapters, or payload transformation.';
    case 'plexus_model_alias':
      return 'Inspect and manage model aliases, targets, and target groups. Operations: list, get, put, create, update, delete, delete_all.';
    case 'plexus_key':
      return 'Inspect and manage inference keys with secrets redacted. Operations: list, get, put, create, update, delete. Keys carry quotas: string[] to assign one or more quota definitions (legacy singular quota field is still accepted on input and folded into quotas). allowRawPassthrough grants provider-wide raw access to raw-enabled providers permitted by the key provider policy; model restrictions do not apply.';
    case 'plexus_quota':
      return "Inspect and manage user quota definitions, and check or repair per-key quota usage. Operations: list, get, put, create, update, delete, status, clear, recompute. Quota definitions carry scope fields (allowedProviders, excludedProviders, allowedModels, excludedModels; omitted when unscoped), shared (pooled across keys), and an optional warnAt threshold. status (id: key) returns { key, quotas: [...] } — one entry per quota attached to the key (assigned or default-sourced), each with name, limitType, limit, currentUsage, remaining, allowed, resetsAt, scope, global, shared, source ('assigned' | 'default'), and warnAt (only when set on the definition), plus legacy top-level quota_name/allowed/current_usage/limit/remaining/resets_at fields derived from the most-constrained entry. clear (body: { key, quota? }, destructive: \"acknowledged\") resets usage for one named quota, or every quota attached to the key when quota is omitted. recompute (body: { key, quota }, both required) repairs a quota's cached usage by recalculating from stored request records; it 400s with a reason (e.g. unsupported_quota_type) for leaky rolling tokens/requests quotas that cannot be recomputed, and its windowStartMs is a raw epoch-ms number. clear and recompute 404 when the key does not exist and 400 when the quota is not attached to that key.";
    case 'plexus_quota_checker':
      return 'Inspect upstream provider quota checker configuration. Initial operations: types, list, get.';
    case 'plexus_usage':
      return 'Review request logs and summaries. Operations: list, summary, delete, delete_all. Raw provider calls are distinct from passthrough and report isRaw: true with requestMethod and requestPath.';
    case 'plexus_debug':
      return 'Review and manage debug tracing. Operations: state, update, logs, get_log, delete_log, delete_all_logs. Debug capture targets are in-memory and inclusive: update body may include enabled, keys, aliases, and providers; a request is captured when any enabled dimension matches.';
    case 'plexus_mcp_gateway':
      return 'Inspect and manage Plexus upstream MCP gateway configuration. Operations: servers_list, list, get, put, create, update, delete, status, start, stop, restart, logs.';
    case 'plexus_settings':
      return 'Inspect Plexus settings by category. Initial operations: get.';
    case 'plexus_system_logs':
      return 'Inspect recent Plexus system logs and control runtime log verbosity. Operations: recent, level, set_level, reset_level.';
    case 'plexus_operations':
      return 'Run high-impact operational actions. Operations: backup, restore, restart, refresh_metadata, list_cooldowns, clear_cooldowns, reset_logs.';
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
