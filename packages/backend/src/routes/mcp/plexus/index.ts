import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { ConfigService } from '../../../services/configuration/config-service';
import { McpUsageStorageService } from '../../../services/mcp-proxy/mcp-usage-storage';
import { ManagementAuthError, authenticate, requireAdmin } from '../../management/_principal';
import { handleToolCall } from './dispatch';
import { createPlexusMcpRequestContext, handlePlexusMcpHttpRequest } from './http';
import { buildShimHeaders } from './management';
import { PLEXUS_MANAGEMENT_PROMPT, TOOL_NAMES, getToolDescription } from './metadata';
import { toToolResult } from './responses';
import { ToolInputSchema, type ManagementShimContext, type ToolInput } from './types';

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
    plexusMcp.addHook('preHandler', (_request, reply, done) => {
      void (async () => {
        try {
          const configService = ConfigService.getInstance();
          const mcpEnabled = await configService.getSetting<boolean>('mcpEnabled', true);
          if (!mcpEnabled) {
            reply.code(418).send({
              error: {
                message: 'Plexus Management MCP is disabled. Enable it on the MCP Servers page.',
                type: 'mcp_disabled',
              },
            });
            return;
          }
        } catch {
          // ConfigService not initialized — default to enabled
        }
        done();
      })().catch(done);
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
  const requestContext = createPlexusMcpRequestContext(request);
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
    return await handlePlexusMcpHttpRequest(
      request,
      reply,
      mcpUsageStorage,
      transport,
      requestContext
    );
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
