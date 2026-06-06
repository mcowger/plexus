import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getConfig, type PlexusConfig } from '../../config';
import { logger } from '../../utils/logger';
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
- Check upstream quota state with plexus_quota_checker list, get, history, or check.
- Inspect user quota definitions with plexus_quota list or get.
- Review MCP gateway configuration with plexus_mcp_gateway servers_list.
- Inspect general settings with plexus_settings get and a category.
- Use plexus_debug state before enabling debug tracing.

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
  'plexus_system_logs',
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

export async function registerPlexusMcpRoutes(fastify: FastifyInstance) {
  fastify.register(async (plexusMcp) => {
    plexusMcp.setErrorHandler(async (error, _request, reply) => {
      if (error instanceof ManagementAuthError) {
        return reply.code(error.statusCode).send(error.authBody);
      }
      throw error;
    });

    plexusMcp.addHook('preHandler', authenticate);
    plexusMcp.addHook('preHandler', requireAdmin);

    plexusMcp.post('/mcp/plexus', handlePlexusMcpRequest);
    plexusMcp.get('/mcp/plexus', handlePlexusMcpRequest);
    plexusMcp.delete('/mcp/plexus', handlePlexusMcpRequest);
  });
}

async function handlePlexusMcpRequest(request: FastifyRequest, reply: FastifyReply) {
  // The SDK server owns one active transport at a time. A singleton would need
  // close/reconnect queueing, so stateless per-request servers are simpler and safer.
  const server = createPlexusMcpServer();
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

function createPlexusMcpServer() {
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
      async (input) => toToolResult(await handleToolCall(toolName, input as ToolInput))
    );
  }

  return server;
}

async function handleToolCall(toolName: (typeof TOOL_NAMES)[number], input: ToolInput) {
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
      case 'plexus_debug':
      case 'plexus_operations':
      case 'plexus_system_logs':
        throw new McpToolError(
          `${toolName} operation '${input.operation}' is not implemented yet.`,
          'not_implemented',
          501
        );
    }
  } catch (error) {
    if (error instanceof McpToolError) {
      return errorResponse(input.operation, error.message, error.type, error.code);
    }
    logger.warn(`Plexus MCP tool ${toolName} failed: ${(error as Error).message}`);
    return errorResponse(input.operation, 'Plexus MCP tool call failed.', 'internal_error', 500);
  }
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
      return 'Review request logs and summaries. Planned operations: list, summary, delete, delete_all.';
    case 'plexus_debug':
      return 'Review and manage debug tracing. Planned operations: state, update, logs, get_log, delete_log, delete_all_logs.';
    case 'plexus_mcp_gateway':
      return 'Inspect Plexus upstream MCP gateway configuration. Initial operations: servers_list, list, get.';
    case 'plexus_settings':
      return 'Inspect Plexus settings by category. Initial operations: get.';
    case 'plexus_operations':
      return 'Run high-impact operational actions. Planned operations: backup, restore, restart, list_cooldowns, clear_cooldowns.';
    case 'plexus_system_logs':
      return 'Access Plexus system logs. Planned operations: recent, stream.';
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
